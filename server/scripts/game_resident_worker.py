#!/usr/bin/env python3
"""Resident GAME worker that keeps the MIDI-P extraction model loaded."""

import argparse
import importlib.util
import json
import subprocess
import sys
from pathlib import Path


RUNNER = Path(__file__).with_name("v5p_generate_midi_p.py")


def emit(event_type, **payload):
    print(json.dumps({"type": event_type, **payload}, ensure_ascii=False), flush=True)


def emit_resident_updated(model_id):
    try:
        import torch
        torch.cuda.empty_cache()
        resident_mib = round(torch.cuda.memory_reserved() / 1024 / 1024, 1)
        emit("resident_updated", modelId=model_id, residentMiB=resident_mib)
    except Exception:
        pass


def load_runner():
    spec = importlib.util.spec_from_file_location("v5p_generate_midi_p", RUNNER)
    if spec is None or spec.loader is None:
        raise RuntimeError(f"cannot import GAME runner: {RUNNER}")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def extract(runner, runtime, request):
    from src.YingMusicSinger.melody.game_cache_v4ph import GAME_CACHE_SCHEMA
    input_path = Path(str(request["input"])).resolve()
    output_path = Path(str(request["output"])).resolve()
    guide_sha = str(request["guideSha256"]).lower()
    frame_count = int(request["frameCount"])
    start_frame = int(request.get("startFrame", 0))
    end_frame = int(request.get("endFrameExclusive", frame_count))
    context_frames = max(0, int(request.get("contextFrames", 0)))
    boundary_threshold = float(request.get("boundaryThreshold", 0.2))
    boundary_radius = int(request.get("boundaryRadius", 2))
    presence_threshold = float(request.get("presenceThreshold", 0.2))
    nsteps = int(request.get("nsteps", GAME_CACHE_SCHEMA["nsteps"]))
    language = str(request.get("language", "ja"))
    if not input_path.is_file():
        raise FileNotFoundError(input_path)
    if frame_count < 1:
        raise ValueError("frame-count must be positive")
    if not (0 <= start_frame < end_frame <= frame_count):
        raise ValueError("invalid local MIDI-P frame range")
    if not (0.01 <= boundary_threshold <= 0.99 and 0.01 <= presence_threshold <= 0.99):
        raise ValueError("GAME thresholds must be inside 0.01..0.99")
    if not (1 <= boundary_radius <= 12 and 1 <= nsteps <= 64):
        raise ValueError("GAME boundary radius or nsteps is outside the supported range")
    source_hash = runner.sha256_file(input_path)
    if source_hash != guide_sha:
        raise ValueError(f"Owned Guide SHA256 mismatch: {source_hash} != {guide_sha}")

    import soundfile as sf
    import torch
    from src.YingMusicSinger.melody.game_cache_v4ph import canonicalize_game_cache, game_cache_to_model_tracks
    from src.YingMusicSinger.melody.game_runtime_v4ph import (
        extract_game_notes_with_posterior,
        stable_game_seed,
    )

    waveform, sample_rate = sf.read(input_path, dtype="float32", always_2d=True)
    if sample_rate != GAME_CACHE_SCHEMA["sample_rate"] or waveform.shape[0] < 2048:
        raise ValueError(f"Unexpected Owned Guide audio: {waveform.shape} @ {sample_rate}")
    mono = waveform.mean(axis=1, dtype="float32")
    sample_count = int(mono.size)
    actual_frame_count = sample_count // 2048
    if actual_frame_count != frame_count:
        raise ValueError(f"Owned Guide frameCount mismatch: {actual_frame_count} != {frame_count}")

    crop_start = max(0, start_frame - context_frames)
    crop_end = min(frame_count, end_frame + context_frames)
    crop_mono = mono[crop_start * 2048:crop_end * 2048]
    crop_sample_count = int(crop_mono.size)
    language_id = int((runtime["languageMap"] or {}).get(language, 0))
    default_seed = stable_game_seed(f"{source_hash}:{crop_start}:{crop_end}", runner.BASE_SEED)
    seed = int(request.get("seed", default_seed))
    emit("extracting", seed=seed, frameCount=crop_end - crop_start)
    notes = extract_parameterized_game_notes(
        model=runtime["model"], waveform=torch.from_numpy(crop_mono.copy()),
        duration=crop_sample_count / sample_rate, language_id=language_id,
        nsteps=nsteps, seed=seed, device=runtime["device"],
        boundary_threshold=boundary_threshold, boundary_radius=boundary_radius,
        presence_threshold=presence_threshold,
    )
    arrays = canonicalize_game_cache(notes)
    cache = {name: torch.from_numpy(value.copy()) for name, value in arrays.items()}
    tracks = game_cache_to_model_tracks(
        cache,
        num_samples=crop_sample_count,
        target_len=crop_end - crop_start,
        sample_rate=sample_rate,
    )
    offset = start_frame - crop_start
    length = end_frame - start_frame
    classes = [int(value) for value in tracks["p_classes"][offset:offset + length].tolist()]
    note_ids = [int(value) for value in tracks["note_ids"][offset:offset + length].tolist()]
    if len(classes) != length or any(value < 0 or value > 255 for value in classes):
        raise AssertionError("GAME adapter produced invalid B-local MIDI-P classes")
    payload = {
        "schema": runner.SCHEMA,
        "sourceSHA256": source_hash,
        "sourceSampleCount": sample_count,
        "frameCount": length,
        "sourceFrameCount": frame_count,
        "startFrame": start_frame,
        "endFrameExclusive": end_frame,
        "extractor": "game",
        "classes": classes,
        "noteIds": note_ids,
        "rawNotes": [
            {
                "duration": float(duration),
                "presence": bool(presence),
                "score": float(score),
                "class": int(class_id),
                "valid": bool(valid),
            }
            for duration, presence, score, class_id, valid in zip(
                arrays["durations"],
                arrays["presence"],
                arrays["scores"],
                arrays["classes"],
                arrays["valid"],
            )
        ],
        "baseSeed": runner.BASE_SEED,
        "effectiveSeed": seed,
        "language": language,
        "languageId": language_id,
        "parameters": {
            "boundaryThreshold": boundary_threshold,
            "boundaryRadius": boundary_radius,
            "presenceThreshold": presence_threshold,
            "nsteps": nsteps,
            "seed": seed,
            "contextFrames": context_frames,
        },
        "gameCommit": runtime["commit"],
        "gameSchema": GAME_CACHE_SCHEMA,
        "runtimeHashes": runtime["hashes"],
        "compilerSHA256": runner.sha256_file(RUNNER),
    }
    output_path.parent.mkdir(parents=True, exist_ok=True)
    output_path.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")
    emit(
        "complete",
        output=str(output_path),
        noteCount=sum(bool(value) for value in arrays["valid"]),
        voicedNoteCount=sum(bool(valid and presence) for valid, presence in zip(arrays["valid"], arrays["presence"])),
        restFrameCount=sum(value == 255 for value in classes),
    )
    emit_resident_updated("GAME-1.0-medium")
    emit("extract_done", output=str(output_path))


def extract_parameterized_game_notes(model, waveform, duration, language_id, nsteps, seed,
                                     device, boundary_threshold, boundary_radius,
                                     presence_threshold):
    import torch
    from modules.decoding import decode_gaussian_blurred_probs

    schedule = torch.arange(nsteps, device=device, dtype=torch.float32) / nsteps
    known_durations = torch.tensor([[duration]], device=device, dtype=torch.float32)
    language = torch.tensor([language_id], device=device, dtype=torch.long)
    waveform = waveform.unsqueeze(0).to(device)
    cuda_devices = [device.index or 0] if device.type == "cuda" else []
    with torch.random.fork_rng(devices=cuda_devices):
        torch.manual_seed(seed)
        if device.type == "cuda":
            torch.cuda.manual_seed_all(seed)
        with torch.inference_mode():
            x_seg, x_est, time_mask = model.forward_encoder(
                waveform=waveform, duration=known_durations.sum(dim=1))
            durations, regions, max_n = model.forward_segmenter(
                x_seg, known_durations=known_durations, mask=time_mask,
                language=language, t=schedule,
                threshold=torch.tensor(boundary_threshold, device=device),
                radius=torch.tensor(boundary_radius, device=device, dtype=torch.long))
            note_index = torch.arange(max_n, dtype=torch.long, device=device).unsqueeze(0)
            note_mask = note_index < regions.amax(dim=-1, keepdim=True)
            logits = model.model.forward_estimation(x_est, regions=regions, t_mask=time_mask, n_mask=note_mask)
            probs = logits.sigmoid()
            scores, presence = decode_gaussian_blurred_probs(
                probs=probs, min_val=model.inference_config.midi_min,
                max_val=model.inference_config.midi_max,
                deviation=model.inference_config.midi_std * 3,
                threshold=torch.tensor(presence_threshold, device=device))
            presence = presence & note_mask
            scores = scores * note_mask.float()
    return {
        "durations": durations[0].float().cpu(),
        "presence": presence[0].bool().cpu(),
        "scores": scores[0].float().cpu(),
        "pitch_probs_257": probs[0].float().cpu(),
    }


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--game-repo", type=Path, required=True)
    parser.add_argument("--game-deps", type=Path, required=True)
    parser.add_argument("--game-model", type=Path, required=True)
    parser.add_argument("--singer-repo", type=Path, required=True)
    parser.add_argument("--device", default="cuda:0")
    args = parser.parse_args()
    runner = load_runner()
    game_repo = args.game_repo.resolve()
    game_model = args.game_model.resolve()
    singer_repo = args.singer_repo.resolve()
    if not args.game_deps.resolve().is_dir():
        raise FileNotFoundError(f"missing GAME dependencies: {args.game_deps}")
    commit = subprocess.check_output(
        ["git", "-C", str(game_repo), "rev-parse", "HEAD"], text=True
    ).strip()
    if commit != runner.GAME_COMMIT:
        raise ValueError(f"GAME commit mismatch: {commit} != {runner.GAME_COMMIT}")
    module_paths = {
        "game_api": game_repo / "inference" / "api.py",
        "game_infer": game_repo / "inference" / "me_infer.py",
        "game_model": game_model,
        "game_runtime": singer_repo / "src" / "YingMusicSinger" / "melody" / "game_runtime_v4ph.py",
        "game_cache": singer_repo / "src" / "YingMusicSinger" / "melody" / "game_cache_v4ph.py",
        "game_adapter": singer_repo / "src" / "YingMusicSinger" / "melody" / "game_p_v4pf.py",
    }
    hashes = {label: runner.require_hash(label, path) for label, path in module_paths.items()}
    for path in (args.game_deps.resolve(), game_repo, singer_repo):
        sys.path.insert(0, str(path))

    import torch
    from inference.api import load_inference_model
    device = torch.device(args.device)
    if device.type == "cuda" and not torch.cuda.is_available():
        raise RuntimeError("GAME requested CUDA but CUDA is unavailable")
    emit("loading_model", model=str(game_model))
    model, language_map = load_inference_model(game_model)
    model = model.to(device).eval()
    emit("loaded_model")
    runtime = {
        "model": model,
        "languageMap": language_map or {},
        "device": device,
        "commit": commit,
        "hashes": hashes,
    }
    emit("runtime_ready", modelId="GAME-1.0-medium", residentMiB=round(torch.cuda.memory_reserved() / 1024 / 1024, 1))
    for line in sys.stdin:
        line = line.strip()
        if not line:
            continue
        try:
            request = json.loads(line)
        except json.JSONDecodeError as error:
            emit("error", message=f"invalid worker request: {error}")
            continue
        request_type = str(request.get("type") or "")
        try:
            if request_type == "ping":
                emit("pong", modelId="GAME-1.0-medium")
            elif request_type == "extract":
                extract(runner, runtime, request)
            elif request_type == "shutdown":
                emit("shutdown_ok")
                return
            else:
                raise ValueError(f"unsupported worker request: {request_type}")
        except Exception as error:
            emit("error", message=str(error))
            if request_type == "extract":
                emit("infer_failed")


if __name__ == "__main__":
    try:
        main()
    except Exception as error:
        emit("error", message=str(error))
        raise
