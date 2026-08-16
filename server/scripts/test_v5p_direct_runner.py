import hashlib
import importlib.util
import json
from pathlib import Path
import unittest


ROOT = Path(__file__).resolve().parents[2]


def load_module(name, path):
    spec = importlib.util.spec_from_file_location(name, path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


runner = load_module("v5p_direct_runner", ROOT / "server/scripts/v5p_direct_runner.py")
direct = load_module("v5p_direct_control", ROOT / "server/scripts/v5p_direct_control.py")


class V5PDirectRunnerTest(unittest.TestCase):
    def test_three_way_cfg_telescopes_to_legacy_cfg_when_scales_match(self):
        import torch

        class Transformer:
            def __init__(self):
                self.forward = self._forward

            def _forward(self, **kwargs):
                drops = (kwargs["drop_audio_cond"], kwargs["drop_text"], kwargs["drop_midi"])
                values = {
                    (True, True, True): 1.0,
                    (False, True, True): 2.0,
                    (False, False, True): 4.0,
                    (False, False, False): 8.0,
                }
                return torch.tensor([[values[drops]]]), None

            def clear_cache(self):
                pass

        class Policy:
            transformer = Transformer()

        guidance = {
            "mode": "three-way", "audio": 1.5, "text": 1.5, "midi": 1.5,
            "formula": "audio-text-midi-telescoping.v1",
        }
        policy = Policy()
        with runner.ThreeWayCFG(policy, guidance):
            packed, _ = policy.transformer.forward(
                cfg_infer=True, x=None, cond=None, text=None, midi=None, time=None, mask=None
            )
        expected = 8.0 + 1.5 * (8.0 - 1.0)
        self.assertEqual(packed.tolist(), [[expected], [expected]])

    def test_validate_job_recomputes_frame_map_and_training_terminal_seps(self):
        job = build_job()
        validated = runner.validate_job(job, direct)

        self.assertEqual(validated["frameMap"]["bOffsetFrame"], 75)
        self.assertEqual(validated["frameMap"]["totalFrameCount"], 160)
        self.assertEqual(validated["hTransport"]["reference"]["jointTerminalSepFrame"], 82)
        self.assertEqual(validated["hTransport"]["target"]["jointTerminalSepFrame"], 159)
        self.assertEqual(validated["hTransport"]["tokens"][82], 365)
        self.assertEqual(validated["hTransport"]["tokens"][83], 46)
        self.assertEqual(validated["hTransport"]["tokens"][159], 365)

    def test_validate_job_rejects_client_control_tampering(self):
        job = build_job()
        snapshot = json.loads(job["snapshotCanonical"])
        snapshot["hTransport"]["tokens"][82] = 0
        job["snapshotCanonical"] = runner.canonical_json(snapshot)
        job["snapshotSHA256"] = hashlib.sha256(
            job["snapshotCanonical"].encode("utf-8")
        ).hexdigest()

        with self.assertRaisesRegex(ValueError, "runner joint H"):
            runner.validate_job(job, direct)

    def test_padding_makes_reference_boundary_exact(self):
        import torch

        frame_map = direct.build_frame_map(131_072, 131_072)
        reference = torch.zeros(1, 131_072)
        target = torch.zeros(1, 131_072)
        reference_padded, target_padded = runner.pad_audio_for_frame_map(
            reference, target, frame_map
        )

        self.assertEqual(reference_padded.shape[1], 75 * 2_048)
        self.assertEqual(target_padded.shape[1], 131_072 + 44_100)
        self.assertEqual(reference_padded.shape[1] % 2_048, 0)

    def test_strict_checkpoint_metadata_accepts_v5pg_contract(self):
        preset = {
            "checkpointSchema": "v5pg_training_checkpoint_v1",
            "checkpointStep": 20000,
            "emaStepOffset": 40000,
            "trainingCodeSHA256": "5" * 64,
        }
        resources = {
            "placement": {"sha256": "6" * 64},
            "modelConfig": {"sha256": "7" * 64},
            "vaeConfig": {"sha256": "8" * 64},
            "vaeCheckpoint": {"sha256": "9" * 64},
        }
        payload = {
            "checkpoint_schema": "v5pg_training_checkpoint_v1",
            "global_step": 20000,
            "run_state": "complete",
            "ema_step": 60000,
            "ema_initted": True,
            "v5p_training": {
                "schema": "v5pg_training_checkpoint_v1",
                "placement_mode": "phone_pul",
                "phase": "g_adapt",
                "midi_teacher": "GAME medium K4 offline cache",
                "midi_fuzz_disturb": False,
                "schedule_profile": "v5pg20_two_cosine",
                "warmup_steps": 1000,
                "first_decay_end": 14000,
                "mid_lr": 7e-6,
                "max_steps": 20000,
                "pool_policy": "KEEP_LONG_DEDUP_SHORT",
                "sampling_policy": "NATURAL_RECORD",
                "engineering_joint_probe": False,
                "engineering_g_probe": False,
                "ema_device": "cpu",
                "h_pul": {
                    "pul_token_id": 366,
                    "sep_token_id": 365,
                    "sep_policy": "next_runtime_control_anchor_minus_one",
                    "final_sep_policy": "last_dense_text_frame",
                    "pul_policy": "repeat_after_packed_lyrics_until_sep",
                    "hard_fallback_policy": "whole_sample_exact_control",
                },
                "file_sha256": {
                    "training_code": "5" * 64,
                    "placement_code": "6" * 64,
                    "model_config": "7" * 64,
                    "vae_config": "8" * 64,
                    "vae_checkpoint": "9" * 64,
                },
            },
            "midi_p_schema": {
                "pitch_scale": 2,
                "pitch_class_count": 255,
                "rest_id": 255,
                "pad_id": 256,
                "num_embeddings": 257,
                "embedding_dim": 128,
                "fuzz_disturb": False,
            },
        }
        runner.strict_checkpoint_metadata(payload, preset, resources)

    def test_strict_checkpoint_metadata_still_accepts_v5p_contract(self):
        preset = {
            "checkpointSchema": "v5p_training_checkpoint_v1",
            "checkpointStep": 40000,
            "emaStepOffset": 0,
            "trainingCodeSHA256": "1" * 64,
        }
        resources = {
            "placement": {"sha256": "2" * 64},
            "modelConfig": {"sha256": "3" * 64},
            "vaeConfig": {"sha256": "4" * 64},
            "vaeCheckpoint": {"sha256": "5" * 64},
        }
        payload = {
            "checkpoint_schema": "v5p_training_checkpoint_v1",
            "global_step": 40000,
            "run_state": "complete",
            "ema_step": 40000,
            "ema_initted": True,
            "v5p_training": {
                "schema": "v5p_training_checkpoint_v1",
                "placement_mode": "phone_pul",
                "phase": "joint",
                "midi_teacher": "GAME medium K4 offline cache",
                "midi_fuzz_disturb": False,
                "schedule_profile": "v5p_two_cosine",
                "warmup_steps": 2000,
                "first_decay_end": 28000,
                "mid_lr": 1e-5,
                "max_steps": 40000,
                "pool_policy": "KEEP_LONG_DEDUP_SHORT",
                "sampling_policy": "NATURAL_RECORD",
                "engineering_joint_probe": False,
                "ema_device": "cpu",
                "h_pul": {
                    "pul_token_id": 366,
                    "sep_token_id": 365,
                    "sep_policy": "next_runtime_control_anchor_minus_one",
                    "final_sep_policy": "last_dense_text_frame",
                    "pul_policy": "repeat_after_packed_lyrics_until_sep",
                    "hard_fallback_policy": "whole_sample_exact_control",
                },
                "file_sha256": {
                    "training_code": "1" * 64,
                    "placement_code": "2" * 64,
                    "model_config": "3" * 64,
                    "vae_config": "4" * 64,
                    "vae_checkpoint": "5" * 64,
                },
            },
            "midi_p_schema": {
                "pitch_scale": 2,
                "pitch_class_count": 255,
                "rest_id": 255,
                "pad_id": 256,
                "num_embeddings": 257,
                "embedding_dim": 128,
                "fuzz_disturb": False,
            },
        }
        runner.strict_checkpoint_metadata(payload, preset, resources)


def build_job():
    frame_map = direct.build_frame_map(131_072, 131_072)
    local_h = [0] * 64
    local_h[8] = 46
    local_h[63] = 365
    h_transport = direct.build_h_transport(frame_map, local_h, local_h)
    midi_transport = direct.build_midi_class_transport(frame_map, [120] * 64)
    text = {
        "segmentRevision": 1,
        "kanaRevision": 1,
        "hRevision": 1,
        "hEvents": [
            {"frame": 8, "tokenId": 46},
            {"frame": 63, "tokenId": 365},
        ],
        "denseHTokens": local_h,
        "placementRanges": [],
    }
    guide = {
        "assetId": "asset:guide",
        "audioSHA256": "a" * 64,
        "sampleRate": 44_100,
        "sampleCount": 131_072,
        "frameCount": 64,
    }
    snapshot = {
        "schema": "aisvc.v5p-material-snapshot.v1",
        "createdAt": "2026-08-11T00:00:00.000Z",
        "reference": {
            "unitId": "unit:a",
            "unitRevision": 1,
            "guide": guide,
            "text": text,
        },
        "target": {
            "unitId": "unit:b",
            "unitRevision": 1,
            "guide": guide,
            "text": text,
            "midiP": {"revision": 1, "classes": [120] * 64, "manualFrames": []},
        },
        "frameMap": frame_map,
        "hTransport": h_transport,
        "midiPTransport": midi_transport,
    }
    canonical = runner.canonical_json(snapshot)
    return {
        "schema": runner.JOB_SCHEMA,
        "jobId": "v5p-direct-test",
        "preset": {"id": "V5P_40K_EMA"},
        "inputs": {"referenceWav": "A.wav", "targetWav": "B.wav"},
        "render": {"steps": 1, "cfg": 1, "seed": 42, "device": "cuda:0"},
        "snapshotCanonical": canonical,
        "snapshotSHA256": hashlib.sha256(canonical.encode("utf-8")).hexdigest(),
    }


if __name__ == "__main__":
    unittest.main()
