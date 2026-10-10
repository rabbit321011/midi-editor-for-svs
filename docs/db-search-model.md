# DB Search Encoder Assets

The DB search encoder uses ParaSpeechCLAP Intrinsic, matching the existing
formal sentence vector library. Its assets are local to this application.

## Local Assets

- Checkpoint: `server/models/paraspeechclap-intrinsic/slap-intrinsic.pth.tar`
- Checkpoint bytes: `2384525586`
- Checkpoint SHA-256:
  `22b37acc1bb27a26034614b6eab1562131a4197b86fd0221e45350f927663ad2`
- Checkpoint revision: `e80ad8eb199f7573f07f617c15a7497504151838`
- WavLM configuration:
  `server/models/paraspeechclap-intrinsic/wavlm-large/config.json`
- Reference implementation revision:
  `4767eea9b05bb22598541d3c6ec42f5c6249d2fc`

The copied checkpoint matches the original formal extraction inventory.
The asset directory is excluded from Git. Preserve this directory when
transferring the application to another machine.

## DB Search Integration

The right tool sidebar replaces the unused Chat entry with DB, without changing
the sidebar width or the other tools. The settings page stores two external
paths in `server/data/db-search-settings.json` (excluded from Git):

- Vector library root: contains `MODEL_REGISTRY.json`, `manifest/`, and `vectors/`.
- Audio dataset root: contains the relative audio paths recorded in the manifest,
  normally an `audio/` subdirectory.

Only the formal sentence Intrinsic raw library is currently accepted. Matrix
row indices are mapped back to manifest entries; invalid, nonfinite and
near-silent entries are excluded. Missing audio produces an explicit error;
no guessed path or silent substitution is used.

The in-project `server/scripts/db_search.py` runs an offline, CPU-only worker.
It strictly loads `audio_branch.base.*` and `audio_projection.*` from the
checkpoint and rejects unexpected parameter namespaces. The unused text branch
is not instantiated. The WavLM configuration is bundled alongside the checkpoint.
No separate WavLM base weights or Granite text weights are needed for this path.

Python selection: `AISVC_DB_PYTHON`, then `AISVC_WHISPER_PYTHON`, then
`server/.venv` (Windows/Linux), then the existing sibling `AISVCs/.venv`
(Windows), finally `python` on PATH. Dependencies are listed in
`server/scripts/db_search_requirements.txt`; torch and torchaudio must be a
compatible matching pair. No model downloads occur at runtime.

## Query And Display

- Accept an audio object or its timeline object, or SYN / SYN timeline object.
- The DB, Whisper, and MSST inputs share `RenderInputSlot.vue` and the existing
  `pickSelected`, drop, and clear handlers. The UI and `setSlotFromNode` store
  action use the same stateless `renderSlotTransactions.ts` transaction, so old
  live Pinia action closures cannot reject new DB input types after HMR. DB additionally
  accepts SYN / Guide; this does not relax the other tools' input rules.
- Ordinary audio groups use the shared group audio resolver.
- SYN always supplies its complete owned Guide, never the active Take.
- Native WAV objects and Guides are submitted without browser re-encoding.
- Other audio formats and audio timeline crops use the existing audio resolver.
- Audio timeline track volume is not applied to a query.
- Queries are limited to 60 seconds. Silence and invalid audio are rejected.
- Mono mean, 16 kHz torchaudio resampling, no loudness normalization, minimum
  400 input samples, FP32 model inference, and L2-normalized output follow the
  original encoder contract.
- Exact full-library cosine search selects the nearest 200 valid entries.
  Distances use L2-normalized Euclidean distance `sqrt(2 - 2*cosine)`.
- Local PCA is fitted to query plus results. Coordinates are translated to
  place the query at the origin; deterministic axis signs avoid random flips.
- Strict mode retains PCA directions but restores each result's radius to its
  actual high-dimensional distance. Degenerate directions use a deterministic
  fallback angle; zero-distance points remain exactly at the origin.
- Ordinary mode shows untranslated-to-radius PCA coordinates, still with the
  query at the origin. Neither mode changes neighbor selection or ranking.
- Uniform wheel zoom and middle-button pan preserve strict radius ratios.
  Points are not jittered or relocated to resolve overlap.
- The sidebar plot is square instead of stretching vertically. Its expand icon
  opens a centered, viewport-constrained square plot. Both views share results,
  selected point, strict mode, playback, and Enter import, but keep independent
  pan/zoom cameras. Closing the modal preserves the sidebar view.
- Axes are an unlabelled horizontal/vertical crosshair with no numeric labels or
  ticks. The crosshair and query marker share the same origin transform during
  zoom and pan. The query marker is drawn above results, so an overlapping result
  cannot prevent clicking it.
- Clicking the query marker toggles playback of the exact query input (SYN uses
  Guide), interrupts result playback, and clears the result selection to prevent
  importing a previously selected neighbor by mistake.
- Clicking selects and plays the exact manifest sentence, interrupting the
  previous preview. Enter with the plot focused copies that sentence into a
  project-owned WAV object under `workspace/DBsearch`, with undo/redo.
- Imported assets do not depend on the external library afterward.

Angles and result-to-result 2D distances are not guaranteed high-dimensional
distances. Strict mode guarantees only distance to the query.

## Verification And Limits

Focused checks cover strict radius geometry, degenerate coordinates, SYN Guide
resolution, settings persistence, and the existing tool-mode store.
Client type checking and server compilation passed. Browser smoke checks on
1920x1080 and 1000x720 cover 200 real results, unchanged Guide bytes, exact radial
ratios, wheel zoom, middle pan, and import/undo/redo in an isolated test project.

A local first-sentence audio query retrieved its corresponding library sentence
at rank 1, with stored-vector cosine approximately 0.99749. This is not an exact
encoder-parity claim: the original embedding project documents different local
and server WAV versions. Exact parity requires the same original waveform and
controlled inference dependencies. Similarity also includes musical/acoustic
confounds; it is not a validated pure-timbre score.

The full-WAV library, residual/PCA vector libraries, approximate indexes,
cluster labels, and semantic angle labels are not implemented.
