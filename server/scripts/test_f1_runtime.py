from pathlib import Path
import sys
import unittest

import torch
from torch.nn import functional as F

sys.path.insert(0, str(Path(__file__).resolve().parent))
import f1_runtime

ROOT = Path("E:/MyProject/重要模型保存/V5F_F1_3K_6K")


class F1RuntimeTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.adapters, cls.contract, _ = f1_runtime.load_support(ROOT / "F1_workbench_support.zip")
        cls.payload = torch.load(ROOT / "step_003000.pt", map_location="cpu", weights_only=False, mmap=True)

    def test_real_ema_contract_and_step_are_strict(self):
        weights, _ = f1_runtime.validate_checkpoint(self.payload, {"id": "V5F_F1_3K_EMA", "weightSource": "ema"}, self.contract)
        self.assertEqual(len(weights), 420)
        self.assertEqual(sum(value.numel() for value in weights.values()), 6721152)
        with self.assertRaisesRegex(ValueError, "step mismatch"):
            f1_runtime.validate_checkpoint(self.payload, {"id": "V5F_F1_6K_EMA", "weightSource": "ema"}, self.contract)
        with self.assertRaisesRegex(ValueError, "EMA"):
            f1_runtime.validate_checkpoint(self.payload, {"id": "V5F_F1_3K_EMA", "weightSource": "adapters"}, self.contract)

    def test_partial_or_nonfinite_adapter_state_is_rejected(self):
        for fault in ("missing", "nonfinite", "shape"):
            payload = {**self.payload, "ema": dict(self.payload["ema"])}
            name = next(iter(payload["ema"]))
            if fault == "missing":
                del payload["ema"][name]
            else:
                payload["ema"][name] = torch.full_like(payload["ema"][name], float("nan")) if fault == "nonfinite" else torch.zeros(1)
            with self.subTest(fault=fault), self.assertRaises(ValueError):
                f1_runtime.validate_checkpoint(payload, {"id": "V5F_F1_3K_EMA", "weightSource": "ema"}, self.contract)

    def test_conv_transpose_direction_and_weight_norm_are_preserved(self):
        base = torch.nn.utils.weight_norm(torch.nn.ConvTranspose1d(
            3, 5, 3, stride=2, padding=1, output_padding=1, dilation=1))
        layer = self.adapters.LowRank(base, 2)
        x = torch.randn(1, 3, 7)
        torch.testing.assert_close(layer(x), base(x))
        with torch.no_grad():
            layer.lora_b.fill_(0.05)
        expected = base(x) + F.conv_transpose1d(
            F.conv1d(x, layer.lora_b.t().unsqueeze(-1)),
            layer.lora_a.reshape(2, 5, 3), stride=2, padding=1, output_padding=1)
        torch.testing.assert_close(layer(x), expected)
        self.assertTrue(hasattr(layer.base, "weight_g"))
        layer.enabled = False
        torch.testing.assert_close(layer(x), base(x))

    def test_controls_preserve_effective_text_and_zero_gap_rear_embeddings(self):
        from types import SimpleNamespace
        embedding = torch.nn.Embedding(257, 128)
        with torch.no_grad():
            embedding.weight.fill_(1)
            embedding.weight[256].zero_()
        validated = {
            "frameMap": {"reference": {"ownedFrameCount": 2}, "target": {"ownedFrameCount": 3},
                         "bOffsetFrame": 4, "totalFrameCount": 8},
            "snapshot": {
                "reference": {"text": {"denseHTokens": [46, 365]}},
                "target": {"text": {"denseHTokens": [32, 56, 365]}, "midiP": {"classes": [120, 255, 121]}},
            },
        }
        text, midi, classes = f1_runtime.build_controls(SimpleNamespace(midi_p_v4ph=embedding), validated, "cpu")
        self.assertEqual(text.tolist(), [[46, 365, 0, 0, 32, 56, 365, 0]])
        self.assertEqual(classes.tolist(), [[256, 256, 256, 256, 120, 255, 121, 256]])
        self.assertEqual(midi[:, :4].count_nonzero(), 0)
        self.assertEqual(midi[:, 7:].count_nonzero(), 0)
        self.assertEqual(midi[:, 4:7].count_nonzero(), 3 * 128)


if __name__ == "__main__":
    unittest.main()
