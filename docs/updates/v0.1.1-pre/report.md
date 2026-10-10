# v0.1.1-pre Source Baseline

Date: 2026-10-10

## Purpose

This tag freezes the current main development source as the baseline for further
v0.1.1 work. It is not a completed installer, nor a supported code-only update
from v0.1.0 RC1/RC2. The actual RC2 portable distribution contains path adaptation
that must be retained when preparing an installable release.

The companion `report.json` records baseline identity only. It is deliberately
not registered as an automatically upgradeable release. The annotated Git tag
provides the immutable commit identity without embedding a self-referential
commit hash inside the same commit.

## Included Development Changes

- PgO independent-dropout three-way guidance and multiple A references, with
  fixed-width reference bars, CFG controls, removal and horizontal scrolling.
- F1 3K/6K EMA adapter loading and model-catalog integration; default PgO remains.
- Three-way/unified CFG range -1 to 10, numerical zero for no additional
  reinforcement, and defaults A 0.4 / T 0.6 / M 0.5.
- Take RMS alignment to Guide for playback/export, named clipping notifications,
  Take deletion with undo, and Kana blank-area creation via the existing editor.
- Intrinsic DB search code, configurable external vector/audio roots, Guide
  input for SYN, exact-neighbor search, strict radial display, square plot and
  expanded modal, query-center preview, and project-owned sentence import.
- Shared input-slot transactions and live-store compatibility fixes.
- Related tests, source scripts, model configuration and technical documents.
- Existing committed editor features remain, including lyric proofreading,
  romaji settings, MIDI audition instruments and octave editing.

These are development-source capabilities, not a promise that all of them will
be exposed in the final v0.1.1 installer. The planned installer still defers DB,
new model weights and the PgO-only multi-A entry unless its scope is explicitly
changed.

## Not Included

- Model checkpoint binaries, including Intrinsic and F1 weights.
- Python venvs, Node dependencies, build outputs and runtime caches.
- New or modified local song projects, recordings and backgrounds.
- Update-check/upgrade-plan code currently developed in the separate
  `AISVC-midi-web-v0.1.1` prototype.
- Source staging/build executor, code replacement, rollback and recovery.
- RC1/RC2-to-v0.1.1 upgrade entry script.

Previously committed sample/project files remain in Git history; this publish
does not add the currently modified private working projects.

## Verification

Frontend type checking and backend TypeScript compilation passed.
Focused frontend verification passed 55 tests covering DB input/geometry,
Take loudness, shared slot actions, multi-reference guidance, control-track
transactions, protocol transport and synthesis-unit state.
Focused backend verification passed 25 tests covering DB settings, GPU policy,
model catalog/runtime state and direct-control manifests.
No new GPU synthesis or model download is required to publish this source
baseline. Earlier detailed experiments remain documented in the topical reports.

## Known Boundaries

- Development inference configuration still includes machine-local paths; it
  must not replace the RC2 portable-path layer blindly.
- Optional model/DB features require separately supplied resources.
- The blur performance issue is identified but intentionally not changed here.
- Heavy dependency upgrades and their compatibility warnings are not resolved
  by this source snapshot.
