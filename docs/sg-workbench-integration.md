# Sg 40K Workbench Integration

## Scope

The `V5Sg_40K_EMA` preset extends the existing Pg job, H transport, VAE frame map,
resident-worker, Take and reference UI paths. PgO remains the default.

Sg supports one A reference or 2-16 references with independent audio CFG values.
Single-A jobs support unified or independent three-way CFG. Multi-A jobs require
independent three-way CFG and use the existing reference-local PgO formula.
Local H weights and H merge modes remain PgO-only; non-default H weights are
rejected rather than silently ignored when used on a target Sg job.

## Authoritative Inputs

The source of truth is the local training workspace:

- `E:/MyProject/ToLinuxServer/docs/基础设施/v5/V5S/main_V5S.md`
- `E:/MyProject/ToLinuxServer/experiments/v5sg_single_20261010/README.md`
- `E:/MyProject/ToLinuxServer/package_v4c_finetune/train/train_v5sg.py`
- `E:/MyProject/ToLinuxServer/package_v4c_finetune/train/train_v5sg_single.py`
- The final checkpoint's `h_training` metadata.

This is Sg 40K, not the separate SgO continuation. The checkpoint is loaded from
`E:/MyProject/重要模型保存/V5Sg/step_040000_final.pt`, using
`ema_model_state_dict` and schema `v5sg_serial4_checkpoint_v1`.

Its SHA-256 is
`739f034437c1165cd7ef40e860a355e82a1cab791a195ee69f210192144b8249`.
The external SOME teacher SHA-256 is
`aa710fce920b4dae281b0e6cc2acba83345d82ee62d51f7bafeb29636f28f97c`.
The VAE is the same 285K online VAE identity as Sg training, not a V decoder
override. Model/config/VAE/SOME/frontend/runtime identities are hash-bound.

## Condition Paths

```text
A Guide -> 285K VAE -> A prefix acoustic latent
A+B Guide -> training Mel frontend -> frozen SOME -> continuous [1,T,128]
         -> linear interpolation to joint latent frames
         -> sigmoid + fixed equal-space [1,9] mask -> clear A prefix
A/B H -> existing sparse H/PUL joint transport
```

The Mel frontend uses the training defaults: 80 bands, 44.1 kHz, hop 512,
fmin=0 and fmax=None. The editor's separate SOME note-candidate extraction path
uses different settings and is not reused as a condition cache.

Sg does not decode SOME into notes/classes and does not instantiate a GAME-P
embedding. The B snapshot explicitly contains `melody.source = guide-some`
and binds it to the B Guide SHA-256 and owned frame count. It contains neither
`target.midiP` nor `midiPTransport`. Pg requests retain their existing MIDI-P
contract; the two inputs cannot be interchanged.

Every reference gets its own A prefix latent, H transport and A+B SOME condition.
References of different lengths use the existing leading-zero common frame map.
Only sub-frame tail padding remainders are removed from the derived SOME
waveform so its A/B join lands exactly on the common prefix frame; the original
Guide and reference VAE encoding input are not edited.

The A part of the processed SOME tensor is explicitly zero. The B true acoustic
latent is never used as the acoustic condition. H/PUL/SEP positions are unchanged.

## Sampling

SOME extraction and its sigmoid/mask run once before sampling, not at every ODE
evaluation. A scoped sampler transport selects `some_pretrain` while passing the
already processed continuous features so that the sampler does not apply sigmoid
twice. It restores the original melody source in `finally`; the original training
`MIDIFuzzDisturb` module is not overwritten with Identity.

For multi-A, `dual_cfg` receives each reference's own `midi`, `cond` and `text`.
All full/no-A/no-text/no-melody differences are computed inside that reference,
and only the completed vector-field contributions are mixed. CFG strength `-1`
continues to disable an audio reference under the existing convention.

If every A is disabled, the no-A path uses B-only H and re-extracts SOME with a
zero waveform prefix. It must not inherit a disabled reference through the
context-sensitive SOME output. The acoustic prefix is also zero.

Seed and model/condition hashes are recorded through the existing job/audit
pipeline. The audit records SOME hashes per reference and the special no-A
condition when present. New jobs require reloading a resident runtime if its
resource identity no longer matches.

## UI and Resource Management

The SYN model selector and GPU runtime page expose Sg 40K EMA. The SYN summary
shows `Guide / SOME`, the melody CFG control is labelled SOME, and MIDI-P is
marked as audition-only under Sg. Existing MIDI-P data is not changed.
The CFG panel also supports an optional integer melody transpose (-24..24
semitones, default 0). For Sg this creates a duration/sample-count-preserving B
Guide copy before SOME extraction; A remains unchanged. See
[melody-transpose.md](melody-transpose.md) for the job/audit contract.

The Sg entry's unmeasured VRAM profile is explicitly conservative, based on Pg
plus headroom for the separate frozen SOME teacher and extraction workspace.
It is not presented as a measured Sg profile. Long-form peak VRAM still needs
dedicated profiling; the short smoke test below is not such a profile.

## Verification

- Read and verified the actual 40K checkpoint, initialized EMA, H/PUL policies,
  model configuration, SOME identity and 285K VAE hashes against the training
  metadata. EMA loading uses strict state-dict validation.
- CPU tests cover continuous feature interpolation, one-time sigmoid/mask,
  reference-prefix clearing, unequal reference lengths, single/multi/no-A paths,
  per-reference feature isolation and restoration after exceptions.
- Frontend/server tests cover no MIDI-P prerequisite, source discrimination,
  multi-A snapshots, resource manifests, model catalog, protocol compatibility
  and explicitly unmeasured VRAM estimation.
- An isolated browser project verifies Sg selection, the Guide/SOME indicator,
  multiple reference bars, enable/disable, individual CFG changes, persistence,
  and parsing a real Sg multi-A Take result. User projects are not written.
- A real GPU smoke test loaded the complete Sg EMA, frozen SOME and VAE, then
  generated one single-A output and two identical-seed dual-A outputs. Synthetic
  sine-wave Guides were under two seconds and sampling used one step. The
  resulting target contained exactly 65,536 samples and was finite/non-silent.
- The two dual-A outputs had bit-identical decoded PCM in the same environment.
  FLOAT WAV PEAK headers include timestamps, so container hashes are not the
  appropriate seed-reproducibility comparison.

This verifies integration, not singing quality or long-song stability. No
training, large parameter sweeps or music-quality evaluation were performed.
