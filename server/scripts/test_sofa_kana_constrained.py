import importlib.util
from pathlib import Path
import unittest

import numpy as np


MODULE_PATH = Path(__file__).with_name("sofa_kana_constrained.py")
SPEC = importlib.util.spec_from_file_location("sofa_kana_constrained", MODULE_PATH)
MODULE = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(MODULE)


class FakeModel:
    inference_mode = "force"
    melspec_config = {
        "hop_length": 1,
        "sample_rate": 1,
        "scale_factor": 1,
    }


class KanaConstrainedDecodeTests(unittest.TestCase):
    def test_lexical_states_never_escape_kana_bounds(self):
        model = FakeModel()
        ph_seq_id = np.array([0, 1, 2, 0, 3, 4, 0])
        logits = np.full((10, 5), -8.0, dtype=np.float32)
        logits[:, 0] = -1.0
        logits[0:5, 1] = 4.0
        logits[0:5, 2] = 4.0
        logits[5:10, 3] = 4.0
        logits[5:10, 4] = 4.0
        edge = np.full(10, 0.5, dtype=np.float32)
        states, frames, _ = MODULE.constrained_decode(
            model,
            ph_seq_id,
            logits,
            edge,
            [-1, 0, 0, -1, 1, 1, -1],
            [(1, 4), (6, 9)],
        )
        for state, frame in zip(states, frames):
            word = [-1, 0, 0, -1, 1, 1, -1][state]
            if word == 0:
                self.assertGreaterEqual(frame, 1)
                self.assertLess(frame, 4)
            if word == 1:
                self.assertGreaterEqual(frame, 6)
                self.assertLess(frame, 9)

    def test_impossible_boundaries_have_no_path(self):
        model = FakeModel()
        with self.assertRaisesRegex(ValueError, "No SOFA alignment path"):
            MODULE.constrained_decode(
                model,
                np.array([0, 1, 2, 0]),
                np.zeros((3, 3), dtype=np.float32),
                np.full(3, 0.5, dtype=np.float32),
                [-1, 0, 0, -1],
                [(1, 1.1)],
            )

    def test_inserts_optional_sp_between_moras(self):
        phones, words = MODULE._insert_optional_sp_between_words(
            ["SP", "k", "i", "m", "i", "SP"],
            [-1, 0, 0, 1, 1, -1],
        )
        self.assertEqual(phones, ["SP", "k", "i", "SP", "m", "i", "SP"])
        self.assertEqual(words, [-1, 0, 0, -1, 1, 1, -1])

    def test_clamps_fractional_sofa_intervals_without_moving_phone_order(self):
        prediction = (
            "fixture.wav", 1.0, 0.9,
            np.array(["k", "o", "t", "o"]),
            np.array([[0.0, 0.12], [0.12, 0.31], [0.29, 0.41], [0.41, 0.61]]),
            np.array(["こ", "と"]),
            np.array([[0.0, 0.31], [0.29, 0.61]]),
        )
        frontend = {"phone_events": [
            {"sofa_phone": "k", "mora_index": 0, "katakana": "コ"},
            {"sofa_phone": "o", "mora_index": 0, "katakana": "コ"},
            {"sofa_phone": "t", "mora_index": 1, "katakana": "ト"},
            {"sofa_phone": "o", "mora_index": 1, "katakana": "ト"},
        ]}
        bounded = MODULE.constrain_prediction_intervals(
            prediction,
            frontend["phone_events"],
            [(0.0, 0.30), (0.30, 0.60)],
        )
        np.testing.assert_allclose(bounded[4], [
            [0.0, 0.12], [0.12, 0.30], [0.30, 0.41], [0.41, 0.60],
        ])
        np.testing.assert_allclose(bounded[6], [[0.0, 0.30], [0.30, 0.60]])

    def test_restores_only_a_missing_sokuon_inside_its_kana_bound(self):
        phones, intervals = MODULE._restore_missing_sokuon_phones(
            np.array(["a", "t", "e"]),
            np.array([[0.0, 0.2], [0.3, 0.4], [0.4, 0.6]]),
            [
                {"sofa_phone": "a", "mora_index": 0},
                {"sofa_phone": "cl", "mora_index": 1},
                {"sofa_phone": "t", "mora_index": 2},
                {"sofa_phone": "e", "mora_index": 2},
            ],
            [(0.0, 0.2), (0.2, 0.3), (0.3, 0.6)],
        )
        self.assertEqual(phones.tolist(), ["a", "cl", "t", "e"])
        np.testing.assert_allclose(intervals[1], [0.2, 0.3])

    def test_rejects_a_missing_non_sokuon_phone(self):
        with self.assertRaisesRegex(ValueError, "phone sequence mismatch"):
            MODULE._restore_missing_sokuon_phones(
                np.array(["a", "e"]),
                np.array([[0.0, 0.2], [0.4, 0.6]]),
                [
                    {"sofa_phone": "a", "mora_index": 0},
                    {"sofa_phone": "t", "mora_index": 1},
                    {"sofa_phone": "e", "mora_index": 1},
                ],
                [(0.0, 0.2), (0.2, 0.6)],
            )


if __name__ == "__main__":
    unittest.main()
