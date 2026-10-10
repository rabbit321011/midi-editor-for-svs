"""Offline Intrinsic audio encoder and exact sentence-library search."""

from __future__ import annotations

import io
import json
import os
import sys
from pathlib import Path

import numpy as np


def inside(root: Path, relative: str) -> Path:
    target = (root / relative.replace("\\", "/")).resolve()
    if not target.is_relative_to(root.resolve()):
        raise ValueError("Library path escapes configured root")
    return target


def project_neighbors(vectors: np.ndarray, query: np.ndarray) -> np.ndarray:
    """PCA determines direction only; the client can restore exact radii."""
    if len(vectors) < 2:
        return np.zeros((len(vectors), 2), dtype=np.float32)
    combined = np.vstack([query, vectors]).astype(np.float64)
    centered = combined - combined.mean(axis=0)
    _, _, basis = np.linalg.svd(centered, full_matrices=False)
    axes = basis[:2].T
    for column in range(axes.shape[1]):
        anchor = np.argmax(np.abs(axes[:, column]))
        if axes[anchor, column] < 0:
            axes[:, column] *= -1
    return (vectors.astype(np.float64) - query) @ axes


class Library:
    def __init__(self, root: Path):
        registry = json.loads((root / "MODEL_REGISTRY.json").read_text("utf-8"))
        if registry.get("library_kind") != "sentence_singing_style_raw_embeddings":
            raise ValueError("Select the formal sentence vector library")
        model = registry["models"]["paraspeechclap_intrinsic"]
        base = inside(root, model["path"])
        self.vectors = np.load(base / "embeddings.f16.npy").astype(np.float32)
        rows = np.load(base / "row_indices.npy")
        manifest = [
            json.loads(line)
            for line in inside(root, registry["manifest"]["path"]).read_text("utf-8").splitlines()
            if line.strip()
        ]
        if self.vectors.shape != (len(rows), 768) or len(manifest) != registry["manifest"]["rows"]:
            raise ValueError("Library shape / manifest mismatch")
        if len(set(rows.tolist())) != len(rows) or np.any(rows < 0) or np.any(rows >= len(manifest)):
            raise ValueError("Invalid matrix-to-manifest mapping")
        self.entries = [manifest[int(row)] for row in rows]
        for row, entry in zip(rows, self.entries):
            if entry["row_index"] != int(row):
                raise ValueError("Manifest row identity mismatch")
        lengths = np.linalg.norm(self.vectors, axis=1)
        peak = np.load(base / "audio_peak.f32.npy")
        status = np.load(base / "status.npy")
        if peak.shape != lengths.shape or status.shape != lengths.shape:
            raise ValueError("Library quality sidecar mismatch")
        self.valid = np.isfinite(self.vectors).all(axis=1) & (lengths > 1e-8) & (peak >= 1e-4) & (status == 1)
        self.vectors /= np.maximum(lengths[:, None], 1e-8)
        self.root = root

    def search(self, query: np.ndarray, count: int = 200) -> list[dict]:
        query = np.asarray(query, dtype=np.float32)
        if query.shape != (768,) or not np.isfinite(query).all() or np.linalg.norm(query) < 1e-8:
            raise ValueError("Invalid query embedding")
        query /= np.linalg.norm(query)
        similarity = np.clip(self.vectors @ query, -1, 1)
        candidates = np.flatnonzero(self.valid)
        # Stable row identity breaks ties, including identical embeddings.
        selected = candidates[np.lexsort((candidates, -similarity[candidates]))[:count]]
        coordinates = project_neighbors(self.vectors[selected], query)
        results = []
        for rank, (index, coordinate) in enumerate(zip(selected, coordinates)):
            entry = self.entries[int(index)]
            results.append({
                "id": entry["segment_id"],
                "rank": rank + 1,
                "name": Path(entry["relative_audio_path"]).stem,
                "text": entry.get("text", ""),
                "duration": entry["end_sec"] - entry["start_sec"],
                "distance": float(np.sqrt(max(0.0, 2.0 - 2.0 * similarity[index]))),
                "cosine": float(similarity[index]),
                "x": float(coordinate[0]), "y": float(coordinate[1]),
                "short": entry["duration_sec"] < 1,
            })
        return results

    def audio(self, segment_id: str, root: Path) -> bytes:
        import soundfile as sf

        entry = next((item for item in self.entries if item["segment_id"] == segment_id), None)
        if entry is None:
            raise ValueError("Unknown library segment")
        file = inside(root, entry["relative_audio_path"])
        with sf.SoundFile(file) as source:
            start = round(entry["start_sec"] * source.samplerate)
            end = round(entry["end_sec"] * source.samplerate)
            if start < 0 or end > len(source) or end <= start:
                raise ValueError("Audio version does not match library boundaries")
            source.seek(start)
            samples = source.read(end - start, dtype="float32", always_2d=True)
            buffer = io.BytesIO()
            sf.write(buffer, samples, source.samplerate, format="WAV", subtype="FLOAT")
        return buffer.getvalue()


class Encoder:
    def __init__(self):
        import torch
        from transformers import WavLMConfig, WavLMModel

        torch.set_num_threads(max(1, min(4, os.cpu_count() or 1)))
        assets = Path(__file__).resolve().parent.parent / "models" / "paraspeechclap-intrinsic"
        config = WavLMConfig.from_pretrained(assets / "wavlm-large", local_files_only=True)
        config.layerdrop = 0.0
        self.base = WavLMModel(config).eval()
        self.projection = torch.nn.Module()
        self.projection.linear1 = torch.nn.Linear(config.hidden_size, 768, bias=False)
        self.projection.linear2 = torch.nn.Linear(768, 768, bias=False)
        self.projection.layer_norm = torch.nn.LayerNorm(768)
        self.projection.eval()
        state = torch.load(assets / "slap-intrinsic.pth.tar", map_location="cpu", weights_only=True, mmap=True)
        audio_prefix = "audio_branch.base."
        projection_prefix = "audio_projection."
        allowed = (audio_prefix, projection_prefix, "text_branch.", "text_projection.")
        unknown = [key for key in state if not key.startswith(allowed) and key != "log_logit_scale"]
        if unknown:
            raise ValueError(f"Unexpected checkpoint keys: {unknown[:5]}")
        self.base.load_state_dict({k[len(audio_prefix):]: v for k, v in state.items() if k.startswith(audio_prefix)}, strict=True)
        self.projection.load_state_dict({k[len(projection_prefix):]: v for k, v in state.items() if k.startswith(projection_prefix)}, strict=True)

    def encode(self, file: Path) -> np.ndarray:
        import soundfile as sf
        import torch
        import torch.nn.functional as functional
        import torchaudio

        samples, rate = sf.read(file, dtype="float32", always_2d=True)
        audio = samples.mean(axis=1)
        if not len(audio) or not np.isfinite(audio).all() or np.max(np.abs(audio)) < 1e-4:
            raise ValueError("Query audio is silent or invalid")
        if len(audio) / rate > 60:
            raise ValueError("Select a query audio / Guide of at most 60 seconds")
        tensor = torch.from_numpy(audio)
        if rate != 16000:
            tensor = torchaudio.transforms.Resample(rate, 16000)(tensor)
        tensor = functional.pad(tensor, (0, max(0, 400 - tensor.numel()))).unsqueeze(0)
        with torch.inference_mode():
            hidden = self.base(tensor, return_dict=False)[0].mean(dim=1)
            first = self.projection.linear1(hidden)
            value = self.projection.layer_norm(first + self.projection.linear2(functional.gelu(first)))
            return functional.normalize(value, dim=-1)[0].numpy()


def main():
    import base64

    libraries = {}
    encoder = None
    for line in sys.stdin:
        request = {}
        try:
            request = json.loads(line)
            root = Path(request["vectorLibraryPath"]).resolve()
            signature = (str(root), (root / "MODEL_REGISTRY.json").stat().st_mtime_ns)
            if signature not in libraries:
                libraries.clear()
                libraries[signature] = Library(root)
            library = libraries[signature]
            audio_root = Path(request["audioLibraryPath"]).resolve()
            if not audio_root.is_dir():
                raise ValueError("Audio dataset root does not exist")
            if request["action"] == "check":
                first = library.entries[0]
                if not inside(audio_root, first["relative_audio_path"]).is_file():
                    raise ValueError("Audio root must contain the manifest's relative audio paths (audio/...)")
                result = {"rows": len(library.entries), "validRows": int(library.valid.sum()), "dimension": 768}
            elif request["action"] == "audio":
                result = {"wavBase64": base64.b64encode(library.audio(request["segmentId"], audio_root)).decode("ascii")}
            elif request["action"] == "search":
                if encoder is None:
                    encoder = Encoder()
                result = {"points": library.search(encoder.encode(Path(request["inputWav"])))}
            else:
                raise ValueError("Unknown DB action")
            print(json.dumps({"id": request["id"], "result": result}, ensure_ascii=False), flush=True)
        except Exception as error:
            print(json.dumps({"id": request.get("id"), "error": str(error)}, ensure_ascii=False), flush=True)


if __name__ == "__main__":
    main()
