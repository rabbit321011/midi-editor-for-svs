import type { ProjectObjectTree, SynthesisSegmentObject, SynthesisUnitObjectNode, TrackObjectNode } from './types'
import { buildNodeIndex } from './objectTree'
import { updateSegmentObject } from './synthesisTrackTransactions'
import { kanaToRomaji } from '@/utils/kanaRomaji'

export interface ReadingToken { start: number; end: number; kana: string }
export function sungReadingTokens(reference: LyricReference): ReadingToken[] {
  return reference.tokens.filter(token => /[\p{L}\p{N}\p{M}]/u.test(reference.text.slice(token.start, token.end)))
}
export interface LyricReference { id: string; name: string; text: string; version: number; tokens: ReadingToken[] }
export interface LyricRange { start: number; end: number }
export interface LyricDraft {
  source: string
  text: string
  kana: string
  readingText?: string
  ranges: LyricRange[]
  status: 'draft' | 'confirmed' | 'applied' | 'skipped'
  referenceVersion: number
  instanceId: string | null
  positions?: Record<string, LyricRange[]>
  control?: { kanaRevision: number; hRevision: number; segmentRevision: number }
}
export interface LyricSession {
  referenceId: string
  currentSegmentId: string
  instanceId: string | null
  drafts: Record<string, LyricDraft>
}
export interface LyricProofreadingData {
  references: LyricReference[]
  sessions: Record<string, LyricSession>
}
export interface LyricCandidate extends LyricRange {
  text: string
  kana: string
  score: number
  reason: string
}

export function segmentFingerprint(unit: SynthesisUnitObjectNode, segment: SynthesisSegmentObject): string {
  return JSON.stringify([unit.synthesisUnit.guide.audioSHA256, unit.synthesisUnit.frameContract.frameRate,
    segment.startFrame, segment.speechEndFrameExclusive, segment.text, segment.kana, segment.romaji])
}

export function draftIsCurrent(unit: SynthesisUnitObjectNode, segment: SynthesisSegmentObject, draft: LyricDraft | undefined, reference: LyricReference | undefined): boolean {
  return !!draft && !!reference && draft.referenceVersion === reference.version && draft.source === segmentFingerprint(unit, segment)
}

export function confirmedLyricRanges(draft: LyricDraft | undefined, instanceId: string | null): LyricRange[] {
  if (!draft) return []
  if (draft.instanceId === instanceId && ['confirmed', 'applied'].includes(draft.status)) return draft.ranges
  return draft.positions?.[instanceId ?? 'relative'] ?? []
}

export function confirmLyricPosition(draft: LyricDraft, instanceId: string | null) {
  draft.instanceId = instanceId
  ;(draft.positions ??= {})[instanceId ?? 'relative'] = draft.ranges.map(range => ({ ...range }))
}

export function lyricStatus(unit: SynthesisUnitObjectNode, segment: SynthesisSegmentObject, session?: LyricSession, reference?: LyricReference): string {
  const draft = session?.drafts[segment.id]
  if (!draft) return '未检查'
  if (!draftIsCurrent(unit, segment, draft, reference)) return '需复核'
  if (draft.status === 'applied') {
    const updated = draft.control && unit.synthesisUnit.hTokenTrack.revisions.some(revision =>
      revision.revision > draft.control!.hRevision && revision.affectedStartFrame <= segment.startFrame
      && revision.affectedEndFrameExclusive >= segment.speechEndFrameExclusive
      && revision.operation === 'Segment -> H'
      && revision.sourceRefs.some(source => source.unitId === unit.id && source.track === 'segment'
        && (source.revision ?? -1) >= draft.control!.segmentRevision))
    return draft.control && !updated ? '发音控制待更新' : '已应用'
  }
  return { draft: '草稿', confirmed: '已确认待应用', skipped: '已跳过' }[draft.status]
}

export function getUnitInstances(tree: ProjectObjectTree, unitId: string): TrackObjectNode[] {
  return Object.values(buildNodeIndex(tree.root).nodes).filter((node): node is TrackObjectNode =>
    node.kind === 'trackObject' && node.trackObject.sourceObjectId === unitId)
}

export function absoluteSegmentRange(unit: SynthesisUnitObjectNode, segment: SynthesisSegmentObject, instance?: TrackObjectNode): [number, number] | null {
  if (!instance || instance.trackObject.sourceObjectId !== unit.id) return null
  const duration = instance.trackObject.timelineEnd - instance.trackObject.timelineStart
  // Only a full, untransformed SYN instance has the additive time contract.
  if (Math.abs(duration - unit.synthesisUnit.guide.duration) > 0.1) return null
  const rate = unit.synthesisUnit.frameContract.frameRate
  return [instance.trackObject.timelineStart + segment.startFrame / rate,
    instance.trackObject.timelineStart + segment.speechEndFrameExclusive / rate]
}

interface IndexedText { chars: string[]; starts: number[]; ends: number[] }
function normalize(text: string): string {
  return text.normalize('NFKC').toLowerCase().replace(/[ァ-ヶ]/g, c => String.fromCharCode(c.charCodeAt(0) - 0x60)).replace(/[\s\p{P}\p{S}]/gu, '')
}
function indexText(text: string, tokens?: ReadingToken[]): IndexedText {
  const result: IndexedText = { chars: [], starts: [], ends: [] }
  const append = (value: string, start: number, end: number) => {
    for (const char of normalize(value)) {
      result.chars.push(char); result.starts.push(start); result.ends.push(end)
    }
  }
  if (tokens?.length) {
    for (const token of tokens) append(token.kana, token.start, token.end)
  } else {
    let offset = 0
    for (const char of text) { append(char, offset, offset + char.length); offset += char.length }
  }
  return result
}

// Semi-global edit distance: the query can match any substring, including across lyric lines.
function substringMatches(query: string, indexed: IndexedText): Array<{ start: number; end: number; score: number; reading: string }> {
  const needle = [...normalize(query)].slice(0, 400)
  const n = indexed.chars.length
  if (!needle.length || !n) return []
  let costs = new Float64Array(n + 1)
  let starts = Int32Array.from({ length: n + 1 }, (_, i) => i)
  for (let i = 1; i <= needle.length; i++) {
    const next = new Float64Array(n + 1)
    const nextStarts = new Int32Array(n + 1)
    next[0] = i
    for (let j = 1; j <= n; j++) {
      const diagonal = costs[j - 1] + (needle[i - 1] === indexed.chars[j - 1] ? 0 : 1)
      const remove = costs[j] + 1
      const insert = next[j - 1] + 1
      const cost = Math.min(diagonal, remove, insert)
      next[j] = cost
      nextStarts[j] = Math.min(diagonal === cost ? starts[j - 1] : n,
        remove === cost ? starts[j] : n, insert === cost ? nextStarts[j - 1] : n)
    }
    costs = next; starts = nextStarts
  }
  const matches = []
  for (let j = 1; j <= n; j++) {
    const start = starts[j]
    const score = 1 - costs[j] / Math.max(needle.length, j - start)
    if (j > start && score >= 0.48 && (j === n || costs[j] <= costs[j + 1])) {
      matches.push({ start: indexed.starts[start], end: indexed.ends[j - 1], score, reading: indexed.chars.slice(start, j).join('') })
    }
  }
  return matches
}

export function readingForRange(reference: LyricReference, range: LyricRange): string {
  return sungReadingTokens(reference).filter(token => token.start < range.end && token.end > range.start).map(token => {
    const surface = reference.text.slice(token.start, token.end)
    const start = Math.max(range.start, token.start) - token.start
    const end = Math.min(range.end, token.end) - token.start
    return normalize(surface) === normalize(token.kana) ? surface.slice(start, end) : token.kana
  }).join('')
}

export function referenceLyricLines(reference: LyricReference) {
  let offset = 0
  return reference.text.split('\n').map(raw => {
    const text = raw.replace(/\r$/, '')
    const range = { start: offset, end: offset + text.length }
    offset += raw.length + 1
    const kana = readingForRange(reference, range).trim()
    return { ...range, text, romaji: kana ? kanaToRomaji(kana).replace(/\s+/g, ' ').trim() : '' }
  })
}

export function referenceRomajiParts(reference: LyricReference, line: LyricRange, highlight?: LyricRange): Array<{ text: string; highlighted: boolean }> {
  const parts: Array<{ text: string; highlighted: boolean }> = []
  for (const token of reference.tokens) {
    if (token.end <= line.start || token.start >= line.end) continue
    const text = kanaToRomaji(readingForRange({ ...reference, tokens: [token] }, line)).replace(/\s+/g, ' ').trim()
    if (!text) continue
    // Kanji and their readings are not one-to-one: highlight the corresponding reading token.
    const highlighted = !!highlight && Math.max(token.start, line.start, highlight.start) < Math.min(token.end, line.end, highlight.end)
    const previous = parts[parts.length - 1]
    if (previous?.highlighted === highlighted) previous.text += ` ${text}`
    else parts.push({ text: `${parts.length ? ' ' : ''}${text}`, highlighted })
  }
  return parts
}

export function distinctLyricCandidates(ranked: LyricCandidate[]): LyricCandidate[] {
  const unique: LyricCandidate[] = []
  for (const candidate of [...ranked].sort((a, b) => b.score - a.score)) {
    const duplicate = unique.some(item => {
      const overlap = Math.max(0, Math.min(item.end, candidate.end) - Math.max(item.start, candidate.start))
      const shorter = Math.min(item.end - item.start, candidate.end - candidate.start)
      const nearbyBoundary = Math.min(Math.abs(item.start - candidate.start), Math.abs(item.end - candidate.end)) <= Math.max(2, shorter * 0.25)
      return overlap > 0 && overlap / shorter >= 0.8 && nearbyBoundary
    })
    if (!duplicate) unique.push(candidate)
    if (unique.length >= 8) break
  }
  return unique
}

export function findLyricCandidates(tree: ProjectObjectTree, unit: SynthesisUnitObjectNode, segment: SynthesisSegmentObject, reference: LyricReference, session: LyricSession, query?: string): { candidates: LyricCandidate[]; conflict: boolean } {
  const items = [...unit.synthesisUnit.segmentTrack.items].sort((a, b) => a.startFrame - b.startFrame)
  const position = items.findIndex(item => item.id === segment.id)
  const confirmed = (item: SynthesisSegmentObject) => {
    const draft = session.drafts[item.id]
    const ranges = confirmedLyricRanges(draft, session.instanceId)
    return draftIsCurrent(unit, item, draft, reference) && ranges.length === 1 ? ranges[0] : null
  }
  const before = items.slice(0, position).reverse().map(confirmed).find(Boolean)
  const after = items.slice(position + 1).map(confirmed).find(Boolean)
  const conflict = !!before && !!after && before.start > after.end
  const slack = Math.max(16, normalize(segment.text).length * 2)
  const lower = conflict ? 0 : Math.max(0, (before?.end ?? 0) - slack)
  const upper = conflict ? reference.text.length : Math.min(reference.text.length, (after?.start ?? reference.text.length) + slack)
  const all = [
    ...substringMatches(query ?? segment.text, indexText(reference.text)).map(match => ({ ...match, kana: readingForRange(reference, match) })),
    ...(!query && reference.tokens.length ? substringMatches(segment.kana, indexText(reference.text, sungReadingTokens(reference))).map(match => ({ ...match, kana: match.reading })) : []),
  ]
  const instance = getUnitInstances(tree, unit.id).find(item => item.id === session.instanceId)
  const actual = absoluteSegmentRange(unit, segment, instance)
  const temporal: LyricRange[] = []
  const nodes = buildNodeIndex(tree.root).nodes
  if (actual && !query) {
    for (const [id, otherSession] of Object.entries(tree.lyricProofreading?.sessions ?? {})) {
      if (id === unit.id || otherSession.referenceId !== reference.id) continue
      const other = nodes[id]
      if (other?.kind !== 'synthesisUnit') continue
      for (const otherSegment of other.synthesisUnit.segmentTrack.items) {
        const draft = otherSession.drafts[otherSegment.id]
        if (!draftIsCurrent(other, otherSegment, draft, reference)) continue
        for (const otherInstance of getUnitInstances(tree, id)) {
          const ranges = confirmedLyricRanges(draft, otherInstance.id)
          if (ranges.length !== 1) continue
          const range = absoluteSegmentRange(other, otherSegment, otherInstance)
          if (range && actual[0] < range[1] + 1.5 && actual[1] > range[0] - 1.5) temporal.push(ranges[0])
        }
      }
    }
  }
  const prevText = normalize(items[position - 1]?.text ?? '').slice(-24)
  const nextText = normalize(items[position + 1]?.text ?? '').slice(0, 24)
  const similarity = (a: string, b: string) => !a || !b ? 0 : substringMatches(a, indexText(b)).reduce((best, item) => Math.max(best, item.score), 0)
  const ranked = all.map(match => {
    const local = !conflict && match.start >= lower && match.end <= upper
    const time = temporal.some(range => match.start < range.end + slack && match.end > range.start - slack)
    const context = query ? 0 : similarity(prevText, reference.text.slice(Math.max(0, match.start - 32), match.start)) + similarity(nextText, reference.text.slice(match.end, match.end + 32))
    const proximity = !query && !conflict ? (before ? 0.14 / (1 + Math.abs(match.start - before.end) / 12) : 0) + (after ? 0.14 / (1 + Math.abs(match.end - after.start) / 12) : 0) : 0
    return { start: match.start, end: match.end, text: reference.text.slice(match.start, match.end), kana: match.kana,
      score: match.score + (local && (before || after) && !query ? 0.18 : 0) + (time ? 0.12 : 0) + context * 0.07 + proximity,
      reason: time ? '实际时间相近' : local && (before || after) ? '已确认邻段附近' : context > 0.8 ? '前后文相近' : '全文文字 / 读音候选' }
  }).sort((a, b) => b.score - a.score)
  return { candidates: distinctLyricCandidates(ranked), conflict }
}

export function applyLyricDrafts(tree: ProjectObjectTree, unitId: string, segmentIds?: string[]): number {
  const node = buildNodeIndex(tree.root).nodes[unitId]
  const session = tree.lyricProofreading?.sessions[unitId]
  const reference = tree.lyricProofreading?.references.find(item => item.id === session?.referenceId)
  if (node?.kind !== 'synthesisUnit' || !session || !reference) throw new Error('校对对象或参考歌词已不存在')
  const confirmed = Object.entries(session.drafts).filter(([id, draft]) => draft.status === 'confirmed' && (!segmentIds || segmentIds.includes(id)))
  for (const [id, draft] of confirmed) {
    const segment = node.synthesisUnit.segmentTrack.items.find(item => item.id === id)
    if (!segment || !draftIsCurrent(node, segment, draft, reference)) throw new Error('源歌词或参考已更新，请先复核草稿')
    if (!draft.text.trim() || !draft.kana.trim()) throw new Error('原文和读音均须确认后才能应用')
    if (draft.readingText !== undefined && draft.readingText !== draft.text) throw new Error('原文已修改，请重新核对读音')
  }
  for (const [id, draft] of confirmed) {
    const segment = node.synthesisUnit.segmentTrack.items.find(item => item.id === id)!
    const readingChanged = normalize(segment.kana) !== normalize(draft.kana)
    if (readingChanged) draft.control = { kanaRevision: node.synthesisUnit.kanaTrack.revision, hRevision: node.synthesisUnit.hTokenTrack.revision, segmentRevision: node.synthesisUnit.segmentTrack.revision + 1 }
    if (segment.text !== draft.text || segment.kana !== draft.kana) {
      updateSegmentObject(node, { segmentId: id, patch: { text: draft.text, kana: draft.kana, romaji: readingChanged ? kanaToRomaji(draft.kana) : segment.romaji }, operation: '歌词辅助校对' })
    }
    draft.status = 'applied'
    draft.source = segmentFingerprint(node, node.synthesisUnit.segmentTrack.items.find(item => item.id === id)!)
  }
  return confirmed.length
}
