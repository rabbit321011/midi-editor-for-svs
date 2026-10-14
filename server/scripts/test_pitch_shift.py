import copy
import json
from pathlib import Path
import sys
import unittest

import torch

sys.path.insert(0, str(Path(__file__).parent))
import v5p_direct_runner as runner
import v5p_direct_control as direct
import f1_runtime
from test_v5p_direct_runner import build_job


class PitchShiftTests(unittest.TestCase):
    def test_half_semitone_classes_rest_and_input_immutability(self):
        classes = [120, 121, 255, 130]
        self.assertEqual(runner.shift_pitch_classes(classes, 12), [144, 145, 255, 154])
        self.assertEqual(runner.shift_pitch_classes(classes, -12), [96, 97, 255, 106])
        self.assertEqual(classes, [120, 121, 255, 130])
        for pitches, shift in (([254], 1), ([0], -1), ([256], 0), ([120], 0.5), ([120], 25), ([120], True)):
            with self.subTest(pitches=pitches, shift=shift), self.assertRaises(ValueError):
                runner.shift_pitch_classes(pitches, shift)

    def test_runner_transposes_only_b_and_keeps_the_snapshot_transport_original(self):
        for shift in (-12, 0, 12):
            job = build_job()
            job["render"]["pitchShiftSemitones"] = shift
            original = copy.deepcopy(job)
            validated = runner.validate_job(job, direct)
            before = json.loads(job["snapshotCanonical"])["midiPTransport"]["classIds"]
            start = validated["midiTransport"]["targetStartFrame"]
            end = validated["midiTransport"]["targetEndFrameExclusive"]
            after = validated["midiTransport"]["classIds"]
            self.assertEqual(after[:start], before[:start])
            self.assertEqual(after[end:], before[end:])
            self.assertEqual(after[start:end], [120 + shift * 2] * (end - start))
            self.assertEqual(job, original)

    def test_f1_uses_the_same_b_shift_but_keeps_its_zero_pad_embedding(self):
        class Policy:
            midi_p_v4ph = torch.nn.Embedding(257, 128, padding_idx=256)
        validated = {
            "snapshot": {
                "reference": {"text": {"denseHTokens": [46, 365]}},
                "target": {"text": {"denseHTokens": [211, 366, 365]}, "midiP": {"classes": [120, 255, 121]}},
            },
            "frameMap": {"reference": {"ownedFrameCount": 2}, "target": {"ownedFrameCount": 3},
                         "bOffsetFrame": 3, "totalFrameCount": 8},
            "pitchShiftSemitones": 12,
        }
        before = copy.deepcopy(validated)
        text, midi, classes = f1_runtime.build_controls(Policy(), validated, "cpu")
        self.assertEqual(classes.tolist(), [[256, 256, 256, 144, 255, 145, 256, 256]])
        self.assertEqual(midi[:, :3].count_nonzero(), 0)
        self.assertEqual(midi[:, 6:].count_nonzero(), 0)
        self.assertEqual(validated, before)

    def test_sg_requires_a_shifted_copy_bound_to_the_original_guide_and_semitones(self):
        job = build_job()
        snapshot = json.loads(job["snapshotCanonical"])
        del snapshot["target"]["midiP"]
        del snapshot["midiPTransport"]
        snapshot["target"]["melody"] = {"source": "guide-some", "guideSHA256": "a" * 64, "frameCount": 64}
        job["snapshotCanonical"] = runner.canonical_json(snapshot)
        job["snapshotSHA256"] = runner.sha256_text(job["snapshotCanonical"])
        job["preset"]["id"] = "V5Sg_40K_EMA"
        path = Path(__file__).with_name("pgo_guidance.py")
        job["resources"] = {"pgoGuidance": {"path": str(path), "sha256": runner.sha256_file(path)}}
        job["render"]["pitchShiftSemitones"] = -12
        with self.assertRaisesRegex(ValueError, "shifted Guide"):
            runner.validate_job(job, direct)
        shifted = {"wav": "derived.wav", "sha256": "f" * 64, "sourceSHA256": "a" * 64,
                   "sampleRate": 44100, "sampleCount": 131072, "semitones": -12}
        job["inputs"]["shiftedMelody"] = shifted
        validated = runner.validate_job(job, direct)
        self.assertEqual(validated["shiftedMelody"], shifted)
        self.assertIsNone(validated["midiTransport"])
        shifted["semitones"] = 12
        with self.assertRaisesRegex(ValueError, "metadata"):
            runner.validate_job(job, direct)


if __name__ == "__main__":
    unittest.main()
