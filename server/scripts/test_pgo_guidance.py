import sys
import copy
from pathlib import Path
from types import SimpleNamespace
import unittest

import torch

sys.path.insert(0, str(Path(__file__).resolve().parent))
import pgo_guidance


class PgOGuidanceTest(unittest.TestCase):
    def test_grouping_modes_match_h_adjacency_not_frame_distance(self):
        dense = [32, 0, 30, 0, 56, 0, 33, 366, 0, 34, 0, 365, 0, 35]
        events = [{"eventId": str(frame), "localFrame": frame, "jointFrame": 20 + frame,
                   "tokenId": dense[frame], "weight": -0.3} for frame in (0, 2, 6, 9, 13)]
        def frames(mode):
            return [[event["localFrame"] for event in group["events"]]
                    for group in pgo_guidance.group_token_weights(list(reversed(events)), mode, dense)]
        self.assertEqual(frames("none"), [[0], [2], [6], [9], [13]])
        self.assertEqual(frames("same-weight"), [[0, 2, 6, 9, 13]])
        self.assertEqual(frames("adjacent"), [[0, 2], [6], [9], [13]])
        self.assertEqual(pgo_guidance.group_token_weights([], "adjacent", dense), [])
        with self.assertRaisesRegex(ValueError, "merge mode"):
            pgo_guidance.group_token_weights(events, "both", dense)

    def test_grouped_reference_forwards_mask_whole_groups_without_cross_reference_subtraction(self):
        dense = [32, 0, 30, 56, 33, 366, 365]
        events = [{"localFrame": frame, "jointFrame": frame + 2, "tokenId": dense[frame], "weight": 0.3}
                  for frame in (0, 2, 4)]
        text = torch.tensor([[46, 365, *dense]])
        for mode, count, local_masks in [
            ("none", 7, [[0], [2], [4]]),
            ("same-weight", 5, [[0, 2, 4]]),
            ("adjacent", 6, [[0, 2], [4]]),
        ]:
            with self.subTest(mode=mode):
                groups = pgo_guidance.group_token_weights(events, mode, dense)
                calls = []
                def number(kw):
                    reference = int(kw["cond"][0, 0, 0])
                    remaining = int((kw["text"][:, [2, 4, 5, 6]] > 0).sum())
                    return ((0 if kw["drop_audio_cond"] else reference * 2)
                            + (0 if kw["drop_text"] else reference * remaining ** 2)
                            + (0 if kw["drop_midi"] else 5))
                class Transformer:
                    def forward(self, **kw):
                        calls.append({**kw, "text": kw["text"].clone()})
                        return torch.tensor([[float(number(kw))]]), None
                    def clear_cache(self):
                        pass
                plans = [{"audioCfg": cfg, "text": text.clone(),
                          "fullCond": torch.full((1, 9, 2), float(i + 1))}
                         for i, cfg in enumerate((0.5, 0.3))]
                policy = SimpleNamespace(transformer=Transformer())
                with pgo_guidance.dual_cfg(policy, plans, {"text": 0.7, "midi": 0.5}, text, events, groups):
                    result, _ = policy.transformer.forward(cfg_infer=True, text=text)
                self.assertEqual(len(calls), count * 2)
                expected = 0.0
                for i, weight in enumerate((1.5, 1.3)):
                    branch_calls = calls[i * count:(i + 1) * count]
                    full, no_a, no_t, no_m = [number(call) for call in branch_calls[:4]]
                    correction = 0
                    for call, mask in zip(branch_calls[4:], local_masks):
                        self.assertFalse(call["drop_audio_cond"] or call["drop_text"] or call["drop_midi"])
                        self.assertFalse(call["cache"])
                        self.assertEqual(int(call["cond"][0, 0, 0]), i + 1)
                        masked = text.clone()
                        masked[:, [frame + 2 for frame in mask]] = 0
                        torch.testing.assert_close(call["text"], masked)
                        correction += 0.7 * (number(call) - full)
                    expected += weight / 2.8 * (no_a + 2.8 * (full - no_a)
                                                + 0.7 * (full - no_t) + 0.5 * (full - no_m) + correction)
                torch.testing.assert_close(result, torch.tensor([[expected], [expected]]))

    def test_single_token_correction_preserves_four_h_types_and_direction(self):
        text = torch.tensor([[46, 365, 0, 0, 32, 30, 56, 366, 365, 0]])
        x, time = torch.ones(1, 10, 2), torch.tensor(0.5)
        calls = []
        class Transformer:
            def forward(self, **kw):
                assert kw["cache"] is False
                assert kw["x"] is x and kw["time"] is time
                calls.append({**kw, "text": kw["text"].clone()})
                count = (kw["text"][:, 4:7] != 0).sum().float()
                value = (0 if kw["drop_audio_cond"] else 2) + (0 if kw["drop_text"] else count * 3) + (0 if kw["drop_midi"] else 5)
                return torch.ones(1, 10, 2) * value, None
            def clear_cache(self):
                pass
        weights = [{"jointFrame": frame, "tokenId": int(text[0, frame]), "weight": weight}
                   for frame, weight in zip((4, 5, 6), (1.2, 0.9, 0.3))]
        transformer = Transformer()
        with pgo_guidance.independent_cfg(SimpleNamespace(transformer=transformer),
                                          {"audio": 0.5, "text": 0.7, "midi": 0.5}, weights):
            actual, _ = transformer.forward(cfg_infer=True, cache=True, text=text, x=x, time=time)
        # F=16; CFG adds 1 + 6.3 + 2.5. Local delta=(.2-.1-.7)*3=-1.8.
        torch.testing.assert_close(actual, torch.full((2, 10, 2), 24.0))
        self.assertEqual(len(calls), 7)
        for call, frame in zip(calls[4:], (4, 5, 6)):
            expected = text.clone()
            expected[:, frame] = 0
            torch.testing.assert_close(call["text"], expected)
            self.assertFalse(call["drop_audio_cond"] or call["drop_text"] or call["drop_midi"])
        self.assertEqual(text.tolist(), [[46, 365, 0, 0, 32, 30, 56, 366, 365, 0]])

    def test_multi_reference_corrections_are_computed_inside_each_reference(self):
        b = torch.tensor([[0, 0, 0, 0, 32, 30, 56, 366, 365, 0]])
        texts = [b.clone(), b.clone()]
        texts[0][0, 0], texts[1][0, 0] = 46, 211
        calls = []
        class Transformer:
            def forward(self, **kw):
                assert kw["cache"] is False
                reference = int(kw["cond"][0, 0, 0])
                assert torch.equal(kw["text"][:, :4], texts[reference - 1][:, :4])
                calls.append((reference, kw["text"].clone(), kw["drop_audio_cond"], kw["drop_text"], kw["drop_midi"]))
                count = int((kw["text"][:, 4:7] != 0).sum())
                value = (0 if kw["drop_audio_cond"] else reference * 2) + (0 if kw["drop_text"] else count * reference * 3) + (0 if kw["drop_midi"] else 5)
                return torch.tensor([[float(value)]]), None
            def clear_cache(self):
                pass
        weights = [{"jointFrame": frame, "tokenId": int(b[0, frame]), "weight": weight}
                   for frame, weight in zip((4, 5, 6), (1.2, 0.9, 0.3))]
        plans = [{"audioCfg": cfg, "text": text, "fullCond": torch.full((1, 10, 2), float(index + 1))}
                 for index, (cfg, text) in enumerate(zip((0.5, 0.3), texts))]
        policy = SimpleNamespace(transformer=Transformer())
        with pgo_guidance.dual_cfg(policy, plans, {"text": 0.7, "midi": 0.5}, b, weights):
            actual, _ = policy.transformer.forward(cfg_infer=True, cache=True, text=b)
        # Each G_i=N_i+2.8*D_A_i+.7*D_T_i+.5*D_M_i+C_i.
        expected = (1.5 / 2.8) * (14 + 2.8 * 2 + 0.7 * 9 + 0.5 * 5 - 1.8)
        expected += (1.3 / 2.8) * (23 + 2.8 * 4 + 0.7 * 18 + 0.5 * 5 - 3.6)
        torch.testing.assert_close(actual, torch.tensor([[expected], [expected]]))
        self.assertEqual([call[0] for call in calls], [1] * 7 + [2] * 7)
        for index in range(2):
            for call, frame in zip(calls[index * 7 + 4:index * 7 + 7], (4, 5, 6)):
                expected_text = texts[index].clone()
                expected_text[:, frame] = 0
                torch.testing.assert_close(call[1], expected_text)

    def test_weight_validation_uses_only_b_phonemes_and_ignores_defaults(self):
        snapshot = {
            "reference": {"text": {"hEvents": []}},
            "frameMap": {"bOffsetFrame": 10},
            "target": {"text": {"denseHTokens": [32, 366, 365, 0],
                                "hEvents": [{"id": "ko", "frame": 0, "tokenId": 32, "guidanceWeight": 0.3}]}},
        }
        expected = [{"eventId": "ko", "localFrame": 0, "jointFrame": 10, "tokenId": 32, "weight": 0.3}]
        self.assertEqual(pgo_guidance.validate_token_weights(snapshot), expected)
        for weight in (-10, -1, -0.1, 0, 10):
            allowed = copy.deepcopy(snapshot)
            allowed["target"]["text"]["hEvents"][0]["guidanceWeight"] = weight
            self.assertEqual(pgo_guidance.validate_token_weights(allowed)[0]["weight"], weight)
        for weight in (-10.1, 11, float("nan"), float("inf"), True, "0.3"):
            bad = copy.deepcopy(snapshot)
            bad["target"]["text"]["hEvents"][0]["guidanceWeight"] = weight
            with self.subTest(weight=weight), self.assertRaises(ValueError):
                pgo_guidance.validate_token_weights(bad)
        for frame in (1, 2, 3):
            bad = copy.deepcopy(snapshot)
            bad["target"]["text"]["hEvents"][0].update(frame=frame, tokenId=bad["target"]["text"]["denseHTokens"][frame])
            with self.subTest(frame=frame), self.assertRaises(ValueError):
                pgo_guidance.validate_token_weights(bad)
        bad = copy.deepcopy(snapshot)
        bad["reference"]["text"]["hEvents"] = [copy.deepcopy(bad["target"]["text"]["hEvents"][0])]
        with self.assertRaisesRegex(ValueError, "A snapshots"):
            pgo_guidance.validate_token_weights(bad)
        snapshot["target"]["text"]["hEvents"][0]["guidanceWeight"] = 1
        self.assertEqual(pgo_guidance.validate_token_weights(snapshot), [])

    def test_negative_weight_extrapolates_the_correction_without_negative_h_ids(self):
        text = torch.tensor([[46, 365, 0, 32, 366, 365]])
        calls = []
        def forward(**kw):
            calls.append(kw["text"].clone())
            self.assertFalse(kw["drop_text"])
            self.assertGreaterEqual(int(kw["text"].min()), 0)
            return torch.tensor([[8.0 if kw["text"][0, 3] == 32 else 6.0]]), None
        correction = pgo_guidance.token_weight_correction(
            forward, {"text": text, "cache": False}, torch.tensor([[8.0]]),
            [{"jointFrame": 3, "tokenId": 32, "weight": -1}],
        )
        torch.testing.assert_close(correction, torch.tensor([[-4.0]]))
        self.assertEqual(calls[0].tolist(), [[46, 365, 0, 0, 366, 365]])
        self.assertEqual(text.tolist(), [[46, 365, 0, 32, 366, 365]])

    def test_masking_failure_restores_forward_and_clears_cache(self):
        class Transformer:
            def __init__(self):
                self.cleared = False
            def forward(self, **kw):
                if kw["text"][0, 1] == 0:
                    raise RuntimeError("masked failure")
                return torch.ones(1, 2, 1), None
            def clear_cache(self):
                self.cleared = True
        transformer = Transformer()
        original = transformer.forward
        with self.assertRaisesRegex(RuntimeError, "masked failure"):
            with pgo_guidance.independent_cfg(
                SimpleNamespace(transformer=transformer), {"audio": 0.5, "text": 0.7, "midi": 0.5},
                [{"jointFrame": 1, "tokenId": 32, "weight": 0.3}],
            ):
                transformer.forward(cfg_infer=True, text=torch.tensor([[46, 32]]))
        self.assertEqual(transformer.forward, original)
        self.assertTrue(transformer.cleared)

    def test_no_a_mode_still_uses_b_local_blank_correction(self):
        text = torch.tensor([[0, 0, 32, 366, 365]])
        calls = []
        class Transformer:
            def forward(self, **kw):
                self_outer.assertTrue(kw["drop_audio_cond"])
                self_outer.assertEqual(kw["cond"].count_nonzero().item(), 0)
                calls.append(kw["text"].clone())
                return torch.tensor([[float((kw["text"] != 0).sum())]]), None
            def clear_cache(self):
                pass
        self_outer = self
        policy = SimpleNamespace(transformer=Transformer())
        with pgo_guidance.dual_cfg(policy, [{"audioCfg": -1}, {"audioCfg": -1}],
                                   {"text": 0, "midi": 0}, text,
                                   [{"jointFrame": 2, "tokenId": 32, "weight": 0.3}]):
            value, _ = policy.transformer.forward(cfg_infer=True, text=text, cond=torch.ones(1, 5, 2))
        torch.testing.assert_close(value, torch.tensor([[2.3], [2.3]]))
        self.assertEqual(len(calls), 2)
        self.assertEqual(calls[-1].tolist(), [[0, 0, 0, 366, 365]])

    def test_independent_formula_and_forward_restoration(self):
        class Transformer:
            def forward(self, **kwargs):
                drops = (kwargs["drop_audio_cond"], kwargs["drop_text"], kwargs["drop_midi"])
                return torch.tensor([[{(False, False, False): 8, (True, False, False): 6,
                                       (False, True, False): 5, (False, False, True): 4}[drops]]], dtype=torch.float32), None

            def clear_cache(self):
                pass
        transformer = Transformer()
        policy = SimpleNamespace(transformer=transformer)
        original = transformer.forward
        guidance = {"audio": 0.4, "text": 0.6, "midi": 0.5}
        with pgo_guidance.independent_cfg(policy, guidance):
            value, _ = transformer.forward(cfg_infer=True)
        torch.testing.assert_close(value, torch.tensor([[12.6], [12.6]]))
        self.assertEqual(transformer.forward, original)

    def test_one_and_duplicate_reference_reduce_to_independent_cfg(self):
        values = [torch.tensor([[value]], dtype=torch.float32) for value in (8, 6, 5, 4)]
        expected = values[0] + 0.5 * (values[0] - values[1]) + 0.6 * (values[0] - values[2]) + 0.5 * (values[0] - values[3])
        torch.testing.assert_close(pgo_guidance.combine_reference_predictions([values, None], [1.5, 0], 0.6, 0.5), expected)
        torch.testing.assert_close(pgo_guidance.combine_reference_predictions([values, values], [0.3, 1.2], 0.6, 0.5), expected)
        torch.testing.assert_close(pgo_guidance.combine_reference_predictions([values] * 3, [0.3, 0.4, 0.8], 0.6, 0.5), expected)

    def test_all_disabled_uses_zero_audio_and_b_only_text(self):
        b_text = torch.tensor([[0, 0, 46, 365]])
        calls = []
        class Transformer:
            def forward(self, **kwargs):
                self_outer.assertTrue(kwargs["drop_audio_cond"])
                self_outer.assertEqual(kwargs["cond"].count_nonzero().item(), 0)
                self_outer.assertTrue(torch.equal(kwargs["text"], b_text))
                calls.append((kwargs["drop_text"], kwargs["drop_midi"]))
                return torch.tensor([[10 - (3 if kwargs["drop_text"] else 0) - (2 if kwargs["drop_midi"] else 0)]], dtype=torch.float32), None

            def clear_cache(self):
                pass
        self_outer = self
        policy = SimpleNamespace(transformer=Transformer())
        plans = [{"audioCfg": -1}, {"audioCfg": -1}]
        with pgo_guidance.dual_cfg(policy, plans, {"text": 0.6, "midi": 0.5}, b_text):
            result, _ = policy.transformer.forward(
                cfg_infer=True, cond=torch.ones(1, 4, 64), text=torch.ones(1, 4, dtype=torch.long))
        torch.testing.assert_close(result, torch.tensor([[12.8], [12.8]]))
        self.assertEqual(len(calls), 3)


if __name__ == "__main__":
    unittest.main()
