"""Strict three-module F-1 LoRA loading and the original Euler inference path."""

import hashlib
import json
from pathlib import Path
import types
import zipfile

import torch
from torch.nn import functional as F


MODEL_STEPS = {"V5F_F1_3K_EMA": 3000, "V5F_F1_6K_EMA": 6000}
BASE_SHA256 = "6882e0be20ca32a0e2dff9619efa47612ed4ca33f0d4cbc78d1de3da8023d6cc"
VAE_SHA256 = "f18aeecacc04173cd2ea73bbdf8edae9e976d18e4ca050c38e2723281c5cba85"
ADAPTER_CODE_SHA256 = "e7fadffe147673a91a02d27cd002630d93318818154dedd2b037e8a19cbebccf"
MODULE_COUNTS = {"dit": 136, "encoder": 37, "decoder": 37}
PARAMETER_COUNTS = {"dit": 5145600, "encoder": 799856, "decoder": 775696}


def load_support(archive):
    with zipfile.ZipFile(archive) as support:
        prefix = "F1_workbench_support/"
        code = support.read(prefix + "adapters.py")
        contract = json.loads(support.read(prefix + "adapter_contract.json"))
        preparation = json.loads(support.read(prefix + "base_preparation.json"))
    if hashlib.sha256(code).hexdigest() != ADAPTER_CODE_SHA256:
        raise ValueError("F-1 adapter implementation SHA-256 mismatch")
    adapters = types.ModuleType("f1_original_adapters")
    exec(compile(code, str(archive) + "!/adapters.py", "exec"), adapters.__dict__)
    return adapters, contract, preparation


def validate_checkpoint(payload, preset, expected_contract):
    if payload.get("schema") != "f1-adapter-checkpoint-v1":
        raise ValueError("F-1 checkpoint schema mismatch")
    if payload.get("completed") != MODEL_STEPS[preset["id"]]:
        raise ValueError("F-1 checkpoint step mismatch")
    if preset.get("weightSource") != "ema":
        raise ValueError("F-1 presets require EMA adapter factors")
    contract = payload.get("contract") or {}
    for key in ("config_sha256", "preparation_sha256", "module_names", "injections", "trainable"):
        if contract.get(key) != expected_contract.get(key):
            raise ValueError(f"F-1 adapter contract mismatch: {key}")
    if contract.get("engineering_code_sha256", {}).get("adapters.py") != ADAPTER_CODE_SHA256:
        raise ValueError("F-1 checkpoint adapter code mismatch")
    configuration = payload.get("configuration") or {}
    if configuration.get("singer_sha256") != BASE_SHA256 or configuration.get("vae_sha256") != VAE_SHA256:
        raise ValueError("F-1 checkpoint base identity mismatch")
    weights = payload.get("ema")
    if not isinstance(weights, dict) or set(weights) != set(contract["trainable"]):
        raise ValueError("F-1 EMA key set mismatch")
    if len(weights) != 420:
        raise ValueError("F-1 expected exactly 420 LoRA tensors")
    for name, value in weights.items():
        if not isinstance(value, torch.Tensor) or list(value.shape) != contract["trainable"][name]:
            raise ValueError(f"F-1 EMA shape mismatch: {name}")
        if value.dtype != torch.float32 or not torch.isfinite(value).all():
            raise ValueError(f"F-1 EMA dtype or finite-value mismatch: {name}")
    for group, count in PARAMETER_COUNTS.items():
        if sum(value.numel() for name, value in weights.items() if name.startswith(group + ".")) != count:
            raise ValueError(f"F-1 parameter count mismatch: {group}")
    return weights, contract


def apply_adapters(policy, vae, payload, preset, support_path):
    adapters, expected, _ = load_support(support_path)
    weights, contract = validate_checkpoint(payload, preset, expected)
    modules = {"dit": policy.transformer, "encoder": vae.encoder, "decoder": vae.decoder}
    for group, root in modules.items():
        wanted = contract["injections"][group]
        if len(wanted) != MODULE_COUNTS[group] or len(set(wanted)) != len(wanted):
            raise ValueError(f"F-1 injection count mismatch: {group}")
        if any(isinstance(module, adapters.LowRank) for module in root.modules()):
            raise ValueError("F-1 adapters must not be recursively stacked")
        found = adapters.inject(root, 16 if group == "dit" else 8, lambda name, module: name in wanted)
        if set(found) != set(wanted):
            raise ValueError(f"F-1 injection membership mismatch: {group}")
    adapters.recompute_vae(vae.encoder)
    adapters.recompute_vae(vae.decoder)
    adapters.set_enabled(modules, True, recompute=False)
    policy.transformer.checkpoint_activations = False
    params = adapters.named_adapters(modules)
    if set(params) != set(weights):
        raise ValueError("F-1 installed parameter membership mismatch")
    with torch.no_grad():
        for name, parameter in params.items():
            if parameter.shape != weights[name].shape:
                raise ValueError(f"F-1 installed shape mismatch: {name}")
            parameter.copy_(weights[name])
    policy.eval()
    vae.eval()
    policy._f1_adapter_audit = {
        "step": payload["completed"], "weightSource": "ema",
        "moduleCounts": MODULE_COUNTS, "tensorCount": len(params),
        "parameterCount": sum(parameter.numel() for parameter in params.values()),
        "factorDtype": "torch.float32", "recompute": False,
    }
    return policy._f1_adapter_audit


def build_model(checkpoint, base_checkpoint, model_config, vae_config, vae_checkpoint,
                preset, support_path, device):
    from omegaconf import OmegaConf
    from src.YingMusicSinger.melody.midi_p_v4ph import V4PHMIDIEmbedding
    from src.YingMusicSinger.models.dit import DiT
    from src.YingMusicSinger.models.model import Singer
    from src.YingMusicSinger.utils.stable_audio_tools.autoencoders import create_autoencoder_from_config

    cfg = OmegaConf.load(model_config)
    base = torch.load(base_checkpoint, map_location="cpu", weights_only=False, mmap=True)
    if base.get("checkpoint_schema") != "v5pgo_training_checkpoint_v1" or int(base.get("global_step", -1)) != 8000:
        raise ValueError("F-1 requires the original PgO 8K base")
    raw = base["ema_model_state_dict"]
    state = {key.replace("module.", "").replace("ema_model.", ""): value
             for key, value in raw.items() if key not in {"initted", "step"}}
    rows = state["transformer.text_embed_p.text_embed.weight"].shape[0]
    policy = Singer(
        transformer=DiT(**cfg.model.arch, text_num_embeds=rows - 1,
                        mel_dim=cfg.model.mel_spec.n_mel_channels, long_skip_connection=True),
        is_tts_pretrain=cfg.model.is_tts_pretrain,
        melody_input_source=cfg.model.melody_input_source, cka_disabled=cfg.model.cka_disabled,
        num_channels=None, extra_parameters=cfg.extra_parameters, mel_spec_kwargs=cfg.model.mel_spec,
        distill_stage=None, use_guidance_scale_embed=False,
    )
    policy.midi_p_v4ph = V4PHMIDIEmbedding(seed=42)
    policy.load_state_dict(state, strict=True)
    del base, raw, state
    policy.smoothMelody_MIDIFuzzDisturb = torch.nn.Identity()
    if tuple(policy.midi_p_v4ph.embedding.weight.shape) != (257, 128):
        raise ValueError("F-1 frozen MIDI embedding shape mismatch")
    if policy.midi_p_v4ph.embedding.weight[256].count_nonzero():
        raise ValueError("F-1 frozen MIDI PAD embedding is nonzero")
    vae = create_autoencoder_from_config(json.loads(Path(vae_config).read_text(encoding="utf-8")))
    vae_base = torch.load(vae_checkpoint, map_location="cpu", weights_only=False, mmap=True)
    vae.load_state_dict(vae_base["state_dict"], strict=True)
    del vae_base
    policy.requires_grad_(False)
    vae.requires_grad_(False)
    payload = torch.load(checkpoint, map_location="cpu", weights_only=False, mmap=True)
    apply_adapters(policy, vae, payload, preset, support_path)
    del payload
    # Moving devices keeps adapter storage FP32; only forward operations autocast.
    return policy.to(device).eval(), vae.to(device).eval()


def build_controls(policy, validated, device):
    snapshot = validated["snapshot"]
    frame_map = validated["frameMap"]
    a_owned = int(frame_map["reference"]["ownedFrameCount"])
    b_owned = int(frame_map["target"]["ownedFrameCount"])
    start = int(frame_map["bOffsetFrame"])
    total = int(frame_map["totalFrameCount"])
    a_tokens = snapshot["reference"]["text"]["denseHTokens"]
    b_tokens = snapshot["target"]["text"]["denseHTokens"]
    pitches = snapshot["target"]["midiP"]["classes"]
    if len(a_tokens) != a_owned or len(b_tokens) != b_owned or len(pitches) != b_owned:
        raise ValueError("F-1 source controls differ from frame ownership")
    # F data.py preserves effective A/B text and zeros gap/rear H. Its frozen
    # PAD embedding zeros A, gap and rear P, unlike the legacy REST rear.
    text = torch.zeros(1, total, dtype=torch.long, device=device)
    text[:, :a_owned] = torch.tensor(a_tokens, device=device)
    text[:, start:start + b_owned] = torch.tensor(b_tokens, device=device)
    classes = torch.full((1, total), 256, dtype=torch.long, device=device)
    classes[:, start:start + b_owned] = torch.tensor(pitches, device=device)
    midi = policy.midi_p_v4ph(classes)
    if midi[:, :start].count_nonzero() or midi[:, start + b_owned:].count_nonzero():
        raise ValueError("F-1 A/gap/rear MIDI embedding must be zero")
    return text, midi, classes


def synthesize(policy, vae, reference_audio, target_audio, validated, runner):
    device = validated["device"]
    frame_map = validated["frameMap"]
    a_frames = int(frame_map["bOffsetFrame"])
    total = int(frame_map["totalFrameCount"])
    torch.manual_seed(validated["seed"])
    if device.startswith("cuda"):
        torch.cuda.manual_seed_all(validated["seed"])
    a = reference_audio.to(device).repeat(2, 1)
    a = a * (10 ** (-6 / 20)) / a.abs().max().clamp_min(1e-8)
    a = F.pad(a, (0, a_frames * 2048 - a.shape[-1])).unsqueeze(0)
    device_type = torch.device(device).type
    context = {"device_type": device_type, "dtype": torch.bfloat16, "enabled": device_type == "cuda"}
    runner.emit("encoding_reference")
    with torch.inference_mode(), torch.autocast(**context):
        posterior = vae.encoder(a)
        mean, scale = posterior.chunk(2, dim=1)
        if mean.shape[-1] != a_frames:
            raise ValueError("F-1 A posterior differs from frame transport")
        latent = mean + (F.softplus(scale) + 1e-4) * torch.randn_like(mean)
        cond = F.pad(latent.transpose(1, 2), (0, 0, 0, total - a_frames))
        text, midi, classes = build_controls(policy, validated, device)
    audit = {
        "controlPolicy": "f1-a-gap-b-zero-rear.v1",
        "textSHA256": hashlib.sha256(text.cpu().contiguous().numpy().tobytes()).hexdigest(),
        "midiClassSHA256": hashlib.sha256(classes.cpu().contiguous().numpy().tobytes()).hexdigest(),
        "midiEmbeddingSHA256": hashlib.sha256(midi.float().cpu().contiguous().numpy().tobytes()).hexdigest(),
    }
    state = torch.randn(1, total, 64, device=device, dtype=torch.float32)
    grid = torch.linspace(0, 1, validated["steps"] + 1, device=device, dtype=torch.float32)
    grid = 0.5 * grid / (1 - 0.5 * grid)
    guidance = validated["guidance"]
    scales = [guidance["cfg"]] * 3 if guidance["mode"] == "unified" else [
        guidance["audio"], guidance["text"], guidance["midi"]]
    runner.emit("sampling", steps=validated["steps"], guidance=guidance, totalFrames=total)
    with torch.inference_mode():
        for index in range(validated["steps"]):
            def predict(drops):
                with torch.autocast(**context):
                    value, _ = policy.transformer(
                        x=state, cond=cond, text=text, midi=midi, time=grid[index], mask=None,
                        drop_audio_cond=drops[0], drop_text=drops[1], drop_midi=drops[2],
                        cfg_infer=False, cache=False)
                return value.float()
            full = predict((False, False, False))
            velocity = full
            if any(scales):
                if guidance["mode"] == "unified":
                    velocity = full + scales[0] * (full - predict((True, True, True)))
                else:
                    empty = predict((True, True, True))
                    audio = predict((False, True, True))
                    audio_text = predict((False, False, True))
                    velocity = full + scales[0] * (audio - empty) + scales[1] * (audio_text - audio) + scales[2] * (full - audio_text)
            state = state + (grid[index + 1] - grid[index]) * velocity
        runner.emit("decoding", cropStartFrame=a_frames, cropEndFrameExclusive=total)
        with torch.autocast(**context):
            decoded = vae.decoder(state[:, a_frames:, :].transpose(1, 2))
    final_samples = int(frame_map["crop"]["finalSampleCount"])
    if decoded.shape[-1] < final_samples:
        raise ValueError("F-1 decoder output is shorter than B ownership")
    output = decoded[0, :, :final_samples].float().cpu().contiguous()
    if not torch.isfinite(output).all():
        raise ValueError("F-1 decoded audio contains non-finite values")
    return output, {**audit, "f1": policy._f1_adapter_audit,
                   "sampler": "f1-fp32-euler-bf16.v1", "generatedLatentShape": list(state.shape),
                   "referenceLatentShape": list(latent.shape),
                   "decodedSamplesBeforeTrim": decoded.shape[-1], "finalSampleCount": final_samples}
