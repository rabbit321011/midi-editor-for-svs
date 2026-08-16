import assert from 'node:assert/strict'
import test from 'node:test'
import { validateSynthesisMidiPRequest } from './synthesis-midi-p.service.js'

test('MIDI-P request accepts an empty target revision and fixed frame contract', () => {
  assert.doesNotThrow(() => validateSynthesisMidiPRequest({
    jobId: 'midi-p-test',
    inputWav: 'E:/guide.wav',
    guideSHA256: 'a'.repeat(64),
    frameCount: 64,
    midiPRevision: 0,
  }))
})

test('MIDI-P request rejects malformed revisions and frame counts', () => {
  assert.throws(() => validateSynthesisMidiPRequest({
    jobId: 'midi-p-test', inputWav: 'E:/guide.wav', guideSHA256: 'a'.repeat(64),
    frameCount: 0, midiPRevision: 0,
  }), /frameCount/)
  assert.throws(() => validateSynthesisMidiPRequest({
    jobId: 'midi-p-test', inputWav: 'E:/guide.wav', guideSHA256: 'a'.repeat(64),
    frameCount: 64, midiPRevision: -1,
  }), /revision/)
})

test('MIDI-P request accepts a bounded local SOME extraction', () => {
  assert.doesNotThrow(() => validateSynthesisMidiPRequest({
    jobId: 'midi-p-local', inputWav: 'E:/guide.wav', guideSHA256: 'a'.repeat(64),
    frameCount: 64, midiPRevision: 2, extractor: 'some', startFrame: 12, endFrameExclusive: 28,
  }))
  assert.throws(() => validateSynthesisMidiPRequest({
    jobId: 'midi-p-local', inputWav: 'E:/guide.wav', guideSHA256: 'a'.repeat(64),
    frameCount: 64, midiPRevision: 2, extractor: 'game', startFrame: 28, endFrameExclusive: 12,
  }), /frame 范围/)
})
