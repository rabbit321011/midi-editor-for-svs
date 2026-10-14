import copy
from pathlib import Path
from types import SimpleNamespace
import sys
import unittest

import torch
from torch.nn import functional as F

sys.path.insert(0, str(Path(__file__).parent))
import sg_runtime
import pgo_guidance
import v5p_direct_control as direct
import v5p_direct_runner as runner


class SgRuntimeTests(unittest.TestCase):
    def test_continuous_some_interpolation_sigmoid_mask_and_reference_clear(self):
        raw = torch.linspace(-2, 2, 5).view(1, 5, 1).expand(1, 5, 128)
        calls = []
        def smooth(value):
            calls.append(value.clone())
            mask = torch.ones(1, value.shape[1], 1)
            mask[:, ::10] = 0
            return value.sigmoid() * mask
        policy = SimpleNamespace(
            _sg_mel=lambda **kw: torch.zeros(1, 80, 5),
            _sg_teacher=lambda mel: (raw, None), smoothMelody_MIDIFuzzDisturb=smooth)
        result = sg_runtime.prepare_some_condition(policy, torch.zeros(1, 22 * 2048), 22, 6)
        expected_raw = F.interpolate(raw.transpose(1, 2), size=22, mode="linear", align_corners=False).transpose(1, 2)
        torch.testing.assert_close(calls[0], expected_raw)
        self.assertEqual(result.shape, (1, 22, 128))
        self.assertEqual(result[:, :6].count_nonzero().item(), 0)
        self.assertEqual(result[:, 10].count_nonzero().item(), 0)
        torch.testing.assert_close(result[:, 11], expected_raw[:, 11].sigmoid())
        self.assertEqual(len(calls), 1)

    def test_sampling_transport_restores_original_source_after_failure(self):
        policy = SimpleNamespace(melody_input_source="some_pretrain_fuzzdisturb")
        with self.assertRaisesRegex(RuntimeError, "failure"):
            with sg_runtime.precomputed_some_transport(policy):
                self.assertEqual(policy.melody_input_source, "some_pretrain")
                raise RuntimeError("failure")
        self.assertEqual(policy.melody_input_source, "some_pretrain_fuzzdisturb")

    def test_single_multi_and_all_disabled_use_some_not_game(self):
        for multi, disabled, expected_calls, shift in ((False, False, 4, 0), (True, False, 8, 0), (True, True, 3, 0), (True, False, 8, 12)):
            with self.subTest(multi=multi, disabled=disabled):
                validated, waves = fixture(multi, disabled)
                if shift:
                    validated["pitchShiftSemitones"] = shift
                    validated["shiftedMelody"] = {"wav": str(Path("shifted").resolve()), "sha256": "f" * 64}
                    waves[str(Path("shifted").resolve())] = torch.ones_like(waves["b"]) * 0.95
                calls, mel_waves = [], []
                class Transformer:
                    def forward(self, **kw):
                        calls.append(kw)
                        assert kw["midi"][:, :validated["frameMap"]["bOffsetFrame"]].count_nonzero() == 0
                        return torch.ones_like(kw["x"]), None
                    def clear_cache(self):
                        pass
                class Policy:
                    melody_input_source = "some_pretrain_fuzzdisturb"
                    transformer = Transformer()
                    def _sg_mel(self, *, audio, sr):
                        assert sr == 44100
                        mel_waves.append(audio.clone())
                        return audio.reshape(1, -1, 2048).mean(-1).unsqueeze(1)
                    def _sg_teacher(self, mel):
                        return mel.mean(1, keepdim=True).expand(1, mel.shape[1], 128), None
                    def smoothMelody_MIDIFuzzDisturb(self, value):
                        mask = torch.ones(1, value.shape[1], 1)
                        mask[:, ::10] = 0
                        return value.sigmoid() * mask
                    def sample(self, **kw):
                        assert self.melody_input_source == "some_pretrain"
                        total = kw["duration"]
                        value, _ = self.transformer.forward(
                            x=torch.zeros(1, total, 64), time=torch.tensor(0.5),
                            text=kw["text"], cond=F.pad(kw["cond"], (0, 0, 0, total - kw["cond"].shape[1])),
                            midi=kw["midi_p"], cfg_infer=True)
                        return value[:1], None
                class VAE:
                    def encode_audio(self, audio, in_sr):
                        return torch.ones(1, 64, audio.shape[1] // 2048) * audio.mean()
                    def decode_audio(self, latent):
                        return torch.ones(1, 1, latent.shape[2] * 2048) * 0.1
                policy = Policy()
                helpers = SimpleNamespace(
                    emit=lambda *args, **kw: None,
                    load_audio=lambda path, guide, label: (waves[str(path)], None),
                    tensor_sha256=runner.tensor_sha256,
                    pad_audio_for_frame_map=runner.pad_audio_for_frame_map,
                    sample_with_guidance=runner.sample_with_guidance)
                result, audit = sg_runtime.synthesize(
                    policy, VAE(), waves[str(validated["referenceWav"])], waves["b"], validated, helpers)
                self.assertEqual(result.numel(), validated["frameMap"]["crop"]["finalSampleCount"])
                self.assertEqual(audit["melodySource"], "guide-some")
                self.assertEqual(len(calls), expected_calls)
                self.assertEqual(policy.melody_input_source, "some_pretrain_fuzzdisturb")
                self.assertFalse(hasattr(policy, "midi_p_v4ph"))
                if multi and not disabled:
                    self.assertFalse(torch.equal(calls[0]["midi"], calls[4]["midi"]))
                if disabled:
                    self.assertTrue(all(kw["drop_audio_cond"] for kw in calls))
                    self.assertEqual(mel_waves[-1][:, :validated["frameMap"]["bOffsetFrame"] * 2048].count_nonzero(), 0)
                    self.assertIsNotNone(audit["noAMelodySHA256"])
                if shift:
                    self.assertEqual(audit["pitchShiftSemitones"], 12)
                    for wave in mel_waves:
                        start = validated["frameMap"]["bOffsetFrame"] * 2048
                        torch.testing.assert_close(wave[:, start:start + 12 * 2048], waves[str(Path("shifted").resolve())])
                    torch.testing.assert_close(waves["b"], torch.ones_like(waves["b"]) * 0.8)


def fixture(multi, disabled):
    def source(name, frames):
        dense = [46] + [0] * (frames - 2) + [365]
        return {"unitId": name, "unitRevision": 1,
                "guide": {"audioSHA256": "a" * 64, "sampleCount": frames * 2048, "frameCount": frames, "sampleRate": 44100},
                "text": {"denseHTokens": dense, "placementRanges": [], "hEvents": []}}
    a, a2, b = source("a", 8), source("a2", 16), source("b", 12)
    anchor = a2 if multi else a
    frame_map = direct.build_frame_map(anchor["guide"]["sampleCount"], b["guide"]["sampleCount"])
    h = direct.build_h_transport(frame_map, anchor["text"]["denseHTokens"], b["text"]["denseHTokens"])
    snapshot = {"reference": copy.deepcopy(anchor), "target": b, "frameMap": frame_map}
    guidance = {"mode": "three-way", "formula": pgo_guidance.FORMULA, "audio": -1 if disabled else 0.5, "text": 0.7, "midi": 0.5}
    waves = {"b": torch.ones(1, 12 * 2048) * 0.8}
    for item, value in ((a, 0.2), (a2, 0.4)):
        waves[str(Path(item["unitId"]).resolve())] = torch.ones(1, item["guide"]["sampleCount"]) * value
    validated = {"snapshot": snapshot, "frameMap": frame_map, "hTransport": h,
                 "targetGuide": b["guide"],
                 "referenceWav": Path(anchor["unitId"]).resolve(), "guidance": guidance, "steps": 1,
                 "seed": 42, "device": "cpu", "multiReferences": None}
    if multi:
        references = []
        for item, cfg in ((a, guidance["audio"]), (a2, -1 if disabled else 0.3)):
            native = direct.build_frame_map(item["guide"]["sampleCount"], b["guide"]["sampleCount"])
            references.append({**copy.deepcopy(item), "audioCfg": cfg,
                               "leadingPadFrames": frame_map["bOffsetFrame"] - native["bOffsetFrame"]})
        snapshot["multiA"] = {"schema": "aisvc.pgo-multi-a.v1", "primaryUnitId": "a", "references": references}
        validated["multiReferences"] = pgo_guidance.validate_multi(snapshot, {
            "referenceWav": str(validated["referenceWav"]),
            "references": [{"unitId": item["unitId"], "wav": str(Path(item["unitId"]).resolve())} for item in references],
        }, guidance, direct)
    return validated, waves


if __name__ == "__main__":
    unittest.main()
