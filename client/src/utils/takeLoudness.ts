import type { SynthesisTake, SynthesisUnitObjectNode, TakeLoudnessAdjustment } from '@/object-workbench/types'

const SILENCE_RMS = 1e-7

export function applyTakeLoudnessSettings(
  unit: SynthesisUnitObjectNode, enabled: boolean,
  entries: Array<{ takeId: string; adjustment: TakeLoudnessAdjustment }> = [],
): { ok: boolean; reason?: string } {
  if (enabled && entries.length === 0) return { ok: false, reason: '没有可对齐的 Take' }
  for (const { takeId, adjustment } of entries) {
    const take = unit.synthesisUnit.takes.find(item => item.id === takeId)
    if (!take || take.status !== 'ready' || take.outputSHA256 !== adjustment.outputSHA256
      || adjustment.guideSHA256 !== unit.synthesisUnit.guide.audioSHA256) {
      return { ok: false, reason: 'Guide 或 Take 已更新，请重新对齐' }
    }
    if (!Number.isFinite(adjustment.gain) || adjustment.gain <= 0
      || !Number.isFinite(adjustment.guideRms) || adjustment.guideRms <= 0
      || !Number.isFinite(adjustment.sourceRms) || adjustment.sourceRms <= 0
      || !Number.isFinite(adjustment.sourcePeak) || adjustment.sourcePeak < 0
      || !Number.isSafeInteger(adjustment.sampleCount) || adjustment.sampleCount < 1
      || typeof adjustment.forcedClipping !== 'boolean') {
      return { ok: false, reason: 'Take 响度参数无效' }
    }
  }
  if (enabled) {
    for (const take of unit.synthesisUnit.takes) delete take.loudness
  }
  for (const { takeId, adjustment } of entries) {
    unit.synthesisUnit.takes.find(item => item.id === takeId)!.loudness = structuredClone(adjustment)
  }
  unit.synthesisUnit.takeLoudnessAligned = enabled
  unit.synthesisUnit.updatedAt = new Date().toISOString()
  return { ok: true }
}

export function audioRmsAndPeak(channels: readonly Float32Array[], sampleCount: number) {
  if (!channels.length || !Number.isInteger(sampleCount) || sampleCount < 1
    || channels.some(channel => channel.length < sampleCount)) throw new Error('音频有效区间为空')
  let sum = 0
  let peak = 0
  for (const channel of channels) {
    for (let index = 0; index < channel.length; index++) {
      const sample = channel[index]
      if (!Number.isFinite(sample)) throw new Error('音频包含无效采样值')
      if (index < sampleCount) sum += sample * sample
      peak = Math.max(peak, Math.abs(sample))
    }
  }
  return { rms: Math.sqrt(sum / (sampleCount * channels.length)), peak }
}

export function planTakeLoudness(
  guide: readonly Float32Array[], take: readonly Float32Array[], modelSampleCount: number,
): Omit<TakeLoudnessAdjustment, 'guideSHA256' | 'outputSHA256'> {
  const sampleCount = Math.min(modelSampleCount, ...guide.map(channel => channel.length), ...take.map(channel => channel.length))
  const reference = audioRmsAndPeak(guide, sampleCount)
  const source = audioRmsAndPeak(take, sampleCount)
  if (reference.rms <= SILENCE_RMS) throw new Error('Guide 有效区间接近静音，无法对齐')
  if (source.rms <= SILENCE_RMS) throw new Error('Take 接近静音，已跳过')
  const gain = reference.rms / source.rms
  return {
    gain, guideRms: reference.rms, sourceRms: source.rms, sourcePeak: source.peak,
    sampleCount, forcedClipping: source.peak * gain > 1,
  }
}

export function effectiveTakeLoudness(unit: SynthesisUnitObjectNode, take: SynthesisTake | null) {
  const adjustment = take?.loudness
  if (!unit.synthesisUnit.takeLoudnessAligned || !adjustment
    || adjustment.guideSHA256 !== unit.synthesisUnit.guide.audioSHA256
    || adjustment.outputSHA256 !== take?.outputSHA256
    || !Number.isFinite(adjustment.gain) || adjustment.gain <= 0) return undefined
  return adjustment
}

export function channelsToFloatWav(channels: readonly Float32Array[], sampleRate: number, gain = 1, clip = false): Blob {
  const frames = channels[0]?.length ?? 0
  if (!frames || channels.some(channel => channel.length !== frames)
    || !Number.isFinite(gain) || gain <= 0) throw new Error('音频处理参数无效')
  const blockAlign = channels.length * 4
  const buffer = new ArrayBuffer(44 + frames * blockAlign)
  const view = new DataView(buffer)
  const ascii = (offset: number, value: string) => {
    for (let index = 0; index < value.length; index++) view.setUint8(offset + index, value.charCodeAt(index))
  }
  ascii(0, 'RIFF')
  view.setUint32(4, buffer.byteLength - 8, true)
  ascii(8, 'WAVEfmt ')
  view.setUint32(16, 16, true)
  view.setUint16(20, 3, true)
  view.setUint16(22, channels.length, true)
  view.setUint32(24, sampleRate, true)
  view.setUint32(28, sampleRate * blockAlign, true)
  view.setUint16(32, blockAlign, true)
  view.setUint16(34, 32, true)
  ascii(36, 'data')
  view.setUint32(40, frames * blockAlign, true)
  let offset = 44
  for (let frame = 0; frame < frames; frame++) {
    for (const channel of channels) {
      const sample = channel[frame] * gain
      if (!Number.isFinite(sample)) throw new Error('处理后的音频包含无效采样值')
      view.setFloat32(offset, clip ? Math.max(-1, Math.min(1, sample)) : sample, true)
      offset += 4
    }
  }
  return new Blob([buffer], { type: 'audio/wav' })
}

export async function prepareTakeLoudnessBlob(blob: Blob, adjustment?: TakeLoudnessAdjustment): Promise<Blob> {
  if (!adjustment || (adjustment.gain === 1 && !adjustment.forcedClipping)) return blob
  const context = new AudioContext({ sampleRate: 44100 })
  try {
    const audio = await context.decodeAudioData(await blob.arrayBuffer())
    const channels = Array.from({ length: audio.numberOfChannels }, (_, index) => audio.getChannelData(index))
    return channelsToFloatWav(channels, audio.sampleRate, adjustment.gain, adjustment.forcedClipping)
  } finally { await context.close() }
}
