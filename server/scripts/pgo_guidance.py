"""Independent CFG and hash-bound dual-reference inference for PgO."""

import contextlib
import json
import math
from pathlib import Path
import types

import torch
from torch.nn import functional as F

FORMULA = "audio-text-midi-independent.v1"


def validate_token_weights(snapshot):
    """Freeze only B phoneme events; A weights never participate in inference."""
    references = [snapshot["reference"], *((snapshot.get("multiA") or {}).get("references", []))]
    if any("guidanceWeight" in event for source in references for event in source["text"].get("hEvents", [])):
        raise ValueError("A snapshots must not contain H token weights")
    target = snapshot["target"]
    dense = target["text"]["denseHTokens"]
    offset = snapshot["frameMap"]["bOffsetFrame"]
    weights, seen, ids = [], set(), set()
    for event in target["text"].get("hEvents", []):
        if "guidanceWeight" not in event:
            continue
        weight = event["guidanceWeight"]
        frame, token = event.get("frame"), event.get("tokenId")
        if (isinstance(weight, bool) or not isinstance(weight, (int, float))
                or not math.isfinite(weight) or not -10 <= weight <= 10):
            raise ValueError("B H token weight must be finite in -10..10")
        if (type(frame) is not int or not 0 <= frame < len(dense)
                or type(token) is not int or not 1 <= token < 364
                or dense[frame] != token or frame in seen
                or not isinstance(event.get("id"), str) or not event["id"] or event["id"] in ids):
            raise ValueError("B H token weight must identify a unique phoneme event")
        seen.add(frame)
        ids.add(event["id"])
        if weight != 1:
            weights.append({"eventId": event["id"], "localFrame": frame,
                            "jointFrame": offset + frame, "tokenId": token, "weight": weight})
    return weights


def group_token_weights(events, mode="none", dense=None):
    if mode not in {"none", "same-weight", "adjacent"}:
        raise ValueError("invalid H token merge mode")
    groups, by_weight = [], {}
    previous = None
    for event in sorted(events, key=lambda item: item["localFrame"]):
        group = None
        if mode == "same-weight":
            group = by_weight.get(event["weight"])
        elif mode == "adjacent" and previous is not None:
            last = previous["events"][-1]
            if dense is None:
                raise ValueError("adjacent H merge requires the B dense layer")
            if (last["weight"] == event["weight"]
                    and all(token == 0 for token in dense[last["localFrame"] + 1:event["localFrame"]])):
                group = previous
        if group is None:
            group = {"weight": event["weight"], "events": []}
            groups.append(group)
            by_weight[event["weight"]] = group
        group["events"].append(event)
        previous = group
    return groups


def token_weight_correction(original, branch, full, token_weights, drop_audio=False, token_groups=None):
    correction = torch.zeros_like(full)
    groups = token_groups if token_groups is not None else [{"weight": event["weight"], "events": [event]} for event in token_weights]
    text = branch["text"]
    for group in groups:
        masked = text.clone()
        # Existing H blank=0, not PUL=366, SEP=365 or internal CFG dropout=-1.
        # Do not compact tokens or alter any other frame, A, MIDI, x or time.
        for event in group["events"]:
            frame = event["jointFrame"]
            if not 0 <= frame < text.shape[1] or not torch.all(text[:, frame] == event["tokenId"]):
                raise ValueError("B weighted H event differs from joint model input")
            masked[:, frame] = 0
        without = original(**{**branch, "text": masked}, cfg_infer=False,
                           drop_audio_cond=drop_audio, drop_text=False, drop_midi=False)[0]
        correction = correction + (1 - group["weight"]) * (without - full)
    return correction


@contextlib.contextmanager
def independent_cfg(policy, guidance, token_weights=(), token_groups=None):
    original = policy.transformer.forward

    def forward(transformer, *args, **kwargs):
        if not kwargs.get("cfg_infer"):
            return original(*args, **kwargs)
        common = dict(kwargs)
        for key in ("cfg_infer", "cfg_infer_ids", "guidance_scale"):
            common.pop(key, None)
        common["cache"] = False
        values = []
        for drops in ((False, False, False), (True, False, False), (False, True, False), (False, False, True)):
            values.append(original(*args, **common, cfg_infer=False,
                                   drop_audio_cond=drops[0], drop_text=drops[1], drop_midi=drops[2])[0])
        full, no_a, no_t, no_m = values
        value = full + guidance["audio"] * (full - no_a) + guidance["text"] * (full - no_t) + guidance["midi"] * (full - no_m)
        if token_weights:
            if args:
                raise ValueError("token CFG requires keyword model inputs")
            value = value + token_weight_correction(original, common, full, token_weights, token_groups=token_groups)
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


def combine_reference_predictions(values, weights, text_cfg, midi_cfg, corrections=None):
    total = sum(weights)
    if total <= 0:
        raise ValueError("zero-weight mode uses the explicit no-A branch")
    result = None
    for index, (prediction, weight) in enumerate(zip(values, weights)):
        if weight == 0:
            continue
        full, no_a, no_t, no_m = prediction
        relative = weight / total
        # Finish CFG and local token corrections inside this reference, then mix.
        if corrections is None:
            value = relative * no_a + weight * (full - no_a) + text_cfg * relative * (full - no_t) + midi_cfg * relative * (full - no_m)
        else:
            value = no_a + total * (full - no_a) + text_cfg * (full - no_t) + midi_cfg * (full - no_m)
            value = relative * (value + corrections[index])
        result = value if result is None else result + value
    return result


@contextlib.contextmanager
def dual_cfg(policy, plans, guidance, b_only_text, token_weights=(), token_groups=None, no_a_midi=None):
    original = policy.transformer.forward
    weights = [1 + plan["audioCfg"] for plan in plans]

    def forward(transformer, *args, **kwargs):
        if not kwargs.get("cfg_infer"):
            return original(*args, **kwargs)
        common = dict(kwargs)
        for key in ("cfg_infer", "cfg_infer_ids", "guidance_scale"):
            common.pop(key, None)
        common["cache"] = False
        if sum(weights) == 0:
            common.update(cond=torch.zeros_like(common["cond"]), text=b_only_text)
            if no_a_midi is not None:
                common["midi"] = no_a_midi
            full = original(*args, **common, cfg_infer=False, drop_audio_cond=True, drop_text=False, drop_midi=False)[0]
            value = full
            if guidance["text"]:
                no_t = original(*args, **common, cfg_infer=False, drop_audio_cond=True, drop_text=True, drop_midi=False)[0]
                value = value + guidance["text"] * (full - no_t)
            if guidance["midi"]:
                no_m = original(*args, **common, cfg_infer=False, drop_audio_cond=True, drop_text=False, drop_midi=True)[0]
                value = value + guidance["midi"] * (full - no_m)
            if token_weights:
                value = value + token_weight_correction(original, common, full, token_weights, drop_audio=True, token_groups=token_groups)
        else:
            values, corrections = [], []
            for plan, weight in zip(plans, weights):
                if weight == 0:
                    values.append(None)
                    corrections.append(None)
                    continue
                branch = {**common, "cond": plan["fullCond"], "text": plan["text"]}
                if "midi" in plan:
                    branch["midi"] = plan["midi"]
                predictions = [original(*args, **branch, cfg_infer=False,
                                        drop_audio_cond=a, drop_text=t, drop_midi=m)[0]
                               for a, t, m in ((False, False, False), (True, False, False),
                                               (False, True, False), (False, False, True))]
                values.append(predictions)
                corrections.append(token_weight_correction(original, branch, predictions[0], token_weights, token_groups=token_groups)
                                   if token_weights else 0)
            value = combine_reference_predictions(values, weights, guidance["text"], guidance["midi"],
                                                  corrections if token_weights else None)
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
    with torch.inference_mode(), dual_cfg(policy, plans, validated["guidance"], b_only_text,
                                         validated.get("hTokenWeights", []), validated.get("hTokenGroups")):
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
        "hTokenGuidance": token_weight_audit(validated),
        **control_audit, "multiReference": {"schema": "aisvc.pgo-multi-a.v1", "sources": reference_audits,
                                          "allAudioDisabled": all(plan["audioCfg"] == -1 for plan in plans)},
        "generatedLatentShape": list(generated.shape), "finalSampleCount": output.numel(),
    }


def token_weight_audit(validated):
    events = validated.get("hTokenWeights", [])
    groups = validated.get("hTokenGroups")
    if groups is None:
        groups = [{"weight": event["weight"], "events": [event]} for event in events]
    plans = validated.get("multiReferences")
    active = sum(plan["audioCfg"] != -1 for plan in plans) if plans else 1
    return {"schema": "aisvc.pgo-b-h-token-guidance.v1", "blankTokenId": 0,
            "formula": "G_i+sum_groups((1-w_group)*(F_i_without_group-F_i))",
            "mergeMode": validated["guidance"].get("hTokenMerge", "none"),
            "events": events, "groups": groups, "additionalForwardsPerField": len(groups) * max(1, active)}
