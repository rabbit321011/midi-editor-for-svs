import { describe, expect, it } from 'vitest'
import { readSynthesisV5PResult } from './synthesisV5PProtocol'

describe('V5-P result protocol', () => {
  it('accepts a hash-bound immutable Take result', () => {
    expect(readSynthesisV5PResult({
      type: 'v5p-result',
      result: fixture(),
    }, 'v5p-job-test')).toEqual(fixture())
  })

  it('rejects another job or malformed output hash', () => {
    expect(readSynthesisV5PResult({ type: 'v5p-result', result: fixture() }, 'other-job')).toBeNull()
    expect(readSynthesisV5PResult({
      type: 'v5p-result', result: { ...fixture(), outputSHA256: 'bad' },
    }, 'v5p-job-test')).toBeNull()
  })

  it('accepts a V5Pg_20K result when the expected preset matches', () => {
    const result = { ...fixture(), presetId: 'V5Pg_20K' as const }
    expect(readSynthesisV5PResult({
      type: 'v5p-result',
      result,
    }, 'v5p-job-test', 'V5Pg_20K')).toEqual(result)
  })

  it('accepts a V5PgO_8K result when the expected preset matches', () => {
    const result = { ...fixture(), presetId: 'V5PgO_8K' as const }
    expect(readSynthesisV5PResult({
      type: 'v5p-result',
      result,
    }, 'v5p-job-test', 'V5PgO_8K')).toEqual(result)
  })

  it('requires decoder provenance only for V5PgOV', () => {
    const result = {
      ...fixture(),
      presetId: 'V5PgOV_300K_EMA' as const,
      decoderSHA256: 'f'.repeat(64),
    }
    expect(readSynthesisV5PResult({
      type: 'v5p-result', result,
    }, 'v5p-job-test', 'V5PgOV_300K_EMA')).toEqual(result)
    expect(readSynthesisV5PResult({
      type: 'v5p-result', result: { ...result, decoderSHA256: undefined },
    }, 'v5p-job-test', 'V5PgOV_300K_EMA')).toBeNull()
    expect(readSynthesisV5PResult({
      type: 'v5p-result', result: { ...fixture(), decoderSHA256: 'f'.repeat(64) },
    }, 'v5p-job-test')).toBeNull()
  })
})

function fixture() {
  return {
    schema: 'aisvc.v5p-direct-result.v1',
    jobId: 'v5p-job-test',
    snapshotSHA256: 'a'.repeat(64),
    outputWav: 'E:/take.wav',
    outputSHA256: 'b'.repeat(64),
    sampleRate: 44100,
    sampleCount: 2048,
    duration: 2048 / 44100,
    auditFile: 'E:/audit.json',
    presetId: 'V5P_40K_EMA',
    checkpointSHA256: 'c'.repeat(64),
    vaeSHA256: 'd'.repeat(64),
    adapterSHA256: 'e'.repeat(64),
    seed: 42,
    samplingSettings: {
      guidance: { mode: 'unified' as const, cfg: 1 },
      steps: 32,
      seed: 42,
    },
  }
}
