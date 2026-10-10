import type { V5PModelId, V5PSamplingSettings } from '@/object-workbench'
import { V5P_MODEL_META } from '@/object-workbench'

export interface SynthesisV5PResult {
  schema: 'aisvc.v5p-direct-result.v1'
  jobId: string
  snapshotSHA256: string
  outputWav: string
  outputSHA256: string
  sampleRate: 44100
  sampleCount: number
  duration: number
  auditFile: string
  presetId: V5PModelId
  checkpointSHA256: string
  vaeSHA256: string
  decoderSHA256?: string
  baseCheckpointSHA256?: string
  loraWeightSource?: 'ema'
  adapterSHA256: string
  seed: number
  samplingSettings: V5PSamplingSettings
  referenceSources?: Array<{ unitId: string; unitRevision: number; audioCfg: number; guideSHA256: string }>
}

export function readSynthesisV5PResult(
  message: unknown,
  expectedJobId: string,
  expectedPresetId: V5PModelId = 'V5P_40K_EMA',
): SynthesisV5PResult | null {
  if (!isRecord(message) || message.type !== 'v5p-result' || !isRecord(message.result)) return null
  const result = message.result
  if (
    result.schema !== 'aisvc.v5p-direct-result.v1'
    || result.jobId !== expectedJobId
    || result.presetId !== expectedPresetId
    || result.sampleRate !== 44100
  ) return null
  const hashes = ['snapshotSHA256', 'outputSHA256', 'checkpointSHA256', 'vaeSHA256', 'adapterSHA256'] as const
  for (const key of hashes) {
    if (typeof result[key] !== 'string' || !/^[a-f0-9]{64}$/i.test(result[key])) return null
  }
  if (expectedPresetId === 'V5PgOV_300K_EMA') {
    if (typeof result.decoderSHA256 !== 'string' || !/^[a-f0-9]{64}$/i.test(result.decoderSHA256)) return null
  } else if (result.decoderSHA256 !== undefined) return null
  if (expectedPresetId === 'V5F_F1_3K_EMA' || expectedPresetId === 'V5F_F1_6K_EMA') {
    if (result.baseCheckpointSHA256 !== V5P_MODEL_META.V5PgO_8K.checkpointSHA256
      || result.checkpointSHA256 !== V5P_MODEL_META[expectedPresetId].checkpointSHA256
      || result.vaeSHA256 !== V5P_MODEL_META[expectedPresetId].vaeSHA256
      || result.loraWeightSource !== 'ema') return null
  }
  if (!Number.isSafeInteger(result.sampleCount) || result.sampleCount < 1) return null
  if (!Number.isFinite(result.duration) || result.duration <= 0) return null
  if (!Number.isSafeInteger(result.seed) || result.seed < 0) return null
  if (!readSamplingSettings(result.samplingSettings)) return null
  if (result.referenceSources !== undefined) {
    if (expectedPresetId !== 'V5PgO_8K' || !Array.isArray(result.referenceSources) || result.referenceSources.length < 2 || result.referenceSources.length > 16) return null
    const ids = new Set<string>()
    for (const source of result.referenceSources) {
      if (!isRecord(source) || typeof source.unitId !== 'string' || !source.unitId || ids.has(source.unitId)
        || !Number.isInteger(source.unitRevision) || source.unitRevision < 0 || !validCfg(source.audioCfg)
        || typeof source.guideSHA256 !== 'string' || !/^[a-f0-9]{64}$/i.test(source.guideSHA256)) return null
      ids.add(source.unitId)
    }
  }
  if (typeof result.outputWav !== 'string' || typeof result.auditFile !== 'string') return null
  return result as SynthesisV5PResult
}

function readSamplingSettings(value: unknown): value is V5PSamplingSettings {
  if (!isRecord(value) || !Number.isInteger(value.steps) || value.steps < 1 || value.steps > 256
    || !Number.isSafeInteger(value.seed) || value.seed < 0 || value.seed > 0xffffffff
    || !isRecord(value.guidance)) return false
  if (value.guidance.mode === 'unified') return validCfg(value.guidance.cfg)
  return value.guidance.mode === 'three-way'
    && ['audio-text-midi-telescoping.v1', 'audio-text-midi-independent.v1'].includes(value.guidance.formula)
    && validCfg(value.guidance.audio) && validCfg(value.guidance.text) && validCfg(value.guidance.midi)
}

function validCfg(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= -1 && value <= 10
}

function isRecord(value: unknown): value is Record<string, any> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
