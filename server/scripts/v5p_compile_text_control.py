#!/usr/bin/env python3
"""Compile bounded SOFA/H candidates into B-local Kana and H controls."""

import argparse
import hashlib
import json
import math
from pathlib import Path
import sys

import jaconv


FRAME_RATE = 44100 / 2048
SEP_TOKEN_ID = 365
PUL_TOKEN_ID = 366
SCHEMA = "aisvc.v5p-text-control.v1"


def parse_args():
    parser = argparse.ArgumentParser()
    parser.add_argument("--alignment", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--runtime", type=Path, required=True)
    parser.add_argument("--vocab", type=Path, required=True)
    parser.add_argument("--frame-count", type=int, required=True)
    return parser.parse_args()


def sha256_file(path):
    digest = hashlib.sha256()
    with Path(path).open("rb") as file:
        for chunk in iter(lambda: file.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def frame_floor(seconds, frame_count):
    return max(0, min(frame_count, math.floor(float(seconds) * FRAME_RATE)))


def frame_ceil(seconds, frame_count):
    return max(0, min(frame_count, math.ceil(float(seconds) * FRAME_RATE)))


def phrase_frame_range(phrase, frame_count):
    if (
        phrase.get("sourceStartFrame") is not None
        and phrase.get("sourceEndFrameExclusive") is not None
    ):
        start = int(phrase["sourceStartFrame"])
        end = int(phrase["sourceEndFrameExclusive"])
    else:
        start = frame_floor(phrase["start"], frame_count)
        end = frame_ceil(phrase["end"], frame_count)
    if not 0 <= start < end <= frame_count:
        raise ValueError(
            f"phrase {phrase.get('id')} frame range {start}..{end} "
            f"is outside frameCount {frame_count}"
        )
    return start, end


def anchored_seconds(frame):
    # The training renderer floors phrase.start * frameRate. A quarter-frame
    # interior point preserves the exact integer anchor across float runtimes.
    return (int(frame) + 0.25) / FRAME_RATE


def seconds_to_frame(seconds):
    microseconds = round(float(seconds) * 1_000_000)
    return round(microseconds * 44100 / (2048 * 1_000_000))


def solve_windowed_monotonic_frames(target_frames, lower_frames, upper_frames, first_frame):
    """Use the training placement objective with a hard window per token."""
    targets = [int(value) for value in target_frames]
    lowers = [int(value) for value in lower_frames]
    uppers = [int(value) for value in upper_frames]
    first_frame = int(first_frame)
    if not targets or len(targets) != len(lowers) or len(targets) != len(uppers):
        raise ValueError("hard Kana placement window count mismatch")
    if not lowers[0] <= first_frame <= uppers[0]:
        raise ValueError("first H token is outside its Kana boundary")
    if any(lower > upper for lower, upper in zip(lowers, uppers)):
        raise ValueError("a Kana is too narrow for its H tokens")

    targets[0] = first_frame

    def feasible(max_shift):
        previous = None
        for index, target in enumerate(targets):
            lower = max(lowers[index], target - max_shift)
            upper = min(uppers[index], target + max_shift)
            frame = first_frame if index == 0 else max(previous + 1, lower)
            if frame < lower or frame > upper:
                return False
            previous = frame
        return True

    low = 0
    high = max(
        max(uppers) - min(lowers),
        max(abs(target - lower) for target, lower in zip(targets, lowers)),
        max(abs(target - upper) for target, upper in zip(targets, uppers)),
    )
    while low < high:
        middle = (low + high) // 2
        if feasible(middle):
            high = middle
        else:
            low = middle + 1
    if not feasible(low):
        raise ValueError("no monotonic H placement exists inside the Kana boundaries")
    max_shift = low

    costs = {first_frame: 0}
    backpointers = []
    for index in range(1, len(targets)):
        target = targets[index]
        earliest = max(lowers[index], target - max_shift)
        latest = min(uppers[index], target + max_shift)
        next_costs = {}
        pointers = {}
        best_cost = math.inf
        best_frame = None
        previous_items = sorted(costs.items())
        previous_index = 0
        for frame in range(earliest, latest + 1):
            while previous_index < len(previous_items) and previous_items[previous_index][0] < frame:
                previous_frame, previous_cost = previous_items[previous_index]
                if previous_cost < best_cost:
                    best_cost = previous_cost
                    best_frame = previous_frame
                previous_index += 1
            if best_frame is not None:
                next_costs[frame] = best_cost + abs(frame - target)
                pointers[frame] = best_frame
        if not next_costs:
            raise ValueError("no monotonic H placement exists inside the Kana boundaries")
        costs = next_costs
        backpointers.append(pointers)

    final_frame = min(costs, key=lambda frame: (costs[frame], frame))
    frames = [final_frame]
    for pointers in reversed(backpointers):
        final_frame = pointers[final_frame]
        frames.append(final_frame)
    frames.reverse()
    shifts = [frame - target for frame, target in zip(frames, targets)]
    return {
        "target_frames": targets,
        "frames": frames,
        "signed_shifts": shifts,
        "max_abs_shift": max(abs(shift) for shift in shifts),
        "total_abs_shift": sum(abs(shift) for shift in shifts),
        "collision_count": sum(left == right for left, right in zip(targets, targets[1:])),
    }


def constrain_h_candidates_to_kana(region, frame_count):
    h_alignment = region.get("HAlignment") or {}
    if h_alignment.get("boundaryMode") != "kana-hard":
        return
    phrases = region.get("Phrases") or []
    candidates = h_alignment.get("phrase_candidates") or []
    audits = h_alignment.get("phrase_audits") or []
    if len(phrases) != len(candidates) or len(phrases) != len(audits):
        raise ValueError("hard Kana phrase/audit count mismatch")

    for phrase_index, (phrase, candidate, audit) in enumerate(zip(phrases, candidates, audits)):
        if candidate.get("status") != "eligible":
            sofa_error = (audit.get("hAlignment") or {}).get("error")
            raise ValueError(
                f"phrase {phrase_index + 1} hard Kana SOFA alignment failed: "
                f"{sofa_error or candidate.get('fallback_reason') or 'unknown error'}"
            )
        kana_units = phrase.get("kanaUnits") or []
        phone_events = (audit.get("hAlignment") or {}).get("phone_events") or []
        lyric_tokens = [int(token) for token in phrase.get("tokens") or []]
        if len(phone_events) != len(lyric_tokens):
            raise ValueError(f"phrase {phrase_index + 1} hard Kana phone count mismatch")
        if [int(event.get("token_id", -1)) for event in phone_events] != lyric_tokens:
            raise ValueError(f"phrase {phrase_index + 1} hard Kana token sequence mismatch")

        phrase_start, phrase_end = phrase_frame_range(phrase, frame_count)
        crop_start = float(audit["cropStart"])
        targets = []
        lowers = []
        uppers = []
        for event in phone_events:
            mora_index = int(event["mora_index"])
            if not 0 <= mora_index < len(kana_units):
                raise ValueError(f"phrase {phrase_index + 1} H token has no Kana boundary")
            interval = event.get("interval") or {}
            target = seconds_to_frame(crop_start + float(interval["start"]))
            unit = kana_units[mora_index]
            targets.append(target)
            lowers.append(int(unit["startFrame"]))
            uppers.append(int(unit["endFrameExclusive"]) - 1)

        placement = solve_windowed_monotonic_frames(
            targets,
            lowers,
            uppers,
            first_frame=phrase_start,
        )
        if placement["max_abs_shift"] > 4:
            raise ValueError(
                f"phrase {phrase_index + 1} requires H shift "
                f"{placement['max_abs_shift']} frames, exceeding the training limit"
            )
        sep_frame = phrase_end
        candidate.update({
            "relative_frames": [
                *[frame - phrase_start for frame in placement["frames"]],
                sep_frame - phrase_start,
            ],
            "relative_target_frames": [
                *[frame - phrase_start for frame in placement["target_frames"]],
                sep_frame - phrase_start,
            ],
            "frames": [*placement["frames"], sep_frame],
            "target_frames": [*placement["target_frames"], sep_frame],
            "signed_shifts": [*placement["signed_shifts"], 0],
            "max_abs_shift": placement["max_abs_shift"],
            "max_abs_phone_shift": placement["max_abs_shift"],
            "total_abs_shift": placement["total_abs_shift"],
            "collision_count": placement["collision_count"],
        })


def normalize_mora_label(label):
    text = str(label).strip()
    if not text or text.upper() in {"AP", "SP", "PAU", "SIL"}:
        return ""
    return jaconv.kata2hira(text)


def compile_kana(region, frame_count, solve_monotonic_frames):
    units = []
    phrase_ranges = []
    audits = region["HAlignment"].get("phrase_audits") or []
    phrases = region.get("Phrases") or []
    if len(audits) != len(phrases):
        raise ValueError("phrase/audit count mismatch")

    if (region.get("HAlignment") or {}).get("boundaryMode") == "kana-hard":
        for phrase_index, phrase in enumerate(phrases):
            start, end = phrase_frame_range(phrase, frame_count)
            kana_units = phrase.get("kanaUnits") or []
            if not kana_units:
                raise ValueError(f"phrase {phrase_index + 1} has no hard KanaUnit input")
            for mora_index, unit in enumerate(kana_units):
                units.append({
                    "id": str(unit.get("id") or f"kana:{phrase['id']}:{mora_index}"),
                    "kana": str(unit["kana"]),
                    "romaji": jaconv.kana2alphabet(str(unit["kana"])),
                    "startFrame": int(unit["startFrame"]),
                    "endFrameExclusive": int(unit["endFrameExclusive"]),
                    "origin": "segment-align",
                    "phraseId": phrase["id"],
                })
            phrase_ranges.append({
                "phraseId": phrase["id"],
                "startFrame": start,
                "speechEndFrameExclusive": end,
                "maxAbsShift": 0,
            })
        boundaries = [{
            "id": f"kana-seg:{index}",
            "frame": phrase_ranges[index + 1]["startFrame"] - 1,
            "kind": "SEG",
            "origin": "segment-align",
        } for index in range(len(phrase_ranges) - 1)]
        return units, boundaries, phrase_ranges

    for phrase_index, (phrase, audit) in enumerate(zip(phrases, audits)):
        start, end = phrase_frame_range(phrase, frame_count)
        crop_start = float(audit["cropStart"])
        word_tier = (
            audit.get("hAlignment", {}).get("used_word_tier")
            or audit.get("hAlignment", {}).get("model_word_tier")
            or []
        )
        moras = []
        for row in word_tier:
            kana = normalize_mora_label(row.get("phone"))
            if not kana:
                continue
            moras.append(
                {
                    "kana": kana,
                    "startSeconds": crop_start + float(row["start"]),
                    "endSeconds": crop_start + float(row["end"]),
                }
            )
        if not moras:
            raise ValueError(f"phrase {phrase_index} produced no SOFA mora tier")
        targets = [
            round(round(row["startSeconds"] * 1_000_000) * 44100 / (2048 * 1_000_000))
            for row in moras
        ]
        targets.append(end)
        placement = solve_monotonic_frames(
            targets,
            first_frame=start,
            lower_frame=start,
            upper_frame=end,
            priority_mask=[True] * len(targets),
        )
        boundaries = placement["frames"]
        for mora_index, row in enumerate(moras):
            units.append(
                {
                    "id": f"kana:{phrase['id']}:{mora_index}",
                    "kana": row["kana"],
                    "romaji": jaconv.kana2alphabet(row["kana"]),
                    "startFrame": boundaries[mora_index],
                    "endFrameExclusive": boundaries[mora_index + 1],
                    "origin": "segment-align",
                    "phraseId": phrase["id"],
                }
            )
        phrase_ranges.append(
            {
                "phraseId": phrase["id"],
                "startFrame": start,
                "speechEndFrameExclusive": end,
                "maxAbsShift": placement["max_abs_shift"],
            }
        )

    boundaries = [
        {
            "id": f"kana-seg:{index}",
            # SEG is a real one-frame Kana-track object immediately before
            # the next phrase. Its persisted frame is also its editor frame.
            "frame": phrase_ranges[index + 1]["startFrame"] - 1,
            "kind": "SEG",
            "origin": "segment-align",
        }
        for index in range(len(phrase_ranges) - 1)
    ]
    return units, boundaries, phrase_ranges


def compile_h(region, frame_count, render_h_pul_placements, inverse_vocab):
    phrases = region.get("Phrases") or []
    candidates = region["HAlignment"].get("phrase_candidates") or []
    if len(phrases) != len(candidates):
        raise ValueError("phrase/candidate count mismatch")
    constrain_h_candidates_to_kana(region, frame_count)

    # A partial KanaTrack can already own a terminal SEG boundary even though
    # later Kana phrases have not been materialized. The training renderer
    # normally puts the last SEP at the end of its supplied dense timeline;
    # use the persisted terminal control boundary as that timeline horizon.
    dense_frame_count = int(frame_count)
    terminal_control_end = phrases[-1].get("controlEndFrameExclusive")
    if terminal_control_end is not None:
        terminal_control_end = int(terminal_control_end)
        if not 0 < terminal_control_end <= dense_frame_count:
            raise ValueError("terminal H control boundary escaped frame contract")
        if terminal_control_end < phrase_frame_range(phrases[-1], frame_count)[1]:
            raise ValueError("terminal H control boundary precedes phrase speech range")
        dense_frame_count = terminal_control_end

    # The authoritative renderer requires a non-empty A prefix. Rebuild every
    # phrase from its frozen integer B-local frame range, shift by one synthetic
    # frame, render with ref_len=1, then strip that frame.
    shifted_phrases = []
    for phrase in phrases:
        start, end = phrase_frame_range(phrase, frame_count)
        shifted_phrases.append(
            {
                **phrase,
                "start": anchored_seconds(start + 1),
                "end": anchored_seconds(end + 1),
            }
        )
    rendered = render_h_pul_placements(
        shifted_phrases,
        candidates,
        ref_len=1,
        total_frames=dense_frame_count + 1,
        sep_token_id=SEP_TOKEN_ID,
        pul_token_id=PUL_TOKEN_ID,
    )
    dense = rendered["phone_pul"]["text"][1:]
    if len(dense) != dense_frame_count:
        raise AssertionError("B-local H candidate horizon mismatch")

    phrase_modes = []
    event_attribution = {}
    rendered_phrases = rendered["phone_pul"].get("phrases") or []
    phrase_audits = region["HAlignment"].get("phrase_audits") or []
    for phrase_index, (phrase, candidate, placement) in enumerate(
        zip(phrases, candidates, rendered_phrases)
    ):
        phrase_id = str(phrase["id"])
        mode = str(placement.get("placement_mode") or "unknown")
        phrase_modes.append(
            {
                "phraseId": phrase_id,
                "placementMode": mode,
                "fallbackReason": placement.get("fallback_reason"),
            }
        )
        raw_sep_frame = placement.get("sep_frame")
        if raw_sep_frame is not None:
            sep_frame = int(raw_sep_frame) - 1
            if 0 <= sep_frame < frame_count:
                event_attribution[sep_frame] = {"phraseId": phrase_id}
        if mode != "phone" or phrase_index >= len(phrase_audits):
            continue

        h_alignment = phrase_audits[phrase_index].get("hAlignment") or {}
        phone_events = h_alignment.get("phone_events") or []
        lyric_tokens = [int(token) for token in phrase.get("tokens") or []]
        relative_frames = [int(frame) for frame in candidate.get("relative_frames") or []]
        if len(phone_events) != len(lyric_tokens) or len(relative_frames) < len(lyric_tokens):
            continue
        if [int(event.get("token_id", -1)) for event in phone_events] != lyric_tokens:
            continue
        start, _ = phrase_frame_range(phrase, frame_count)
        for phone_index, (phone_event, relative_frame) in enumerate(
            zip(phone_events, relative_frames)
        ):
            frame = start + relative_frame
            if not 0 <= frame < frame_count:
                raise AssertionError("attributed H phone escaped B-local frame contract")
            event_attribution[frame] = {
                "phraseId": phrase_id,
                "moraIndex": int(phone_event["mora_index"]),
                "phoneIndex": phone_index,
            }

            if region["HAlignment"].get("boundaryMode") == "kana-hard":
                kana_unit = phrase["kanaUnits"][int(phone_event["mora_index"])]
                if not int(kana_unit["startFrame"]) <= frame < int(kana_unit["endFrameExclusive"]):
                    raise AssertionError("rendered H token escaped its hard Kana boundary")

    events = []
    for frame, token_id in enumerate(dense):
        token_id = int(token_id)
        if token_id == 0:
            continue
        if token_id == SEP_TOKEN_ID:
            symbol = "<SEP>"
        elif token_id == PUL_TOKEN_ID:
            symbol = "<PUL>"
        elif token_id in inverse_vocab:
            symbol = inverse_vocab[token_id]
        else:
            raise ValueError(f"rendered unknown runtime token ID {token_id}")
        event = {
            "id": f"h:{frame}:{token_id}",
            "frame": frame,
            "tokenId": token_id,
            "symbol": symbol,
            "origin": "segment-align",
        }
        event.update(event_attribution.get(frame) or {})
        events.append(event)
    return events, {
        "phonePhraseCount": rendered["phone_phrase_count"],
        "pulPhraseCount": rendered["pul_phrase_count"],
        "exactControlPhraseCount": rendered["exact_control_phrase_count"],
        "pulFrameCount": rendered["pul_frame_count"],
        "lockedEventTokenSHA256": rendered["locked_event_token_sha256"],
        "phraseModes": phrase_modes,
    }


def main():
    args = parse_args()
    if args.frame_count < 1:
        raise ValueError("frame-count must be positive")
    alignment = json.loads(args.alignment.read_text(encoding="utf-8"))
    if alignment.get("schema") != "aisvc.v4h-web-alignment.v1" or not alignment.get("B"):
        raise ValueError("expected a B-local bounded alignment")

    runtime = args.runtime.resolve()
    if not (runtime / "h_alignment" / "placement.py").is_file():
        raise FileNotFoundError(f"runtime root has no h_alignment/placement.py: {runtime}")
    sys.path.insert(0, str(runtime))
    from h_alignment.placement import render_h_pul_placements, solve_monotonic_frames

    vocab = json.loads(args.vocab.read_text(encoding="utf-8"))["vocab"]
    inverse_vocab = {int(raw_id) + 1: token for token, raw_id in vocab.items()}
    units, boundaries, phrase_ranges = compile_kana(
        alignment["B"], args.frame_count, solve_monotonic_frames
    )
    events, h_audit = compile_h(
        alignment["B"], args.frame_count, render_h_pul_placements, inverse_vocab
    )
    h_audit["boundaryMode"] = (
        (alignment["B"].get("HAlignment") or {}).get("boundaryMode") or "free"
    )
    payload = {
        "schema": SCHEMA,
        "frameRate": FRAME_RATE,
        "frameCount": args.frame_count,
        "kanaUnits": units,
        "kanaBoundaries": boundaries,
        "phraseRanges": phrase_ranges,
        "hEvents": events,
        "hAudit": h_audit,
        "runtimeHashes": alignment.get("hashes"),
        "alignmentSummary": alignment.get("summary"),
        "compilerSHA256": sha256_file(Path(__file__)),
    }
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(
        json.dumps(payload, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )
    print(json.dumps({"type": "complete", "output": str(args.output), **h_audit}), flush=True)
    return 0


if __name__ == "__main__":
    try:
        sys.exit(main())
    except Exception as error:
        print(json.dumps({"type": "error", "message": str(error)}, ensure_ascii=False), flush=True)
        raise
