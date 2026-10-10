"""Independent CFG and hash-bound dual-reference inference for PgO."""

import contextlib
import json
import math
from pathlib import Path
import types

import torch
from torch.nn import functional as F

FORMULA = "audio-text-midi-independent.v1"


@contextlib.contextmanager
def independent_cfg(policy, guidance):
    original = policy.transformer.forward

    def forward(transformer, *args, **kwargs):
        if not kwargs.get("cfg_infer"):
            return original(*args, **kwargs)
        common = dict(kwargs)
        for key in ("cfg_infer", "cfg_infer_ids", "guidance_scale"):
            common.pop(key, None)
        values = []
        for drops in ((False, False, False), (True, False, False), (False, True, False), (False, False, True)):
            values.append(original(*args, **common, cfg_infer=False,
                                   drop_audio_cond=drops[0], drop_text=drops[1], drop_midi=drops[2])[0])
        full, no_a, no_t, no_m = values
        value = full + guidance["audio"] * (full - no_a) + guidance["text"] * (full - no_t) + guidance["midi"] * (full - no_m)
        return torch.cat([value, value], dim=0), None

    policy.transformer.forward = types.MethodType(forward, policy.transformer)
    try:
        yield
    finally:
        policy.transformer.forward = original
        policy.transformer.clear_cache()


def validate_multi(snapshot, inputs, guidance, direct):
    multi = snapshot.get("multiA")
    references = multi.get("references") if isinstance(multi, dict) else None
    paths = inputs.get("references")
    if not isinstance(multi, dict) or multi.get("schema") != "aisvc.pgo-multi-a.v1" or not isinstance(references, list) or not 2 <= len(references) <= 16:
        raise ValueError("multi A requires 2 to 16 reference snapshots")
    if not isinstance(paths, list) or len(paths) != len(references):
        raise ValueError("dual A input audio count mismatch")
    by_id = {}
    for value in paths:
        if not isinstance(value, dict) or not value.get("unitId") or not value.get("wav") or value["unitId"] in by_id:
            raise ValueError("dual A input identity mismatch")
        by_id[value["unitId"]] = Path(value["wav"]).resolve()
    seen, plans = set(), []
    frame_map = snapshot["frameMap"]
    for index, source in enumerate(references):
        if not isinstance(source, dict):
            raise ValueError("invalid dual A source")
        unit_id = source.get("unitId")
        if not unit_id or unit_id in seen or unit_id == snapshot["target"]["unitId"]:
            raise ValueError("duplicate or self dual A reference")
        seen.add(unit_id)
        if type(source.get("unitRevision")) is not int or source["unitRevision"] < 0:
            raise ValueError("invalid dual A revision")
        cfg = source.get("audioCfg")
        if isinstance(cfg, bool) or not isinstance(cfg, (int, float)) or not math.isfinite(cfg) or not -1 <= cfg <= 10:
            raise ValueError("invalid dual A CFG")
        if index == 0 and (unit_id != multi.get("primaryUnitId") or cfg != guidance["audio"]):
            raise ValueError("dual A primary CFG mismatch")
        guide = source.get("guide") or {}
        samples, count = guide.get("sampleCount"), guide.get("frameCount")
        if type(samples) is not int or samples < 2048 or type(count) is not int or count != samples // 2048 or guide.get("sampleRate") != 44100:
            raise ValueError("invalid dual A Guide")
        native = direct.build_frame_map(samples, snapshot["target"]["guide"]["sampleCount"])
        leading = frame_map["bOffsetFrame"] - native["bOffsetFrame"]
        if type(source.get("leadingPadFrames")) is not int or leading < 0 or source["leadingPadFrames"] != leading:
            raise ValueError("dual A leading pad mismatch")
        text = source.get("text") or {}
        tokens = text.get("denseHTokens")
        direct.validate_h_layer(tokens, count, "dual A")
        dense = [0] * leading + tokens
        virtual_map = {**frame_map, "reference": {**frame_map["reference"], "ownedFrameCount": len(dense)}}
        from v5p_direct_runner import terminal_placement_mode
        h = direct.build_h_transport(
            virtual_map, dense, snapshot["target"]["text"]["denseHTokens"],
            reference_terminal_mode=terminal_placement_mode(text),
            target_terminal_mode=terminal_placement_mode(snapshot["target"]["text"]))
        if unit_id not in by_id:
            raise ValueError("dual A upload is missing")
        plans.append({**source, "nativeFrameMap": native, "hTransport": h, "wav": by_id[unit_id]})
    if set(by_id) != seen:
        raise ValueError("unexpected dual A audio")
    longest = max(references, key=lambda source: source["guide"]["sampleCount"])
    basic = {key: longest[key] for key in ("unitId", "unitRevision", "guide", "text")}
    if json.dumps(basic, sort_keys=True) != json.dumps(snapshot["reference"], sort_keys=True):
        raise ValueError("dual A common anchor mismatch")
    if by_id[longest["unitId"]] != Path(inputs["referenceWav"]).resolve():
        raise ValueError("dual A common audio mismatch")
    return plans


def combine_reference_predictions(values, weights, text_cfg, midi_cfg):
    total = sum(weights)
    if total <= 0:
        raise ValueError("zero-weight mode uses the explicit no-A branch")
    result = None
    for prediction, weight in zip(values, weights):
        if weight == 0:
            continue
        full, no_a, no_t, no_m = prediction
        relative = weight / total
        value = relative * no_a + weight * (full - no_a) + text_cfg * relative * (full - no_t) + midi_cfg * relative * (full - no_m)
        result = value if result is None else result + value
    return result


@contextlib.contextmanager
def dual_cfg(policy, plans, guidance, b_only_text):
    original = policy.transformer.forward
    weights = [1 + plan["audioCfg"] for plan in plans]

    def forward(transformer, *args, **kwargs):
        if not kwargs.get("cfg_infer"):
            return original(*args, **kwargs)
        common = dict(kwargs)
        for key in ("cfg_infer", "cfg_infer_ids", "guidance_scale"):
            common.pop(key, None)
        if sum(weights) == 0:
            common.update(cond=torch.zeros_like(common["cond"]), text=b_only_text)
            full = original(*args, **common, cfg_infer=False, drop_audio_cond=True, drop_text=False, drop_midi=False)[0]
            value = full
            if guidance["text"]:
                no_t = original(*args, **common, cfg_infer=False, drop_audio_cond=True, drop_text=True, drop_midi=False)[0]
                value = value + guidance["text"] * (full - no_t)
            if guidance["midi"]:
                no_m = original(*args, **common, cfg_infer=False, drop_audio_cond=True, drop_text=False, drop_midi=True)[0]
                value = value + guidance["midi"] * (full - no_m)
        else:
            values = []
            for plan, weight in zip(plans, weights):
                if weight == 0:
                    values.append(None)
                    continue
                branch = {**common, "cond": plan["fullCond"], "text": plan["text"]}
                predictions = [original(*args, **branch, cfg_infer=False,
                                        drop_audio_cond=a, drop_text=t, drop_midi=m)[0]
                               for a, t, m in ((False, False, False), (True, False, False),
                                               (False, True, False), (False, False, True))]
                values.append(predictions)
            value = combine_reference_predictions(values, weights, guidance["text"], guidance["midi"])
        return torch.cat([value, value], dim=0), None

    policy.transformer.forward = types.MethodType(forward, policy.transformer)
    try:
        yield
    finally:
        policy.transformer.forward = original
        policy.transformer.clear_cache()


def synthesize_multi(policy, vae, validated, runner):
    torch.backends.cuda.matmul.allow_tf32 = False
    torch.backends.cudnn.allow_tf32 = False
    device, seed = validated["device"], validated["seed"]
    frame_map = validated["frameMap"]
    prefix, total = frame_map["bOffsetFrame"], frame_map["totalFrameCount"]
    plans, reference_audits = [], []
    runner.emit("encoding_reference")
    for source in validated["multiReferences"]:
        audio, _ = runner.load_audio(source["wav"], source["guide"], "dual A")
        native_prefix = source["nativeFrameMap"]["bOffsetFrame"]
        torch.manual_seed(seed)
        if device.startswith("cuda"):
            torch.cuda.manual_seed_all(seed)
        with torch.inference_mode():
            native = vae.encode_audio(F.pad(audio, (0, native_prefix * 2048 - audio.shape[-1])), in_sr=44100).transpose(1, 2)
        if native.shape[1] != native_prefix:
            raise ValueError("dual A encoder frame mismatch")
        aligned = F.pad(native, (0, 0, source["leadingPadFrames"], 0))
        text = torch.tensor(source["hTransport"]["tokens"], device=device, dtype=torch.long).unsqueeze(0)
        plans.append({**source, "prefixCond": aligned, "fullCond": F.pad(aligned, (0, 0, 0, total - prefix)), "text": text})
        reference_audits.append({
            "unitId": source["unitId"], "unitRevision": source["unitRevision"], "audioCfg": source["audioCfg"],
            "guideSHA256": source["guide"]["audioSHA256"], "leadingPadFrames": source["leadingPadFrames"],
            "encodedSHA256": runner.tensor_sha256(aligned), "hSHA256": runner.tensor_sha256(text),
        })
    common_text, midi, control_audit = runner.build_control_tensors(policy, validated["hTransport"], validated["midiTransport"], device)
    b_only_text = common_text.clone()
    # Keep B's training terminal/PUL extension but remove every A event,
    # including the A SEP placed immediately before B's first lyric.
    b_only_text[:, :prefix + validated["hTransport"]["target"]["firstLyricLocalFrame"]] = 0
    runner.emit("sampling", steps=validated["steps"], guidance=validated["guidance"], referenceCount=len(plans), totalFrames=total)
    with torch.inference_mode(), dual_cfg(policy, plans, validated["guidance"], b_only_text):
        generated, _ = policy.sample(
            cond=plans[0]["prefixCond"], text=plans[0]["text"], duration=total, midi_p=midi,
            bound_p=torch.zeros(1, total, 1, device=device, dtype=midi.dtype),
            steps=validated["steps"], t_shift=0.5, seed=seed, use_epss=False,
            enable_melody_control=True, cfg_strength=1.0, guidance_scale=1.0)
    crop = frame_map["crop"]
    target = generated[:, crop["startFrame"]:crop["endFrameExclusive"]].transpose(1, 2).float()
    runner.emit("decoding", cropStartFrame=crop["startFrame"], cropEndFrameExclusive=crop["endFrameExclusive"])
    with torch.inference_mode():
        decoded = vae.decode_audio(target).squeeze(0)[:1].reshape(-1).cpu()
    if decoded.numel() < crop["finalSampleCount"]:
        raise ValueError("dual A decode too short")
    output = decoded[:crop["finalSampleCount"]].contiguous()
    if not torch.isfinite(output).all():
        raise ValueError("dual A output is nonfinite")
    return output, {
        **control_audit, "multiReference": {"schema": "aisvc.pgo-multi-a.v1", "sources": reference_audits,
                                          "allAudioDisabled": all(plan["audioCfg"] == -1 for plan in plans)},
        "generatedLatentShape": list(generated.shape), "finalSampleCount": output.numel(),
    }
