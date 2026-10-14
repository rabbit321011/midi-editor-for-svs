# Melody Transpose

The SYN CFG panel provides `旋律移调（半音）`, an integer in -24..24.
Missing values in old projects mean 0. One semitone is one chromatic step;
12 semitones are one octave. The default is no transposition, not one octave.

The parameter belongs to `samplingSettings.pitchShiftSemitones`. It is persisted
with the SYN, frozen into each new job's render settings, returned in the Take
sampling settings, and included in the Take's parameter label when nonzero.
Existing Takes are not changed. The editor's Guide/MIDI audition remains the
unmodified source audition; this setting changes subsequent synthesis only.

## Pg and F1

Each valid B-local pitch class is offset by `2 * semitones`, retaining MIDI-P's
half-semitone precision. REST=255 is unchanged. A, gaps, rear padding, H events
and frame boundaries are unchanged.

The original snapshot and editing track are not modified. Python derives an
effective MIDI transport after verifying the original transport. F1 applies the
same offset to its B source controls while preserving its distinct PAD=256
zero-embedding contract. It is not shifted twice.

If any B pitch would leave 0..254, preflight rejects the entire operation.
It does not clamp individual notes or turn out-of-range pitches into REST.

## Sg

Sg does not consume MIDI-P. Before sampling, the server uses the existing
FFmpeg Rubber Band pitch tool on a temporary copy of the B Guide:

- Frequency ratio: `2 ** (semitones / 12)`.
- Formants preserved, duration preserved.
- Pad/trim explicitly to the original sample count, not a rounded duration.
- Verify the result is still 44.1 kHz and has the exact original sample count.

The original A/B Guides are kept and verified. Only the derived B waveform
enters SOME; reference VAE encoding is still based on each original A.
The same shifted B copy is used for every reference-local condition, including
the explicit zero-A-prefix path when all A references are disabled.

The job binds the derived WAV path/hash to the original Guide hash, sample
count, sample rate and semitone setting. The runner rejects a missing,
inconsistent or unexpected derived waveform and verifies its contents on load.
The Sg condition audit includes the effective melody Guide hash and shift.
At 0 there is no extra waveform or audio processing.

## Audit and Compatibility

The original material snapshot hash continues to describe the original source
material. The complete job manifest hash binds the render parameter and, for
Sg, the derived audio identity. The result sampling settings must match the
frozen server render settings, including the shift when present.

Old requests/results without the optional parameter keep their original shape
and mean 0. Invalid fractional, non-numeric or out-of-range values are rejected.
The feature does not attempt to automatically choose a key or shift a backing
track. Larger shifts may affect model following and audio-processing quality.

## Verification

- CPU tests verify pitch-class offsets, REST preservation, unchanged A/rear
  regions, F1 PAD behavior, source immutability and overflow rejection.
- Sg tests verify that only the shifted B copy reaches each reference's SOME
  input, not the original B or a shifted A.
- Server tests cover render freezing, derived-audio identity and malformed
  parameters; frontend tests cover store/protocol persistence and validation.
- Isolated browser projects verify default 0, signed edits, close/reopen,
  save/reload, and availability for both PgO and Sg.
- A real Rubber Band CPU test used synthetic 440 Hz audio at +/-12 semitones.
  Dominant frequencies moved near 880/220 Hz, the original file hash remained
  unchanged, and both outputs retained exactly 65,536 samples at 44.1 kHz.

No additional full-model GPU generation or song-quality evaluation was run for
this parameter change. Existing runtime processes must be reloaded when their
runner/adapter hashes differ from the updated job resources.
