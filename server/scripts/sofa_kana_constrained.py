#!/usr/bin/env python3
"""Kana-bounded decoding on top of SOFA's native acoustic logits."""

import math

import numpy as np


def constrained_decode(model, ph_seq_id, ph_prob_log, edge_prob, phoneme_to_word, word_bounds):
    """Run SOFA's monotonic DP while masking lexical states by Kana bounds."""
    frame_length = model.melspec_config["hop_length"] / (
        model.melspec_config["sample_rate"] * model.melspec_config["scale_factor"]
    )
    total_frames = ph_prob_log.shape[0]
    state_count = len(ph_seq_id)
    if len(phoneme_to_word) != state_count:
        raise ValueError("SOFA phoneme/Kana attribution length mismatch")
    state_mask = np.ones((total_frames, state_count), dtype=np.bool_)
    for state_index, word_index in enumerate(phoneme_to_word):
        if word_index < 0:
            continue
        if word_index >= len(word_bounds):
            raise ValueError("SOFA phoneme points outside KanaUnit bounds")
        start_seconds, end_seconds = word_bounds[word_index]
        start_frame = max(0, int(math.floor(start_seconds / frame_length + 1e-7)))
        end_frame = min(total_frames, int(math.ceil(end_seconds / frame_length - 1e-7)))
        if end_frame <= start_frame:
            raise ValueError(f"Kana {word_index + 1} is too narrow for one SOFA frame")
        state_mask[:, state_index] = False
        state_mask[start_frame:end_frame, state_index] = True
    return _decode_with_state_mask(
        model.inference_mode,
        np.asarray(ph_seq_id),
        ph_prob_log,
        edge_prob,
        state_mask,
    )


def predict_with_kana_bounds(model, audio_path, phonemes, words, phoneme_to_word, word_bounds, batch_index=0):
    if len(words) != len(word_bounds):
        raise ValueError(f"SOFA mora count {len(words)} != KanaUnit count {len(word_bounds)}")
    phonemes, phoneme_to_word = _insert_optional_sp_between_words(
        phonemes,
        phoneme_to_word,
    )
    original_decode = model._decode

    def decode(ph_seq_id, ph_prob_log, edge_prob):
        return constrained_decode(
            model,
            ph_seq_id,
            ph_prob_log,
            edge_prob,
            phoneme_to_word,
            word_bounds,
        )

    model._decode = decode
    try:
        return model.predict_step(
            (audio_path, phonemes, words, phoneme_to_word),
            batch_index,
        )
    finally:
        model._decode = original_decode


def _insert_optional_sp_between_words(phonemes, phoneme_to_word):
    if len(phonemes) != len(phoneme_to_word):
        raise ValueError("SOFA phoneme/Kana attribution length mismatch")
    output_phones = []
    output_words = []
    previous_word = -1
    for phone, word_index in zip(phonemes, phoneme_to_word):
        if word_index >= 0 and previous_word >= 0 and word_index != previous_word:
            if not output_phones or output_phones[-1] != "SP":
                output_phones.append("SP")
                output_words.append(-1)
        output_phones.append(phone)
        output_words.append(word_index)
        if word_index >= 0:
            previous_word = word_index
    return output_phones, output_words


def constrain_prediction_intervals(prediction, phone_events, word_bounds):
    """Clip SOFA sub-frame interpolation to the same hard Kana contract."""
    (
        wav_path, duration, confidence, phones, phone_intervals,
        words, word_intervals,
    ) = prediction
    phones, phone_intervals = _restore_missing_sokuon_phones(
        phones,
        phone_intervals,
        phone_events,
        word_bounds,
    )
    bounded_phone_intervals = np.asarray(phone_intervals, dtype=np.float64).copy()
    for phone_index, event in enumerate(phone_events):
        mora_index = int(event["mora_index"])
        bound_start, bound_end = word_bounds[mora_index]
        bounded_phone_intervals[phone_index, 0] = max(
            float(bounded_phone_intervals[phone_index, 0]),
            float(bound_start),
        )
        bounded_phone_intervals[phone_index, 1] = min(
            float(bounded_phone_intervals[phone_index, 1]),
            float(bound_end),
        )
        if bounded_phone_intervals[phone_index, 1] <= bounded_phone_intervals[phone_index, 0]:
            raise ValueError(
                f"SOFA phone {phones[phone_index]} has no positive interval inside Kana {mora_index + 1}"
            )
    # Current KanaUnit labels and bounds are authoritative in hard-Kana mode.
    # SOFA may omit the lexical row for a sokuon even when the acoustic path is
    # otherwise valid, so do not rebuild this tier from its returned words.
    labels_by_mora = {}
    for event in phone_events:
        labels_by_mora.setdefault(
            int(event["mora_index"]),
            str(event.get("katakana") or event.get("kana") or ""),
        )
    if set(labels_by_mora) != set(range(len(word_bounds))):
        raise ValueError("hard Kana frontend has no lexical label for every KanaUnit")
    bounded_words = np.asarray([labels_by_mora[index] for index in range(len(word_bounds))])
    bounded_word_intervals = np.asarray(word_bounds, dtype=np.float64).copy()
    return (
        wav_path, duration, confidence, phones, bounded_phone_intervals,
        bounded_words, bounded_word_intervals,
    )


def _restore_missing_sokuon_phones(phones, phone_intervals, phone_events, word_bounds):
    """Accept SOFA's training-side exception where only lexical `cl` is absent."""
    observed_phones = [str(phone) for phone in phones]
    observed_intervals = np.asarray(phone_intervals, dtype=np.float64)
    restored_phones = []
    restored_intervals = []
    observed_index = 0

    for expected_index, event in enumerate(phone_events):
        expected = str(event.get("sofa_phone") or "")
        observed = observed_phones[observed_index] if observed_index < len(observed_phones) else None
        if expected and observed == expected:
            restored_phones.append(observed)
            restored_intervals.append(observed_intervals[observed_index])
            observed_index += 1
            continue
        if expected == "cl":
            mora_index = int(event["mora_index"])
            restored_phones.append("cl")
            restored_intervals.append(np.asarray(word_bounds[mora_index], dtype=np.float64))
            continue
        raise ValueError(
            "constrained SOFA phone sequence mismatch before postprocess: "
            f"expected {expected or '<unknown>'} at {expected_index + 1}, "
            f"observed {observed or '<missing>'}"
        )

    if observed_index != len(observed_phones):
        raise ValueError(
            "constrained SOFA returned unexpected extra phones before postprocess: "
            f"{len(observed_phones) - observed_index}"
        )
    return np.asarray(restored_phones), np.asarray(restored_intervals, dtype=np.float64)


def _decode_with_state_mask(inference_mode, ph_seq_id, ph_prob_log, edge_prob, state_mask):
    total_frames = ph_prob_log.shape[0]
    state_count = len(ph_seq_id)
    if state_mask.shape != (total_frames, state_count):
        raise ValueError("SOFA constrained state mask shape mismatch")
    prob_log = ph_prob_log[:, ph_seq_id]
    edge_prob_log = np.log(edge_prob + 1e-6).astype("float32")
    not_edge_prob_log = np.log(1 - edge_prob + 1e-6).astype("float32")
    current_max = np.full(state_count, -np.inf, dtype="float32")
    dp = np.full((total_frames, state_count), -np.inf, dtype="float32")
    backtrack = np.full((total_frames, state_count), -1, dtype="int32")

    if inference_mode == "force":
        if state_mask[0, 0]:
            dp[0, 0] = prob_log[0, 0]
            current_max[0] = prob_log[0, 0]
        if ph_seq_id[0] == 0 and state_count > 1 and state_mask[0, 1]:
            dp[0, 1] = prob_log[0, 1]
            current_max[1] = prob_log[0, 1]
    elif inference_mode == "match":
        for state_index in range(state_count):
            if state_mask[0, state_index]:
                dp[0, state_index] = prob_log[0, state_index]
                current_max[state_index] = prob_log[0, state_index]
    else:
        raise ValueError("SOFA inference_mode must be force or match")

    skip = 2 if state_count >= 2 else 1
    scale = total_frames / max(state_count, 1)
    for frame in range(1, total_frames):
        for state in range(state_count):
            if not state_mask[frame, state]:
                continue
            candidates = [
                dp[frame - 1, state] + prob_log[frame, state] + not_edge_prob_log[frame],
                -np.inf,
                -np.inf,
            ]
            if state >= 1:
                source = state - 1
                candidates[1] = (
                    dp[frame - 1, source]
                    + prob_log[frame, source]
                    + edge_prob_log[frame]
                    + current_max[source] * scale
                )
            if state >= skip:
                source = state - skip
                if not (source + 1 < state_count - 1 and ph_seq_id[source + 1] != 0):
                    candidates[2] = (
                        dp[frame - 1, source]
                        + prob_log[frame, source]
                        + edge_prob_log[frame]
                        + current_max[source] * scale
                    )
            choice = int(np.argmax(candidates))
            dp[frame, state] = candidates[choice]
            backtrack[frame, state] = choice

        next_max = np.full(state_count, -np.inf, dtype="float32")
        for state in range(state_count):
            if not state_mask[frame, state] or not np.isfinite(dp[frame, state]):
                continue
            if backtrack[frame, state] == 0:
                next_max[state] = max(current_max[state], prob_log[frame, state])
            else:
                next_max[state] = prob_log[frame, state]
            if ph_seq_id[state] == 0:
                next_max[state] = 0
        current_max = next_max

    if inference_mode == "force":
        candidates = [state_count - 1]
        if state_count >= 2 and ph_seq_id[-1] == 0:
            candidates.append(state_count - 2)
        finite = [state for state in candidates if np.isfinite(dp[-1, state])]
        if not finite:
            raise ValueError("No SOFA alignment path satisfies every Kana boundary")
        state = max(finite, key=lambda value: dp[-1, value])
    else:
        finite = np.flatnonzero(np.isfinite(dp[-1]))
        if len(finite) == 0:
            raise ValueError("No SOFA alignment path satisfies every Kana boundary")
        state = int(finite[np.argmax(dp[-1, finite])])

    phone_states = []
    phone_frames = []
    confidence = []
    for frame in range(total_frames - 1, -1, -1):
        if not state_mask[frame, state]:
            raise AssertionError("SOFA constrained backtrack escaped Kana boundary")
        confidence.append(dp[frame, state])
        if frame == 0:
            phone_states.append(state)
            phone_frames.append(0)
            break
        transition = backtrack[frame, state]
        if transition < 0:
            raise ValueError("SOFA constrained path has no valid predecessor")
        if transition != 0:
            phone_states.append(state)
            phone_frames.append(frame)
            state -= transition
        if state < 0:
            raise ValueError("SOFA constrained backtrack became invalid")
    phone_states.reverse()
    phone_frames.reverse()
    confidence.reverse()
    confidence = np.exp(np.diff(np.pad(confidence, (1, 0), "constant")))
    return np.asarray(phone_states), np.asarray(phone_frames), np.asarray(confidence)
