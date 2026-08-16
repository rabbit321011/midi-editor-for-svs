import type { SynthesisKanaTrack, SynthesisKanaUnit } from './types'

export interface SynthesisKanaPhraseContext {
  id: string
  kana: string
  startFrame: number
  endFrameExclusive: number
  controlEndFrameExclusive: number
  units: Array<{ unit: SynthesisKanaUnit; moraIndex: number }>
}

export interface SynthesisKanaControlRange {
  phrase: SynthesisKanaPhraseContext
  unit: SynthesisKanaUnit
  moraIndex: number
  startFrame: number
  endFrameExclusive: number
  isPhraseEnd: boolean
}

export interface SynthesisSegmentKanaRange {
  segmentStartFrame: number
  segmentSpeechEndFrameExclusive: number
  segmentControlEndFrameExclusive: number
}

export function normalizeKanaMora(value: string): string {
  return value
    .normalize('NFKC')
    .replace(/\s+/g, '')
    .replace(/[\u30A1-\u30F6\u30FD-\u30FE]/g, character => (
      String.fromCodePoint(character.codePointAt(0)! - 0x60)
    ))
}

export function buildKanaPhraseContexts(
  track: SynthesisKanaTrack,
  frameCount: number,
): SynthesisKanaPhraseContext[] {
  if (!Number.isInteger(frameCount) || frameCount < 1) throw new Error('Kana frameCount 必须是正整数')
  if (track.status !== 'ready' || track.units.length === 0) throw new Error('KanaTrack 尚未生成')
  const units = [...track.units].sort((left, right) => left.startFrame - right.startFrame)
  const boundaries = [...track.boundaries].sort((left, right) => left.frame - right.frame)
  if (new Set(boundaries.map(boundary => boundary.frame)).size !== boundaries.length) {
    throw new Error('Kana SEG boundary 重复')
  }
  for (let index = 0; index < units.length; index++) {
    const unit = units[index]
    if (!Number.isInteger(unit.startFrame) || !Number.isInteger(unit.endFrameExclusive)
      || unit.startFrame < 0 || unit.endFrameExclusive <= unit.startFrame || unit.endFrameExclusive > frameCount) {
      throw new Error(`Kana ${unit.id} 越过 frame 合同`)
    }
    const overlappingSeg = boundaries.find(boundary => (
      unit.startFrame < boundary.frame + 1 && boundary.frame < unit.endFrameExclusive
    ))
    if (overlappingSeg) {
      throw new Error(`Kana ${unit.id} 与 SEG frame ${overlappingSeg.frame} 重叠`)
    }
    if (index > 0 && unit.startFrame < units[index - 1].endFrameExclusive) {
      const previous = units[index - 1]
      throw new Error(
        `Kana「${previous.kana}」frame ${previous.startFrame}..${previous.endFrameExclusive - 1} `
        + `与 Kana「${unit.kana}」frame ${unit.startFrame}..${unit.endFrameExclusive - 1} 重叠`,
      )
    }
  }
  if (boundaries.some(boundary => !Number.isInteger(boundary.frame) || boundary.frame <= 0 || boundary.frame >= frameCount)) {
    throw new Error('Kana SEG boundary 越过 frame 合同')
  }

  const phrases: SynthesisKanaPhraseContext[] = []
  let group: SynthesisKanaUnit[] = []
  let boundaryIndex = 0
  for (const unit of units) {
    while (boundaryIndex < boundaries.length && unit.startFrame > boundaries[boundaryIndex].frame) {
      if (group.length === 0) throw new Error('Kana SEG boundary 前没有 KanaUnit')
      phrases.push(buildPhrase(group, boundaries[boundaryIndex].frame + 1))
      group = []
      boundaryIndex += 1
    }
    const nextBoundary = boundaries[boundaryIndex]?.frame ?? frameCount
    if (unit.endFrameExclusive > nextBoundary) throw new Error(`Kana ${unit.id} 跨越 SEG boundary`)
    group.push(unit)
  }
  if (boundaryIndex < boundaries.length) {
    if (boundaryIndex !== boundaries.length - 1 || group.length === 0) {
      throw new Error('Kana SEG boundary 后没有 KanaUnit')
    }
    phrases.push(buildPhrase(group, boundaries[boundaryIndex].frame + 1))
    boundaryIndex += 1
    group = []
  }
  if (group.length > 0) phrases.push(buildPhrase(group, frameCount))
  if (boundaryIndex !== boundaries.length || phrases.length === 0) {
    throw new Error('Kana SEG 结构无法形成分句')
  }
  return phrases
}

export function getKanaControlRange(
  track: SynthesisKanaTrack,
  kanaUnitId: string,
  frameCount: number,
): SynthesisKanaControlRange {
  const phrases = buildKanaPhraseContexts(track, frameCount)
  for (const phrase of phrases) {
    const index = phrase.units.findIndex(item => item.unit.id === kanaUnitId)
    if (index < 0) continue
    const current = phrase.units[index]
    const endFrameExclusive = phrase.units[index + 1]?.unit.startFrame ?? phrase.controlEndFrameExclusive
    if (endFrameExclusive <= current.unit.startFrame) throw new Error('Kana control range 没有可用 frame')
    return {
      phrase,
      unit: current.unit,
      moraIndex: current.moraIndex,
      startFrame: current.unit.startFrame,
      endFrameExclusive,
      isPhraseEnd: index === phrase.units.length - 1,
    }
  }
  throw new Error('KanaUnit 不存在')
}

export function getKanaPhraseForSegment(
  track: SynthesisKanaTrack,
  frameCount: number,
  range: SynthesisSegmentKanaRange,
): SynthesisKanaPhraseContext {
  const {
    segmentStartFrame,
    segmentSpeechEndFrameExclusive,
    segmentControlEndFrameExclusive,
  } = range
  if (!Number.isInteger(segmentStartFrame)
    || !Number.isInteger(segmentSpeechEndFrameExclusive)
    || !Number.isInteger(segmentControlEndFrameExclusive)
    || segmentStartFrame < 0
    || segmentSpeechEndFrameExclusive <= segmentStartFrame
    || segmentControlEndFrameExclusive < segmentSpeechEndFrameExclusive
    || segmentControlEndFrameExclusive > frameCount) {
    throw new Error('Segment 的 Kana 查询范围无效')
  }
  const candidates = buildKanaPhraseContexts(track, frameCount).filter(phrase => (
    phrase.startFrame < segmentSpeechEndFrameExclusive
    && segmentStartFrame < phrase.endFrameExclusive
  ))
  if (candidates.length === 0) throw new Error('当前 Segment 下没有 Kana 分句')
  if (candidates.length > 1) throw new Error('当前 Segment 下存在多个 Kana 分句；请先调整 Kana SEG')
  const phrase = candidates[0]
  if (phrase.startFrame < segmentStartFrame || phrase.endFrameExclusive > segmentSpeechEndFrameExclusive) {
    throw new Error('Kana 分句越过当前 Segment 的发声范围；请先调整 Kana 边界')
  }
  if (phrase.controlEndFrameExclusive !== segmentControlEndFrameExclusive) {
    throw new Error('Kana SEG 与当前 Segment 的 H 控制终点不一致；请先调整 Kana SEG')
  }
  return phrase
}


function buildPhrase(units: SynthesisKanaUnit[], controlEndFrameExclusive: number): SynthesisKanaPhraseContext {
  const first = units[0]
  const last = units[units.length - 1]
  if (!first || !last || last.endFrameExclusive > controlEndFrameExclusive) {
    throw new Error('Kana phrase 越过 control range')
  }
  return {
    id: `kana-phrase:${first.id}`,
    kana: units.map(unit => unit.kana).join(''),
    startFrame: first.startFrame,
    endFrameExclusive: last.endFrameExclusive,
    controlEndFrameExclusive,
    units: units.map((unit, moraIndex) => ({ unit, moraIndex })),
  }
}
