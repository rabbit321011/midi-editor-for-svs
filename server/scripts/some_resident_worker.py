#!/usr/bin/env python3
"""Resident OpenVPI-SOME worker for local MIDI-P candidates."""

import argparse
import hashlib
import json
import sys
from pathlib import Path


def emit(event_type, **payload):
    print(json.dumps({"type": event_type, **payload}, ensure_ascii=False), flush=True)


def sha256_file(path):
    digest = hashlib.sha256()
    with Path(path).open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def load_runtime(args):
    for path in (args.some_repo.resolve(), args.singer_repo.resolve()):
        sys.path.insert(0, str(path))
    import torch
    from src.YingMusicSinger.melody.midi_extractor import MIDIExtractor
    from src.YingMusicSinger.utils.mel_spectrogram import MelodySpectrogram
    device = torch.device(args.device)
    teacher = MIDIExtractor(in_dim=80)
    teacher._load_form_ckpt(args.checkpoint)
    teacher = teacher.to(device).eval()
    mel = MelodySpectrogram(mel_fmin=40, mel_fmax=8000).to(device)
    return {"teacher": teacher, "mel": mel, "device": device}


def extract(runtime, request):
    import soundfile as sf
    import torch
    import torch.nn.functional as F
    from src.YingMusicSinger.melody.midi_p_v4pf import (
        _aggregate_notes, _classes_from_pitch, _decode_boundaries,
        _decode_frame_pitch, _expand_notes,
    )

    input_path = Path(str(request["input"])).resolve()
    output_path = Path(str(request["output"])).resolve()
    guide_sha = str(request["guideSha256"]).lower()
    frame_count = int(request["frameCount"])
    start_frame = int(request.get("startFrame", 0))
    end_frame = int(request.get("endFrameExclusive", frame_count))
    context_frames = max(0, int(request.get("contextFrames", 0)))
    boundary_bias = float(request.get("boundaryBias", 0.0))
    rest_threshold = float(request.get("restThreshold", 0.1))
    min_note_frames = max(1, int(request.get("minNoteFrames", 1)))
    if not (0 <= start_frame < end_frame <= frame_count):
        raise ValueError("invalid local MIDI-P frame range")
    if not (-4 <= boundary_bias <= 4 and 0.01 <= rest_threshold <= 0.99):
        raise ValueError("SOME parameters are outside the supported range")
    if sha256_file(input_path) != guide_sha:
        raise ValueError("Owned Guide SHA256 mismatch")
    waveform, sample_rate = sf.read(input_path, dtype="float32", always_2d=True)
    if sample_rate != 44100 or waveform.shape[0] // 2048 != frame_count:
        raise ValueError("Unexpected Owned Guide audio contract")
    crop_start = max(0, start_frame - context_frames)
    crop_end = min(frame_count, end_frame + context_frames)
    mono = waveform.mean(axis=1, dtype="float32")[crop_start * 2048:crop_end * 2048]
    audio = torch.from_numpy(mono.copy()).unsqueeze(0).to(runtime["device"])
    emit("extracting", frameCount=crop_end - crop_start)
    with torch.inference_mode():
        mel = runtime["mel"](audio=audio, sr=44100)
        midi_logits, boundary_logits = runtime["teacher"](mel.transpose(1, 2))
        probs = torch.sigmoid(midi_logits)
        bounds = torch.sigmoid(boundary_logits.squeeze(-1) + boundary_bias)
        pitch, rest = _decode_frame_pitch(probs, rest_threshold=rest_threshold)
        frame_to_note = _decode_boundaries(bounds)
        note_pitch, note_duration, note_voiced = _aggregate_notes(frame_to_note, pitch, ~rest)
        note_pitch, note_duration, note_voiced = merge_short_notes(
            note_pitch[0], note_duration[0], note_voiced[0], min_note_frames)
        expanded_pitch, expanded_voiced, expanded_ids = _expand_notes(
            note_pitch.unsqueeze(0), note_duration.unsqueeze(0), note_voiced.unsqueeze(0))
        native_classes = _classes_from_pitch(expanded_pitch[0], expanded_voiced[0])
        target_len = crop_end - crop_start
        model_classes = F.interpolate(native_classes.float()[None, None, :], size=target_len, mode="nearest")[0, 0].long()
        model_ids = F.interpolate(expanded_ids[0].float()[None, None, :], size=target_len, mode="nearest")[0, 0].long()
    offset = start_frame - crop_start
    length = end_frame - start_frame
    classes = [int(value) for value in model_classes[offset:offset + length].cpu().tolist()]
    note_ids = [int(value) for value in model_ids[offset:offset + length].cpu().tolist()]
    payload = {
        "schema": "aisvc.v5p-midi-p.v1", "sourceSHA256": guide_sha,
        "sourceSampleCount": int(waveform.shape[0]), "sourceFrameCount": frame_count,
        "frameCount": length, "startFrame": start_frame, "endFrameExclusive": end_frame,
        "extractor": "some", "classes": classes, "noteIds": note_ids,
        "rawNotes": [], "baseSeed": 0, "effectiveSeed": 0, "language": "ja", "languageId": 0,
        "gameCommit": "openvpi-some", "runtimeHashes": {"some_model": request["modelHash"]},
        "compilerSHA256": sha256_file(__file__),
        "parameters": {"boundaryBias": boundary_bias, "restThreshold": rest_threshold,
                       "minNoteFrames": min_note_frames, "contextFrames": context_frames},
    }
    output_path.parent.mkdir(parents=True, exist_ok=True)
    output_path.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")
    emit("complete", output=str(output_path), noteCount=len(set(note_ids)),
         voicedNoteCount=len(set(note_id for note_id, value in zip(note_ids, classes) if value < 255)),
         restFrameCount=sum(value == 255 for value in classes))
    torch.cuda.empty_cache()
    emit("resident_updated", modelId="OpenVPI-SOME",
         residentMiB=round(torch.cuda.memory_reserved() / 1024 / 1024, 1))
    emit("extract_done", output=str(output_path))


def merge_short_notes(pitch, duration, voiced, minimum):
    if minimum <= 1 or duration.numel() <= 1:
        return pitch, duration, voiced
    pitches, durations, voices = [], [], []
    for index in range(duration.numel()):
        d = int(duration[index])
        if d < minimum and durations:
            durations[-1] += d
        else:
            pitches.append(pitch[index])
            durations.append(d)
            voices.append(voiced[index])
    import torch
    return torch.stack(pitches), torch.tensor(durations, device=duration.device), torch.stack(voices)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--some-repo", type=Path, required=True)
    parser.add_argument("--singer-repo", type=Path, required=True)
    parser.add_argument("--checkpoint", type=Path, required=True)
    parser.add_argument("--device", default="cuda")
    args = parser.parse_args()
    model_hash = sha256_file(args.checkpoint)
    emit("loading_model", model=str(args.checkpoint))
    runtime = load_runtime(args)
    emit("loaded_model")
    import torch
    emit("runtime_ready", modelId="OpenVPI-SOME",
         residentMiB=round(torch.cuda.memory_reserved() / 1024 / 1024, 1))
    for line in sys.stdin:
        if not line.strip():
            continue
        try:
            request = json.loads(line)
            if request.get("type") == "shutdown":
                emit("shutdown_ok")
                return
            if request.get("type") != "extract":
                raise ValueError("unsupported worker request")
            request["modelHash"] = model_hash
            extract(runtime, request)
        except Exception as error:
            emit("error", message=str(error))


if __name__ == "__main__":
    main()
