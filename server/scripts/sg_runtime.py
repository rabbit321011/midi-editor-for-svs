"""Sg 40K: hash-bound continuous SOME conditions on the existing Pg frame map."""

import contextlib
import gc
from pathlib import Path

import torch
from torch.nn import functional as F


def validate_checkpoint(payload, preset, resources):
    if (payload.get("checkpoint_schema") != "v5sg_serial4_checkpoint_v1"
            or payload.get("global_step") != 40000 or payload.get("run_state") != "complete"
            or int(payload.get("ema_step", -1)) != 40000 or not bool(payload.get("ema_initted"))):
        raise ValueError("Sg requires complete 40K initialized EMA")
    metadata = payload.get("h_training") or {}
    expected = {"schema": "v5sg_serial4_checkpoint_v1", "route": "V5-Sg", "phase": "s_g",
                "placement_mode": "phone_pul", "midi_teacher": "continuous SOME frozen V4Hg teacher",
                "midi_fuzz_disturb": True, "max_steps": 40000, "warmup_steps": 4000,
                "first_decay_end": 28000, "mid_lr": 1e-5, "cka_weight": 0.7,
                "flow_b_weight": 2.0, "drop_text": 0.15,
                "h_config_fingerprint": "67eae32578eeb9a8d0c338dfb6e724c697ad8c3578ec061c0ec3a0f52974dd07",
                "pool_policy": "KEEP_LONG_DEDUP_SHORT", "sampling_policy": "NATURAL_RECORD"}
    if any(metadata.get(key) != value for key, value in expected.items()):
        raise ValueError("Sg training contract mismatch")
    hashes = metadata.get("file_sha256") or {}
    for name, resource in (("model_config", "modelConfig"), ("vae_config", "vaeConfig"),
                           ("vae_checkpoint", "vaeCheckpoint"), ("placement_code", "placement"),
                           ("midi_checkpoint", "someCheckpoint")):
        if hashes.get(name) != resources[resource]["sha256"]:
            raise ValueError(f"Sg checkpoint-declared hash mismatch: {name}")
    if hashes.get("training_code") != preset["trainingCodeSHA256"]:
        raise ValueError("Sg training code identity mismatch")
    hp = metadata.get("h_pul") or {}
    h_expected = {"pul_token_id": 366, "sep_token_id": 365,
                  "sep_policy": "next_runtime_control_anchor_minus_one",
                  "final_sep_policy": "last_dense_text_frame",
                  "pul_policy": "repeat_after_packed_lyrics_until_sep",
                  "hard_fallback_policy": "whole_sample_exact_control"}
    if any(hp.get(key) != value for key, value in h_expected.items()):
        raise ValueError("Sg H/PUL identity mismatch")


def build_model(checkpoint, model_config, vae_config, vae_checkpoint, preset, resources, device, runner):
    from omegaconf import OmegaConf
    from src.YingMusicSinger.models.dit import DiT
    from src.YingMusicSinger.models.model import Singer
    from src.YingMusicSinger.melody import midi_extractor, SmoothMelody
    from src.YingMusicSinger.utils import mel_spectrogram
    from src.YingMusicSinger.utils.stable_audio_tools.vae_copysyn import StableAudioInfer
    for name, module in (("someExtractor", midi_extractor), ("someSmooth", SmoothMelody),
                          ("someMel", mel_spectrogram)):
        if runner.require_resource(resources, name) != Path(module.__file__).resolve():
            raise ValueError(f"Sg imported a different {name}")
    import src.YingMusicSinger.melody.Gconform as conformer
    if runner.require_resource(resources, "someConformer") != Path(conformer.__file__).resolve():
        raise ValueError("Sg imported a different SOME conformer")
    cfg = OmegaConf.load(model_config)
    fuzz = cfg.extra_parameters.some_pretrain_fuzzdisturb
    if (cfg.model.melody_input_source != "some_pretrain_fuzzdisturb" or fuzz.drop_type != "equal_space"
            or list(fuzz.drop_prob) != [1, 9] or fuzz.noise_scale != 0 or fuzz.blur_kernel != 0):
        raise ValueError("Sg SOME sigmoid/fixed 1:9 mask configuration differs from training")
    runner.emit("loading_checkpoint", path=str(checkpoint))
    payload = torch.load(checkpoint, map_location="cpu", weights_only=False, mmap=True)
    validate_checkpoint(payload, preset, resources)
    policy = Singer(
        transformer=DiT(**cfg.model.arch, text_num_embeds=cfg.datasets_cfg.text_num_embeds,
                        mel_dim=cfg.model.mel_spec.n_mel_channels, long_skip_connection=True),
        is_tts_pretrain=cfg.model.is_tts_pretrain, melody_input_source=cfg.model.melody_input_source,
        cka_disabled=cfg.model.cka_disabled, num_channels=None, extra_parameters=cfg.extra_parameters,
        mel_spec_kwargs=cfg.model.mel_spec, distill_stage=None, use_guidance_scale_embed=False,
    )
    state = {key.replace("module.", "").replace("ema_model.", ""): value
             for key, value in payload["ema_model_state_dict"].items() if key not in {"step", "initted"}}
    if any("midi_p_v4ph" in key for key in state):
        raise ValueError("Sg checkpoint unexpectedly contains a GAME-P embedding")
    policy.load_state_dict(state, strict=True)
    del state, payload
    gc.collect()
    policy = policy.to(device).eval()
    runner.emit("loading_some")
    teacher = midi_extractor.MIDIExtractor(in_dim=80)
    teacher._load_form_ckpt(str(runner.require_resource(resources, "someCheckpoint")))
    policy._sg_teacher = teacher.to(device).eval()
    policy._sg_teacher.requires_grad_(False)
    # Training uses default Mel parameters: 80 bands, fmin=0, fmax=None.
    policy._sg_mel = mel_spectrogram.MelodySpectrogram().to(device).eval()
    policy._sg_runtime = True
    runner.emit("loading_vae", path=str(vae_checkpoint))
    vae = StableAudioInfer(model_config_path=str(vae_config), model_ckpt_path=str(vae_checkpoint))
    vae = vae.to(device).eval()
    runner.emit("loaded_checkpoint", device=device, melodySource="continuous-SOME", step=40000)
    return policy, vae


def prepare_some_condition(policy, joint_audio, total_frames, prefix_frames):
    with torch.inference_mode():
        mel = policy._sg_mel(audio=joint_audio, sr=44100)
        logits, _ = policy._sg_teacher(mel.transpose(1, 2))
        if logits.ndim != 3 or logits.shape[0] != 1 or logits.shape[-1] != 128:
            raise ValueError("Sg SOME output must be [1,T,128] continuous logits")
        if logits.shape[1] != total_frames:
            logits = F.interpolate(logits.transpose(1, 2), size=total_frames,
                                   mode="linear", align_corners=False).transpose(1, 2)
        midi = policy.smoothMelody_MIDIFuzzDisturb(logits).clone()
        midi[:, :prefix_frames] = 0
        if tuple(midi.shape) != (1, total_frames, 128) or not torch.isfinite(midi).all():
            raise ValueError("Sg SOME condition is invalid")
        return midi


@contextlib.contextmanager
def precomputed_some_transport(policy):
    original = policy.melody_input_source
    # The training sigmoid/mask was applied once above, not once per ODE step
    # and not a second time by Singer.sample().
    policy.melody_input_source = "some_pretrain"
    try:
        yield
    finally:
        policy.melody_input_source = original


def synthesize(policy, vae, reference_audio, target_audio, validated, runner):
    import pgo_guidance
    device, frame_map = validated["device"], validated["frameMap"]
    prefix, total = frame_map["bOffsetFrame"], frame_map["totalFrameCount"]
    seed = validated["seed"]
    shifted = validated.get("shiftedMelody")
    melody_audio = target_audio
    if validated.get("pitchShiftSemitones", 0):
        if not shifted:
            raise ValueError("Sg pitch shift requires a verified temporary Guide")
        melody_audio = runner.load_audio(
            Path(shifted["wav"]).resolve(), {**validated["targetGuide"], "audioSHA256": shifted["sha256"]},
            "Sg shifted B melody")[0]
    torch.backends.cuda.matmul.allow_tf32 = False
    torch.backends.cudnn.allow_tf32 = False
    torch.manual_seed(seed)
    if device.startswith("cuda"):
        torch.cuda.manual_seed_all(seed)
    sources = validated.get("multiReferences")
    if not sources:
        reference = validated["snapshot"]["reference"]
        sources = [{**reference, "audioCfg": validated["guidance"].get("audio", 0),
                    "nativeFrameMap": frame_map, "leadingPadFrames": 0,
                    "hTransport": validated["hTransport"], "wav": validated["referenceWav"]}]
    plans, audits = [], []
    for source in sources:
        audio = reference_audio if not validated.get("multiReferences") else runner.load_audio(source["wav"], source["guide"], "Sg A")[0]
        native_map = source["nativeFrameMap"]
        native_prefix = native_map["bOffsetFrame"]
        a_padded, b_padded = runner.pad_audio_for_frame_map(audio, melody_audio, native_map)
        leading = source["leadingPadFrames"]
        runner.emit("encoding_reference", unitId=source["unitId"])
        with torch.inference_mode():
            latent = vae.encode_audio(a_padded, in_sr=44100).transpose(1, 2)
            if latent.shape[1] != native_prefix:
                raise ValueError("Sg reference VAE frame count mismatch")
            latent = F.pad(latent, (0, 0, leading, 0))
            if latent.shape[1] != prefix:
                raise ValueError("Sg common reference frame count mismatch")
            # The VAE contract floors each region independently. Trim only the
            # sub-frame padding remainder so the SOME A/B join stays at prefix.
            a_model = a_padded[:, :native_prefix * 2048]
            b_model = b_padded[:, :native_map["target"]["paddedFrameCount"] * 2048]
            joint = torch.cat([F.pad(a_model, (leading * 2048, 0)), b_model], dim=1).to(device)
            if joint.shape[1] != total * 2048:
                raise ValueError("Sg joint waveform length differs from frame map")
            midi = prepare_some_condition(policy, joint, total, prefix)
            text = torch.tensor(source["hTransport"]["tokens"], dtype=torch.long, device=device).unsqueeze(0)
        plans.append({**source, "prefixCond": latent, "fullCond": F.pad(latent, (0, 0, 0, total - prefix)),
                      "text": text, "midi": midi})
        audits.append({"unitId": source["unitId"], "unitRevision": source["unitRevision"],
                       "audioCfg": source["audioCfg"], "guideSHA256": source["guide"]["audioSHA256"],
                       "someSHA256": runner.tensor_sha256(midi), "textSHA256": runner.tensor_sha256(text)})
    b_only_text = plans[0]["text"].clone()
    b_only_text[:, :prefix + validated["hTransport"]["target"]["firstLyricLocalFrame"]] = 0
    all_disabled = bool(validated.get("multiReferences")) and all(source["audioCfg"] == -1 for source in sources)
    no_a_midi = None
    if all_disabled:
        joint = torch.cat([b_model.new_zeros(1, prefix * 2048), b_model], dim=1).to(device)
        no_a_midi = prepare_some_condition(policy, joint, total, prefix)
    runner.emit("sampling", steps=validated["steps"], guidance=validated["guidance"], referenceCount=len(plans), totalFrames=total)
    common = dict(cond=plans[0]["prefixCond"], text=plans[0]["text"], duration=total,
                  midi_p=plans[0]["midi"], bound_p=torch.zeros(1, total, 1, device=device),
                  steps=validated["steps"], t_shift=0.5, seed=seed, use_epss=False, enable_melody_control=True)
    with torch.inference_mode(), precomputed_some_transport(policy):
        if validated.get("multiReferences"):
            with pgo_guidance.dual_cfg(policy, plans, validated["guidance"], b_only_text, no_a_midi=no_a_midi):
                generated, _ = policy.sample(**common, cfg_strength=1.0, guidance_scale=1.0)
        else:
            generated, _ = runner.sample_with_guidance(policy, common, validated["guidance"])
    if generated.shape[1] != total:
        raise ValueError("Sg generated latent frame count mismatch")
    crop = frame_map["crop"]
    runner.emit("decoding")
    with torch.inference_mode():
        output = vae.decode_audio(generated[:, crop["startFrame"]:crop["endFrameExclusive"]].transpose(1, 2).float())
        output = output.squeeze(0)[:1].reshape(-1).cpu()[:crop["finalSampleCount"]].contiguous()
    if output.numel() != crop["finalSampleCount"] or not torch.isfinite(output).all():
        raise ValueError("Sg decoded audio violates the sample contract")
    audit = {"melodySource": "guide-some", "someContract": "sigmoid-equal-space-1-9.v1",
             "pitchShiftSemitones": validated.get("pitchShiftSemitones", 0),
             "melodyGuideSHA256": shifted["sha256"] if shifted else validated["snapshot"]["target"]["guide"]["audioSHA256"],
             "references": audits, "allAudioDisabled": all_disabled,
             "referenceEmbeddingNonzeroAfterClear": 0,
             "noAMelodySHA256": runner.tensor_sha256(no_a_midi) if no_a_midi is not None else None,
             "generatedLatentShape": list(generated.shape), "finalSampleCount": output.numel()}
    if validated.get("multiReferences"):
        audit["multiReference"] = {"schema": "aisvc.pgo-multi-a.v1", "sources": audits, "allAudioDisabled": all_disabled}
    return output, audit
