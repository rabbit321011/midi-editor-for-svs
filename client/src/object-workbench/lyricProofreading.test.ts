import { describe, expect, it } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { createEmptyProjectObjectTree, createEmptySynthesisUnit, TOP_LEVEL_IDS } from './index'
import type { SynthesisSegmentObject, TrackObjectNode } from './types'
import { absoluteSegmentRange, applyLyricDrafts, confirmedLyricRanges, confirmLyricPosition, distinctLyricCandidates, draftIsCurrent, findLyricCandidates, lyricStatus, referenceLyricLines, referenceRomajiParts, segmentFingerprint, type LyricDraft, type LyricReference, type LyricSession } from './lyricProofreading'
import { useObjectTreeStore } from '@/stores/objectTree'
import { useHistoryStore } from '@/stores/history'

function fixture(text = '君の声が聞こえる\n遠い空の向こうから') {
  const unit = createEmptySynthesisUnit({ id: 'syn:test', name: 'Guide', defaultTimelineStart: null, guide: {
    assetId: 'guide', audioSHA256: 'a'.repeat(64), sampleRate: 44100, channels: 1, sampleCount: 441000, duration: 10,
    source: { sourceAudioObjectId: 'audio', sourceAssetId: 'source', effectiveStartSample: 0, effectiveEndSampleExclusive: 441000, sourceTimelineStart: null, resolverManifest: 'test' },
  } })
  const segment: SynthesisSegmentObject = { id: 's1', text: '声が聞こえる遠い', kana: 'こえがきこえるとおい', romaji: '', startFrame: 5, speechEndFrameExclusive: 50, origin: 'user' }
  unit.synthesisUnit.segmentTrack.items = [segment]
  unit.synthesisUnit.segmentTrack.status = 'ready'
  const reference: LyricReference = { id: 'ref', name: 'Lyrics', text, version: 1, tokens: [] }
  const session: LyricSession = { referenceId: reference.id, currentSegmentId: segment.id, instanceId: null, drafts: {} }
  const tree = createEmptyProjectObjectTree()
  const folder = tree.root.children.find(item => item.id === TOP_LEVEL_IDS.workspace)
  if (folder?.kind !== 'folder') throw new Error('workspace missing')
  folder.children.push(unit)
  tree.lyricProofreading = { references: [reference], sessions: { [unit.id]: session } }
  const draft = (): LyricDraft => ({ source: segmentFingerprint(unit, segment), text: '正しい歌詞', kana: 'ただしいうた', ranges: [{ start: 0, end: 4 }], status: 'confirmed', referenceVersion: 1, instanceId: null })
  return { tree, unit, segment, reference, session, draft }
}

describe('lyric proofreading', () => {
  it('ignores cached placeholder readings for spaces without deleting the real word kigou', () => {
    const reference: LyricReference = { id: 'ref', name: 'reference', version: 1, text: '朝　記号', tokens: [
      { start: 0, end: 1, kana: 'あさ' }, { start: 1, end: 2, kana: 'きごう' }, { start: 2, end: 4, kana: 'きごう' },
    ] }
    expect(referenceLyricLines(reference)[0].romaji).toBe('a sa ki go u')
  })
  it('highlights only corresponding reading tokens across lyric lines', () => {
    const reference: LyricReference = { id: 'ref', name: 'reference', version: 1, text: '鏡の中\n朝だね', tokens: [
      { start: 0, end: 1, kana: 'かがみ' }, { start: 1, end: 2, kana: 'の' }, { start: 2, end: 3, kana: 'なか' },
      { start: 4, end: 5, kana: 'あさ' }, { start: 5, end: 7, kana: 'だね' },
    ] }
    const highlight = { start: 2, end: 5 }
    expect(referenceRomajiParts(reference, { start: 0, end: 3 }, highlight)).toEqual([
      { text: 'ka ga mi no', highlighted: false }, { text: ' na ka', highlighted: true },
    ])
    expect(referenceRomajiParts(reference, { start: 4, end: 7 }, highlight)).toEqual([
      { text: 'a sa', highlighted: true }, { text: ' da ne', highlighted: false },
    ])
    expect(referenceRomajiParts(reference, { start: 0, end: 3 })).toEqual([{ text: 'ka ga mi no na ka', highlighted: false }])
  })

  it('collapses length variants at one location without hiding a repeated chorus elsewhere', () => {
    const candidates = [28, 30, 32, 36, 80].map((end, index) => ({ start: 12, end, score: 1 - index * 0.03, text: '候选', kana: '', reason: 'context' }))
    candidates.push({ start: 384, end: 400, score: 0.8, text: '重复副歌', kana: '', reason: 'text' })
    expect(distinctLyricCandidates(candidates).map(item => [item.start, item.end])).toEqual([[12, 28], [384, 400]])
  })

  it('renders per-line romaji while retaining original CRLF and UTF-16 source offsets', () => {
    const reference: LyricReference = { id: 'ref', name: 'reference', version: 1, text: '🌸君\r\n声\n', tokens: [
      { start: 2, end: 3, kana: 'きみ' }, { start: 5, end: 6, kana: 'こえ' },
    ] }
    expect(referenceLyricLines(reference)).toEqual([
      { start: 0, end: 3, text: '🌸君', romaji: 'ki mi' },
      { start: 5, end: 6, text: '声', romaji: 'ko e' },
      { start: 7, end: 7, text: '', romaji: '' },
    ])
  })

  it('matches across reference line breaks without changing Segment boundaries', () => {
    const f = fixture()
    const before = JSON.stringify(f.segment)
    const result = findLyricCandidates(f.tree, f.unit, f.segment, f.reference, f.session)
    expect(result.candidates[0].text).toBe('声が聞こえる\n遠い')
    expect(JSON.stringify(f.segment)).toBe(before)
  })

  it('tolerates missing characters and preserves UTF-16 offsets', () => {
    const f = fixture('🌸\nずっと待ってる\nまた会おう')
    f.segment.text = 'ずと待ってる'
    const result = findLyricCandidates(f.tree, f.unit, f.segment, f.reference, f.session)
    expect(result.candidates[0].text).toBe('ずっと待ってる')
    expect(result.candidates[0].start).toBe(3)
  })

  it('uses readings and permits a reference word to overlap two segments', () => {
    const f = fixture('聞こえる')
    f.reference.tokens = [{ start: 0, end: 4, kana: 'きこえる' }]
    f.segment.text = '誤認'; f.segment.kana = 'きこ'
    const result = findLyricCandidates(f.tree, f.unit, f.segment, f.reference, f.session)
    expect(result.candidates[0]).toMatchObject({ start: 0, end: 4, kana: 'きこ' })
  })

  it('keeps repeated candidates and uses confirmed neighbors as soft context', () => {
    const f = fixture('あした\n君の声\n春の道\nはるかな\n君の声\n冬の海')
    f.segment.text = '君の声'
    const prev = { ...f.segment, id: 's0', text: 'はるかな', startFrame: 0, speechEndFrameExclusive: 5 }
    f.unit.synthesisUnit.segmentTrack.items.unshift(prev)
    f.session.drafts.s0 = { ...f.draft(), source: segmentFingerprint(f.unit, prev), ranges: [{ start: 13, end: 17 }] }
    const result = findLyricCandidates(f.tree, f.unit, f.segment, f.reference, f.session)
    expect(result.candidates[0].start).toBe(f.reference.text.lastIndexOf('君の声'))
    expect(result.candidates.filter(item => item.text === '君の声').length).toBe(2)
  })

  it('does not restrict repeated use of an earlier reference range', () => {
    const f = fixture('同じ歌\n違う歌')
    f.segment.text = '同じ歌'
    const previous = { ...f.segment, id: 's0', text: '違う歌', startFrame: 0, speechEndFrameExclusive: 5 }
    f.unit.synthesisUnit.segmentTrack.items.unshift(previous)
    f.session.drafts.s0 = { ...f.draft(), source: segmentFingerprint(f.unit, previous), ranges: [{ start: 4, end: 7 }] }
    expect(findLyricCandidates(f.tree, f.unit, f.segment, f.reference, f.session).candidates[0].text).toBe('同じ歌')
  })

  it('derives absolute time per instance and rejects transformed instances', () => {
    const f = fixture()
    const instance: TrackObjectNode = { id: 'instance', kind: 'trackObject', name: 'SYN', trackObject: { contentType: 'audio', sourceObjectId: f.unit.id, timelineStart: 20, timelineEnd: 30, ignored: false } }
    expect(absoluteSegmentRange(f.unit, f.segment, instance)?.[0]).toBeCloseTo(20 + 5 / (44100 / 2048))
    instance.trackObject.timelineStart += 10; instance.trackObject.timelineEnd += 10
    expect(absoluteSegmentRange(f.unit, f.segment, instance)?.[0]).toBeCloseTo(30 + 5 / (44100 / 2048))
    instance.trackObject.timelineEnd += 5
    expect(absoluteSegmentRange(f.unit, f.segment, instance)).toBeNull()
    expect(absoluteSegmentRange(f.unit, f.segment)).toBeNull()
  })

  it('applies text atomically, preserves other tracks and supports snapshot undo/redo', () => {
    setActivePinia(createPinia())
    const f = fixture()
    f.session.drafts.s1 = f.draft()
    const store = useObjectTreeStore()
    store.loadObjectTree(f.tree)
    const before = store.snapshotTree()
    expect(applyLyricDrafts(store.tree, f.unit.id)).toBe(1)
    const after = store.snapshotTree()
    const node = store.node(f.unit.id)!
    if (node.kind !== 'synthesisUnit') throw new Error('unit')
    expect(node.synthesisUnit.segmentTrack.items[0]).toMatchObject({ startFrame: 5, speechEndFrameExclusive: 50, text: '正しい歌詞', kana: 'ただしいうた' })
    expect(node.synthesisUnit.kanaTrack.revision).toBe(0)
    expect(node.synthesisUnit.hTokenTrack.revision).toBe(0)
    expect(lyricStatus(node, node.synthesisUnit.segmentTrack.items[0], f.session, f.reference)).toBe('发音控制待更新')
    const history = useHistoryStore()
    history.push({ description: 'proofread', patches: [], inversePatches: [], objectTree: { kind: 'snapshot', before, after } })
    history.undo(); expect(store.snapshotTree()).toEqual(before)
    history.redo(); expect(store.snapshotTree()).toEqual(after)
  })

  it('invalidates edited references and refuses all stale confirmed edits before writing', () => {
    const f = fixture()
    f.session.drafts.s1 = f.draft()
    f.reference.version++
    expect(draftIsCurrent(f.unit, f.segment, f.session.drafts.s1, f.reference)).toBe(false)
    const before = JSON.stringify(f.tree)
    expect(() => applyLyricDrafts(f.tree, f.unit.id)).toThrow('复核')
    expect(JSON.stringify(f.tree)).toBe(before)
  })

  it('persists drafts and does not mark spelling-only edits as pending controls', () => {
    const f = fixture()
    f.session.drafts.s1 = { ...f.draft(), kana: f.segment.kana, ranges: [] }
    const reloaded = JSON.parse(JSON.stringify(f.tree))
    expect(applyLyricDrafts(reloaded, f.unit.id)).toBe(1)
    expect(reloaded.lyricProofreading.sessions[f.unit.id].drafts.s1.control).toBeUndefined()
    expect(reloaded.lyricProofreading.sessions[f.unit.id].drafts.s1.ranges).toEqual([])
  })

  it('keeps repeated-instance positions separate and never infers a copied instance position', () => {
    const f = fixture()
    const draft = f.draft()
    confirmLyricPosition(draft, 'first-instance')
    draft.ranges = [{ start: 10, end: 14 }]
    confirmLyricPosition(draft, 'second-instance')
    expect(confirmedLyricRanges(draft, 'first-instance')).toEqual([{ start: 0, end: 4 }])
    expect(confirmedLyricRanges(draft, 'second-instance')).toEqual([{ start: 10, end: 14 }])
    expect(confirmedLyricRanges(draft, 'copied-instance')).toEqual([])
  })

  it('rejects an outdated reading but allows applying a selected valid subset', () => {
    const f = fixture()
    f.session.drafts.s1 = { ...f.draft(), readingText: 'old words' }
    expect(() => applyLyricDrafts(f.tree, f.unit.id)).toThrow('核对读音')
    f.session.drafts.s1.readingText = f.session.drafts.s1.text
    f.session.drafts.deletedSegment = f.draft()
    expect(applyLyricDrafts(f.tree, f.unit.id, ['s1'])).toBe(1)
  })

  it('does not clear the pending-control warning for a clear-H operation', () => {
    const f = fixture()
    f.session.drafts.s1 = f.draft()
    applyLyricDrafts(f.tree, f.unit.id)
    const segment = f.unit.synthesisUnit.segmentTrack.items[0]
    const revision = { id: 'h1', revision: 1, track: 'h' as const, operation: 'clear Segment H range', sourceRefs: [{ unitId: f.unit.id, track: 'segment' as const, revision: f.unit.synthesisUnit.segmentTrack.revision }], affectedStartFrame: 0, affectedEndFrameExclusive: 60, createdAt: '2026-09-29T00:00:00Z' }
    f.unit.synthesisUnit.hTokenTrack.revisions.push(revision)
    expect(lyricStatus(f.unit, segment, f.session, f.reference)).toBe('发音控制待更新')
    revision.operation = 'Segment -> H'
    expect(lyricStatus(f.unit, segment, f.session, f.reference)).toBe('已应用')
  })

  it('uses confirmed absolute-time anchors from another SYN to rank repeated lyrics', () => {
    const f = fixture(`${'春の道'.repeat(20)}君の声${'冬の海'.repeat(20)}君の声`)
    f.segment.text = '君の声'
    const other = JSON.parse(JSON.stringify(f.unit)) as typeof f.unit
    other.id = 'syn:other'
    const folder = f.tree.root.children.find(item => item.id === TOP_LEVEL_IDS.workspace)!
    if (folder.kind !== 'folder') throw new Error('workspace')
    folder.children.push(other)
    const instances = [f.unit, other].map((unit): TrackObjectNode => ({ id: `instance:${unit.id}`, kind: 'trackObject', name: unit.name, trackObject: { contentType: 'audio', sourceObjectId: unit.id, timelineStart: 30, timelineEnd: 40, ignored: false } }))
    folder.children.push(...instances)
    f.session.instanceId = instances[0].id
    const anchor = f.draft()
    anchor.source = segmentFingerprint(other, other.synthesisUnit.segmentTrack.items[0])
    anchor.ranges = [{ start: f.reference.text.lastIndexOf('君の声'), end: f.reference.text.length }]
    confirmLyricPosition(anchor, instances[1].id)
    f.tree.lyricProofreading!.sessions[other.id] = { ...f.session, instanceId: instances[1].id, drafts: { s1: anchor } }
    expect(findLyricCandidates(f.tree, f.unit, f.segment, f.reference, f.session).candidates[0].start).toBe(f.reference.text.lastIndexOf('君の声'))
  })
})
