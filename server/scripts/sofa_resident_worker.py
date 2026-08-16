#!/usr/bin/env python3
"""Resident SOFA worker that keeps JPN_Test2_Plus loaded between jobs."""

import argparse
import importlib.util
import json
import sys
from pathlib import Path


RUNNER = Path(__file__).with_name("sofa_runner.py")
CONSTRAINED = Path(__file__).with_name("sofa_kana_constrained.py")
PREPARE = Path(__file__).with_name("v4h_prepare_job.py")
ALIGNMENT_METHOD = "SOFA_JPN_Test2_Plus_full_segment"
MODEL_ID = "Greenleaf2001/JPN_Test2_Plus"
V5P_FRAME_SECONDS = 2048 / 44100


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
    spec = importlib.util.spec_from_file_location("sofa_runner", RUNNER)
    if spec is None or spec.loader is None:
        raise RuntimeError(f"cannot import sofa runner: {RUNNER}")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def load_local_module(path, name):
    spec = importlib.util.spec_from_file_location(name, path)
    if spec is None or spec.loader is None:
        raise RuntimeError(f"cannot import local module: {path}")
    module = importlib.util.module_from_spec(spec)
    sys.modules[name] = module
    spec.loader.exec_module(module)
    return module


def load_model(runner, repo, ckpt, device):
    import pyopenjtalk
    import torch

    sofa_source = Path(repo) / "src" / "SOFA"
    if not sofa_source.is_dir():
        raise FileNotFoundError(f"SOFA source not found: {sofa_source}")
    sys.path.insert(0, str(sofa_source))
    from modules.task import forced_alignment
    import modules.AP_detector.loudnesss_pectralcentroid_detector as ap_detector_module
    import modules.utils.load_wav as sofa_load_wav
    from modules.utils.post_processing import add_SP, fill_small_gaps

    sofa_load_wav.installed_torchaudio = False
    forced_alignment.load_wav = runner.load_audio_with_librosa
    ap_detector_module.load_wav = runner.load_audio_with_librosa

    emit("log", stage="sofa", message=f"Loading {MODEL_ID}...")
    emit("progress", stage="sofa", progress=8)
    model = forced_alignment.LitForcedAlignmentTask.load_from_checkpoint(
        str(ckpt), map_location=device
    )
    model.set_inference_mode("force")
    model.eval()
    model.freeze()
    model.to(torch.device(device))
    model.on_predict_start()
    return {
        "model": model,
        "pyopenjtalk": pyopenjtalk,
        "ap_detector": ap_detector_module.LoudnessSpectralcentroidAPDetector(),
        "post": {"add_SP": add_SP, "fill_small_gaps": fill_small_gaps},
    }


def align(runner, runtime, request):
    input_path = Path(str(request["input"]))
    transcript_path = Path(str(request["transcript"]))
    output_dir = Path(str(request["outputDir"]))
    output_name = str(request["outputName"])
    if not input_path.is_file():
        raise FileNotFoundError(input_path)
    if not transcript_path.is_file():
        raise FileNotFoundError(transcript_path)
    transcript = json.loads(transcript_path.read_text(encoding="utf-8"))
    if transcript.get("language") != "ja":
        raise ValueError("SOFA JPN_Test2_Plus only accepts Japanese transcripts")
    phrases = transcript.get("phrases") or []
    if not phrases:
        raise ValueError("Whisper transcript contains no phrases")
    phonemes, words, phoneme_to_word = runner.phrases_to_sofa_input(
        phrases, runtime["pyopenjtalk"].g2p
    )
    emit("log", stage="sofa", message="Aligning the complete audio segment...")
    emit("progress", stage="sofa", progress=30)
    import torch
    with torch.inference_mode():
        prediction = runtime["model"].predict_step(
            (input_path, phonemes, words, phoneme_to_word), 0
        )
    prediction = runtime["ap_detector"].process([prediction])[0]
    (
        _,
        duration,
        confidence,
        output_phonemes,
        phoneme_intervals,
        output_words,
        output_word_intervals,
    ) = prediction
    output_words, output_word_intervals = runtime["post"]["fill_small_gaps"](
        output_words, output_word_intervals, duration
    )
    output_phonemes, phoneme_intervals = runtime["post"]["fill_small_gaps"](
        output_phonemes, phoneme_intervals, duration
    )
    output_words, output_word_intervals = runtime["post"]["add_SP"](
        output_words, output_word_intervals, duration
    )
    output_phonemes, phoneme_intervals = runtime["post"]["add_SP"](
        output_phonemes, phoneme_intervals, duration
    )
    result = runner.build_result(
        output_name,
        phrases,
        duration,
        confidence,
        output_words,
        output_word_intervals,
        output_phonemes,
        phoneme_intervals,
    )
    output_dir.mkdir(parents=True, exist_ok=True)
    output_path = output_dir / f"{output_name}.json"
    output_path.write_text(json.dumps(result, ensure_ascii=False, indent=2), encoding="utf-8")
    emit("progress", stage="sofa", progress=95)
    emit("result", **result, outputFile=str(output_path))
    emit("done", alignmentMethod=ALIGNMENT_METHOD, outputFile=str(output_path))
    emit_resident_updated("SOFA Japanese")
    emit("align_done", outputFile=str(output_path))


class KanaConstrainedRuntime:
    def __init__(self, runtime, constrained):
        self.runtime = runtime
        self.constrained = constrained
        self.word_bounds = None

    def set_kana_constraints(self, kana_units, crop_start):
        self.word_bounds = [
            (
                float(unit["startFrame"]) * V5P_FRAME_SECONDS - crop_start,
                float(unit["endFrameExclusive"]) * V5P_FRAME_SECONDS - crop_start,
            )
            for unit in kana_units
        ]

    def predict(self, audio_path, frontend, batch_index):
        if self.word_bounds is None:
            raise ValueError("hard Kana bounds were not supplied to SOFA")
        import torch
        with torch.inference_mode():
            prediction = self.constrained.predict_with_kana_bounds(
                self.runtime["model"],
                audio_path,
                frontend["phonemes"],
                frontend["words"],
                frontend["phoneme_to_word"],
                self.word_bounds,
                batch_index,
            )
        prediction = self.constrained.constrain_prediction_intervals(
            prediction,
            frontend["phone_events"],
            self.word_bounds,
        )
        (
            _, model_duration, model_confidence, model_phones,
            model_phone_intervals, model_words, model_word_intervals,
        ) = prediction
        prediction = self.runtime["ap_detector"].process([prediction])[0]
        (_, duration, confidence, phones, phone_intervals, words, word_intervals) = prediction
        # fill_small_gaps mutates lexical intervals and can cross a hard Kana
        # boundary. In constrained mode, explicit SP rows preserve every gap.
        phones, phone_intervals = self.runtime["post"]["add_SP"](phones, phone_intervals, duration)
        words, word_intervals = self.runtime["post"]["add_SP"](words, word_intervals, duration)
        result = {
            "duration": float(duration),
            "confidence": float(confidence),
            "model_duration": float(model_duration),
            "model_confidence": float(model_confidence),
            "model_phone_tier": interval_rows(model_phones, model_phone_intervals),
            "model_word_tier": interval_rows(model_words, model_word_intervals),
            "used_phone_tier": interval_rows(phones, phone_intervals),
            "used_word_tier": interval_rows(words, word_intervals),
        }
        validate_constrained_intervals(frontend, result["used_phone_tier"], self.word_bounds)
        self.word_bounds = None
        return result




def interval_rows(labels, intervals):
    return [
        {"phone": str(label), "start": round(float(interval[0]), 6), "end": round(float(interval[1]), 6)}
        for label, interval in zip(labels, intervals)
    ]


def validate_constrained_intervals(frontend, rows, word_bounds):
    silence = {"sp", "ap", "pau", "sil", "<sp>", "<ap>"}
    lexical = [row for row in rows if row["phone"].lower() not in silence]
    events = frontend["phone_events"]
    if len(lexical) != len(events):
        raise ValueError(f"constrained SOFA phone count mismatch: {len(lexical)} != {len(events)}")
    for row, event in zip(lexical, events):
        start, end = word_bounds[int(event["mora_index"])]
        if float(row["start"]) < start - 1e-4 or float(row["end"]) > end + 1e-4:
            raise ValueError(
                f"SOFA phone {row['phone']} escaped Kana {int(event['mora_index']) + 1}: "
                f"{row['start']}-{row['end']} outside {start}-{end}"
            )


def align_constrained(runtime, request, worker_args):
    constrained = load_local_module(CONSTRAINED, "aisvc_sofa_kana_constrained")
    prepare = load_local_module(PREPARE, "aisvc_v4h_prepare_constrained")
    class PrepareArgs:
        job_manifest = Path(str(request["jobManifest"]))
        output = Path(str(request["output"]))
        runtime = Path(str(request["runtime"]))
        h_runner = Path(str(request["hRunner"]))
        singer_root = Path(str(request["singerRoot"]))
        sofa_repo = Path(worker_args.repo)
        sofa_checkpoint = Path(worker_args.ckpt)
        escape_seconds = float(request.get("escapeSeconds") or 0)
        japanese = Path(str(request["japanese"]))
        vocab = Path(str(request["vocab"]))
        hash_contract = "v5p-source-20260810"
        gpu = 0
    adapter = KanaConstrainedRuntime(runtime, constrained)
    prepare.run_job(PrepareArgs(), sofa_runtime_override=adapter)
    emit_resident_updated("SOFA Japanese")
    emit("align_done", outputFile=str(PrepareArgs.output))


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--repo", required=True)
    parser.add_argument("--ckpt", required=True)
    parser.add_argument("--device", default="cuda")
    args = parser.parse_args()
    runner = load_runner()
    runtime = load_model(runner, args.repo, args.ckpt, args.device)
    import torch
    emit("runtime_ready", modelId="SOFA Japanese", residentMiB=round(torch.cuda.memory_reserved() / 1024 / 1024, 1))
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
                emit("pong", modelId="SOFA Japanese")
            elif request_type == "align":
                align(runner, runtime, request)
            elif request_type == "align_constrained":
                align_constrained(runtime, request, args)
            elif request_type == "shutdown":
                emit("shutdown_ok")
                return
            else:
                raise ValueError(f"unsupported worker request: {request_type}")
        except Exception as error:
            emit("error", message=str(error))
            if request_type in {"align", "align_constrained"}:
                emit("infer_failed")


if __name__ == "__main__":
    try:
        main()
    except Exception as error:
        emit("error", message=str(error))
        raise
