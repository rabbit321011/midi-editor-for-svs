import sys
from pathlib import Path
from types import SimpleNamespace
import unittest

import torch

sys.path.insert(0, str(Path(__file__).resolve().parent))
import pgo_guidance


class PgOGuidanceTest(unittest.TestCase):
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
