import assert from 'node:assert/strict'
import test from 'node:test'
import {
  buildV5PServerFrameMap,
  buildV5PDirectJobManifest,
  buildV5PServerHTransport,
  buildV5PServerMidiTransport,
  validateSynthesisDirectControlRequest,
} from './synthesis-direct-control.service.js'

test('direct preflight independently verifies frame map, H and MIDI transport', () => {
  const request = fixtureRequest()
  const first = validateSynthesisDirectControlRequest(request)
  const second = validateSynthesisDirectControlRequest(request)
  assert.equal(first.snapshotSHA256, second.snapshotSHA256)
  assert.match(first.snapshotSHA256, /^[a-f0-9]{64}$/)
  assert.equal(first.frameMap.bOffsetFrame, 15)
  assert.deepEqual(first.render, {
    steps: 32, cfg: 1, guidance: { mode: 'unified', cfg: 1 }, seed: 42, device: 'cuda:0',
  })
})

test('direct preflight freezes validated three-way CFG settings', () => {
  const request = fixtureRequest()
  request.guidance = {
    mode: 'three-way', audio: 1.2, text: 0.8, midi: 1.4,
    formula: 'audio-text-midi-telescoping.v1',
  }
  const preflight = validateSynthesisDirectControlRequest(request)
  assert.deepEqual(preflight.render.guidance, request.guidance)
  assert.equal(preflight.render.cfg, 0)

  request.guidance.text = 11
  assert.throws(() => validateSynthesisDirectControlRequest(request), /guidance.text/)
})

test('direct preflight accepts the documented -1 to 10 CFG range', () => {
  const request = fixtureRequest()
  request.guidance = {
    mode: 'three-way', audio: -1, text: 0, midi: 10,
    formula: 'audio-text-midi-telescoping.v1',
  }
  const preflight = validateSynthesisDirectControlRequest(request)
  assert.deepEqual(preflight.render.guidance, request.guidance)

  request.guidance.text = -1.1
  assert.throws(() => validateSynthesisDirectControlRequest(request), /guidance.text/)
})

test('direct preflight rejects client frame-map or MIDI transport tampering', () => {
  const badMap = fixtureRequest()
  badMap.snapshot.frameMap.bOffsetFrame += 1
  assert.throws(() => validateSynthesisDirectControlRequest(badMap), /ABFrameMap/)

  const badMidi = fixtureRequest()
  badMidi.snapshot.midiPTransport.classIds[15] = 99
  assert.throws(() => validateSynthesisDirectControlRequest(badMidi), /MIDI-P transport/)

  const badH = fixtureRequest()
  badH.snapshot.hTransport.tokens[0] = 99
  assert.throws(() => validateSynthesisDirectControlRequest(badH), /joint H transport/)
})

test('direct preflight rejects PAD and dense H without matching provenance', () => {
  const pad = fixtureRequest()
  pad.snapshot.target.midiP.classes[1] = 256
  assert.throws(() => validateSynthesisDirectControlRequest(pad), /0..255/)

  const hiddenH = fixtureRequest()
  hiddenH.snapshot.target.text.denseHTokens[1] = 211
  assert.throws(() => validateSynthesisDirectControlRequest(hiddenH), /provenance/)

  const exact = fixtureRequest()
  exact.snapshot.reference.text.placementRanges = [{
    phraseId: 'a', startFrame: 0, endFrameExclusive: 4,
    placementMode: 'sentence', fallbackReason: 'sample_control_anomaly',
  }]
  exact.snapshot.hTransport = buildV5PServerHTransport(
    exact.snapshot.frameMap,
    exact.snapshot.reference.text.denseHTokens,
    exact.snapshot.target.text.denseHTokens,
  )
  assert.throws(() => validateSynthesisDirectControlRequest(exact), /sentence placement/)
})

test('direct job manifest freezes canonical snapshot and hash-locked resources', () => {
  const request = fixtureRequest()
  const preflight = validateSynthesisDirectControlRequest(request)
  const resourceSHA256 = Object.fromEntries([
    'checkpoint', 'modelConfig', 'vaeConfig', 'vaeCheckpoint', 'placement',
    'directControlAdapter', 'runner', 'midi_p_v4ph.py',
  ].map((key, index) => [key, (index + 1).toString(16).repeat(64)]))
  const manifest = buildV5PDirectJobManifest(request, { ...preflight, resourceSHA256 })

  assert.equal(manifest.schema, 'aisvc.v5p-direct-job.v1')
  assert.equal(manifest.snapshotSHA256, preflight.snapshotSHA256)
  assert.deepEqual(JSON.parse(manifest.snapshotCanonical), request.snapshot)
  assert.equal(manifest.resources.checkpoint.sha256, resourceSHA256.checkpoint)
  assert.equal(manifest.resources.runner.sha256, resourceSHA256.runner)
  assert.equal(manifest.resources.singerRoot.path, 'E:/AIscene/YingMusic_Singer_Plus')
})

test('direct preflight and manifest support the V5Pg_20K preset', () => {
  const request = fixtureRequest()
  request.presetId = 'V5Pg_20K'
  const preflight = validateSynthesisDirectControlRequest(request)
  assert.equal(preflight.presetId, 'V5Pg_20K')

  const resourceSHA256 = Object.fromEntries([
    'checkpoint', 'modelConfig', 'vaeConfig', 'vaeCheckpoint', 'placement',
    'directControlAdapter', 'runner', 'midi_p_v4ph.py',
  ].map((key, index) => [key, (index + 1).toString(16).repeat(64)]))
  const manifest = buildV5PDirectJobManifest(request, { ...preflight, resourceSHA256 })
  assert.equal(manifest.preset.id, 'V5Pg_20K')
  assert.equal(manifest.preset.checkpointSchema, 'v5pg_training_checkpoint_v1')
  assert.equal(manifest.preset.checkpointStep, 20000)
  assert.equal(manifest.preset.emaStepOffset, 40000)
  assert.match(manifest.resources.checkpoint.path, /V5Pg_20K\/step_020000_final\.pt$/)
  assert.match(manifest.resources.vaeCheckpoint.path, /autoencoder_285k\.ckpt$/)
})

test('direct preflight and manifest support the V5PgO_8K preset', () => {
  const request = fixtureRequest()
  request.presetId = 'V5PgO_8K'
  const preflight = validateSynthesisDirectControlRequest(request)
  assert.equal(preflight.presetId, 'V5PgO_8K')

  const resourceSHA256 = Object.fromEntries([
    'checkpoint', 'modelConfig', 'vaeConfig', 'vaeCheckpoint', 'placement',
    'directControlAdapter', 'runner', 'midi_p_v4ph.py',
  ].map((key, index) => [key, (index + 1).toString(16).repeat(64)]))
  const manifest = buildV5PDirectJobManifest(request, { ...preflight, resourceSHA256 })
  assert.equal(manifest.preset.id, 'V5PgO_8K')
  assert.equal(manifest.preset.checkpointSchema, 'v5pgo_training_checkpoint_v1')
  assert.equal(manifest.preset.checkpointStep, 8000)
  assert.equal(manifest.preset.emaStepOffset, 0)
  assert.match(manifest.resources.checkpoint.path, /V5PgO\/step_008000_final\.pt$/)
  assert.match(manifest.resources.vaeCheckpoint.path, /autoencoder_285k\.ckpt$/)
})

test('V5PgOV freezes the EMA decoder as a separate hash-locked resource', () => {
  const request = fixtureRequest()
  request.presetId = 'V5PgOV_300K_EMA'
  const preflight = validateSynthesisDirectControlRequest(request)
  const resourceSHA256 = Object.fromEntries([
    'checkpoint', 'modelConfig', 'vaeConfig', 'vaeCheckpoint', 'vaeDecoderCheckpoint',
    'placement', 'directControlAdapter', 'runner', 'midi_p_v4ph.py',
  ].map((key, index) => [key, (index + 1).toString(16).repeat(64)]))
  const manifest = buildV5PDirectJobManifest(request, { ...preflight, resourceSHA256 })

  assert.equal(manifest.preset.checkpointSchema, 'v5pgo_training_checkpoint_v1')
  assert.equal(manifest.resources.checkpoint.sha256, resourceSHA256.checkpoint)
  assert.equal(manifest.resources.vaeDecoderCheckpoint?.sha256, resourceSHA256.vaeDecoderCheckpoint)
  assert.match(manifest.resources.vaeDecoderCheckpoint?.path ?? '', /V5PgOV_300K_EMA_decoder\.pt$/)
})

function fixtureRequest(): any {
  const frameMap = buildV5PServerFrameMap(8_192, 8_192)
  const classes = [120, 121, 255, 122]
  const text = {
    segmentRevision: 1,
    kanaRevision: 1,
    hRevision: 2,
    hEvents: [
      { id: 'h:0', frame: 0, tokenId: 46, origin: 'user' },
      { id: 'h:3', frame: 3, tokenId: 365, origin: 'segment-align' },
    ],
    denseHTokens: [46, 0, 0, 365],
  }
  return {
    jobId: 'v5p-direct-test',
    presetId: 'V5P_40K_EMA',
    referenceWav: 'E:/AIscene/AISVC-midi-web/data/render_test_a/combined.wav',
    targetWav: 'E:/AIscene/AISVC-midi-web/data/render_test_b/combined.wav',
    snapshot: {
      schema: 'aisvc.v5p-material-snapshot.v1',
      createdAt: '2026-08-11T00:00:00.000Z',
      reference: {
        unitId: 'node:a', unitRevision: 3,
        guide: guide('asset:a', 'a'), text: structuredClone(text),
      },
      target: {
        unitId: 'node:b', unitRevision: 4,
        guide: guide('asset:b', 'b'), text: structuredClone(text),
        midiP: { revision: 3, classes, manualFrames: [1] },
      },
      frameMap,
      hTransport: buildV5PServerHTransport(frameMap, text.denseHTokens, text.denseHTokens),
      midiPTransport: buildV5PServerMidiTransport(frameMap, classes),
    },
  }
}

function guide(assetId: string, hashChar: string) {
  return { assetId, audioSHA256: hashChar.repeat(64), sampleRate: 44100, sampleCount: 8_192, frameCount: 4 }
}
