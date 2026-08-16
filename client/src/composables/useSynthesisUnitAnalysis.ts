import { reactive } from 'vue'
import { buildKanaPhraseContexts, getKanaControlRange, getKanaPhraseForSegment, normalizeKanaMora, sofaPhrasesToSegmentObjects } from '@/object-workbench'
import { useHistoryStore } from '@/stores/history'
import { useObjectTreeStore } from '@/stores/objectTree'
import { useTracksStore } from '@/stores/tracks'
import { runWhisperSofa } from './whisperSofaClient'
import { runSynthesisTextControl } from './synthesisTextControlClient'
import type { SynthesisTextControlResult } from './synthesisTextControlProtocol'
import { runSynthesisMidiP } from './synthesisMidiPClient'
import { combineSegmentsToBlob } from '@/api/wav'

export type SegmentTextControlTarget = 'kana' | 'h'
export type SynthesisAnalysisTaskKind = 'segment' | 'kana' | 'h' | 'midi-p'

export interface SynthesisAnalysisJobState {
  running: boolean
  progress: number
  message: string
  error: string
  kind: SynthesisAnalysisTaskKind | null
}

export function useSynthesisUnitAnalysis() {
  const objectTree = useObjectTreeStore()
  const tracks = useTracksStore()
  const history = useHistoryStore()
  const jobs = reactive<Record<string, SynthesisAnalysisJobState>>({})
  const textControlCache = new Map<string, SynthesisTextControlResult>()

  function stateFor(unitId: string): SynthesisAnalysisJobState {
    return jobs[unitId] ??= { running: false, progress: 0, message: '', error: '', kind: null }
  }

  async function transcribeSegmentTrack(unitId: string): Promise<{ ok: boolean; reason?: string }> {
    const state = stateFor(unitId)
    if (state.running) return { ok: false, reason: '该合成单元已有分析任务运行中' }
    const unit = objectTree.node(unitId)
    if (!unit || unit.kind !== 'synthesisUnit') return { ok: false, reason: '合成单元不存在' }
    const asset = objectTree.tree.assets[unit.synthesisUnit.guide.assetId]
    const blob = asset?.blobKey ? tracks.sourceBlobs.get(asset.blobKey) : null
    if (!blob) return { ok: false, reason: 'Owned Guide blob 不存在' }

    const sourceSnapshot = {
      guideSHA256: unit.synthesisUnit.guide.audioSHA256,
      segmentRevision: unit.synthesisUnit.segmentTrack.revision,
      frameCount: unit.synthesisUnit.frameContract.frameCount,
    }
    state.running = true
    state.progress = 0
    state.message = '准备 Whisper + SOFA'
    state.error = ''
    state.kind = 'segment'
    try {
      const result = await runWhisperSofa({
        blob,
        sampleRate: unit.synthesisUnit.guide.sampleRate,
        outputName: `${unit.name}_segment`,
        onProgress: (progress, message) => {
          state.progress = progress
          state.message = message
        },
      })
      if (result.phrases.length === 0) throw new Error('SOFA 未返回保留原文的 phrase 结果')
      const current = objectTree.node(unitId)
      if (!current || current.kind !== 'synthesisUnit') throw new Error('分析完成前合成单元已删除')
      if (
        current.synthesisUnit.guide.audioSHA256 !== sourceSnapshot.guideSHA256
        || current.synthesisUnit.segmentTrack.revision !== sourceSnapshot.segmentRevision
        || current.synthesisUnit.frameContract.frameCount !== sourceSnapshot.frameCount
      ) {
        throw new Error('SegmentTrack 或 Guide 已在分析期间更新；旧任务结果未写入')
      }

      const segments = sofaPhrasesToSegmentObjects(result.phrases, sourceSnapshot.frameCount)
      const before = objectTree.snapshotTree()
      const replaced = objectTree.replaceSynthesisSegmentTrack(unitId, segments)
      if (!replaced.ok) throw new Error(replaced.reason || 'SegmentTrack 写入失败')
      history.push({
        description: 'Guide → Whisper + SOFA → SegmentTrack',
        patches: [],
        inversePatches: [],
        objectTree: { kind: 'snapshot', before, after: objectTree.snapshotTree() },
      })
      state.progress = 100
      state.message = `SegmentTrack r${sourceSnapshot.segmentRevision + 1} · confidence ${result.confidence ?? 'n/a'}`
      return { ok: true }
    } catch (error: any) {
      state.error = error?.message || 'Whisper + SOFA 失败'
      state.message = state.error
      return { ok: false, reason: state.error }
    } finally {
      state.running = false
      state.kind = null
    }
  }

  async function transcribeSegmentText(unitId: string, segmentId: string): Promise<{ ok: boolean; reason?: string }> {
    const state = stateFor(unitId)
    if (state.running) return { ok: false, reason: '该合成单元已有分析任务运行中' }
    const unit = objectTree.node(unitId)
    if (!unit || unit.kind !== 'synthesisUnit') return { ok: false, reason: '合成单元不存在' }
    const segment = unit.synthesisUnit.segmentTrack.items.find(item => item.id === segmentId)
    if (!segment) return { ok: false, reason: 'Segment 不存在' }
    const asset = objectTree.tree.assets[unit.synthesisUnit.guide.assetId]
    const guideBlob = asset?.blobKey ? tracks.sourceBlobs.get(asset.blobKey) : null
    if (!guideBlob) return { ok: false, reason: 'Owned Guide blob 不存在' }

    const sourceSnapshot = {
      guideSHA256: unit.synthesisUnit.guide.audioSHA256,
      segmentRevision: unit.synthesisUnit.segmentTrack.revision,
      frameCount: unit.synthesisUnit.frameContract.frameCount,
    }
    const startFrame = segment.startFrame
    const endFrameExclusive = segment.speechEndFrameExclusive
    const frameRate = unit.synthesisUnit.frameContract.frameRate
    const sampleRate = unit.synthesisUnit.guide.sampleRate
    state.running = true
    state.progress = 0
    state.message = '准备当前 Segment 的 Whisper 转录'
    state.error = ''
    state.kind = 'segment'
    try {
      const blob = await combineSegmentsToBlob([{
        blob: guideBlob,
        startSample: startFrame * unit.synthesisUnit.frameContract.hopSamples,
        endSample: endFrameExclusive * unit.synthesisUnit.frameContract.hopSamples,
        timelineStart: 0,
        sampleRate,
      }], (endFrameExclusive - startFrame) / frameRate, sampleRate)
      const result = await runWhisperSofa({
        blob,
        sampleRate,
        outputName: `${unit.name}_segment_${segmentId}`,
        onProgress: (progress, message) => {
          state.progress = progress
          state.message = message
        },
      })
      const text = result.phrases.map(phrase => phrase.text.trim()).filter(Boolean).join('')
      const kana = result.phrases.map(phrase => phrase.kana.trim()).filter(Boolean).join('')
      const romaji = result.phrases.map(phrase => phrase.romaji.trim()).filter(Boolean).join(' ')
      if (!text) throw new Error('Whisper 未返回当前 Segment 的文字')
      if (!kana || !romaji) throw new Error('SOFA 未返回当前 Segment 的假名或罗马音')

      const current = objectTree.node(unitId)
      if (!current || current.kind !== 'synthesisUnit') throw new Error('转录完成前合成单元已删除')
      if (
        current.synthesisUnit.guide.audioSHA256 !== sourceSnapshot.guideSHA256
        || current.synthesisUnit.segmentTrack.revision !== sourceSnapshot.segmentRevision
        || current.synthesisUnit.frameContract.frameCount !== sourceSnapshot.frameCount
      ) {
        throw new Error('Segment 或 Guide 已在转录期间更新；旧任务结果未写入')
      }

      const before = objectTree.snapshotTree()
      const updated = objectTree.updateSynthesisSegment(
        unitId,
        segmentId,
        { text, kana, romaji },
        'Whisper + SOFA 重新转录 Segment 文本',
      )
      if (!updated.ok) throw new Error(updated.reason || 'Segment 文本写入失败')
      history.push({
        description: '重新转录 Segment 文本',
        patches: [],
        inversePatches: [],
        objectTree: { kind: 'snapshot', before, after: objectTree.snapshotTree() },
      })
      state.progress = 100
      state.message = `已更新：${kana} · ${romaji}`
      return { ok: true }
    } catch (error: any) {
      state.error = error?.message || 'Segment 文本转录失败'
      state.message = state.error
      return { ok: false, reason: state.error }
    } finally {
      state.running = false
      state.kind = null
    }
  }

  async function alignSegmentTextControl(
    unitId: string,
    segmentId: string,
    target: SegmentTextControlTarget,
  ): Promise<{ ok: boolean; reason?: string }> {
    const state = stateFor(unitId)
    if (state.running) return { ok: false, reason: '该合成单元已有分析任务运行中' }
    const unit = objectTree.node(unitId)
    if (!unit || unit.kind !== 'synthesisUnit') return { ok: false, reason: '合成单元不存在' }
    const selectedIndex = unit.synthesisUnit.segmentTrack.items.findIndex(item => item.id === segmentId)
    if (selectedIndex < 0) return { ok: false, reason: 'Segment 不存在' }
    const asset = objectTree.tree.assets[unit.synthesisUnit.guide.assetId]
    const blob = asset?.blobKey ? tracks.sourceBlobs.get(asset.blobKey) : null
    if (!blob) return { ok: false, reason: 'Owned Guide blob 不存在' }

    const segments = unit.synthesisUnit.segmentTrack.items.map(segment => ({
      ...segment,
      generatedFrom: segment.generatedFrom ? { ...segment.generatedFrom } : undefined,
    }))
    const selected = segments[selectedIndex]
    const sourceSnapshot = {
      guideSHA256: unit.synthesisUnit.guide.audioSHA256,
      segmentRevision: unit.synthesisUnit.segmentTrack.revision,
      targetRevision: target === 'kana'
        ? unit.synthesisUnit.kanaTrack.revision
        : unit.synthesisUnit.hTokenTrack.revision,
      frameCount: unit.synthesisUnit.frameContract.frameCount,
    }
    state.running = true
    state.progress = 0
    state.message = target === 'kana' ? '准备 Segment → Kana' : '准备 Segment → H Token'
    state.error = ''
    state.kind = target
    try {
      const cacheKey = [unitId, sourceSnapshot.guideSHA256, sourceSnapshot.frameCount, sourceSnapshot.segmentRevision].join(':')
      let result = textControlCache.get(cacheKey)
      if (!result) {
        result = await runSynthesisTextControl({
          blob,
          sampleRate: unit.synthesisUnit.guide.sampleRate,
          guideSHA256: sourceSnapshot.guideSHA256,
          frameCount: sourceSnapshot.frameCount,
          sourceTrack: 'segment',
          sourceRevision: sourceSnapshot.segmentRevision,
          phrases: segments.map(segment => ({
            id: segment.id,
            kana: segment.kana || segment.text,
            startFrame: segment.startFrame,
            endFrameExclusive: segment.speechEndFrameExclusive,
          })),
          onProgress: (progress, message) => {
            state.progress = progress
            state.message = message
          },
        })
        textControlCache.set(cacheKey, result)
      } else {
        state.progress = 100
        state.message = '复用当前 Guide / Segment revision 的 SOFA 候选'
      }

      const current = objectTree.node(unitId)
      if (!current || current.kind !== 'synthesisUnit') throw new Error('对齐完成前合成单元已删除')
      const currentTargetRevision = target === 'kana'
        ? current.synthesisUnit.kanaTrack.revision
        : current.synthesisUnit.hTokenTrack.revision
      if (
        current.synthesisUnit.guide.audioSHA256 !== sourceSnapshot.guideSHA256
        || current.synthesisUnit.segmentTrack.revision !== sourceSnapshot.segmentRevision
        || currentTargetRevision !== sourceSnapshot.targetRevision
        || current.synthesisUnit.frameContract.frameCount !== sourceSnapshot.frameCount
      ) {
        throw new Error('源 Segment、Guide 或目标轨已在对齐期间更新；旧任务结果未写入')
      }

      const compiledRange = result.phraseRanges.find(range => range.phraseId === segmentId)
      if (!compiledRange
        || compiledRange.startFrame !== selected.startFrame
        || compiledRange.speechEndFrameExclusive !== selected.speechEndFrameExclusive) {
        throw new Error('Text Control 返回的 Segment frame 范围与启动快照不一致')
      }

      const before = objectTree.snapshotTree()
      if (target === 'kana') {
        const startFrame = selected.startFrame
        const endFrameExclusive = selected.speechEndFrameExclusive
        const sourceRef = {
          unitId,
          track: 'segment' as const,
          revision: sourceSnapshot.segmentRevision,
          guideSHA256: sourceSnapshot.guideSHA256,
        }
        const units = result.kanaUnits
          .filter(item => item.phraseId === segmentId)
          .map(({ phraseId: _phraseId, ...item }) => ({ ...item, generatedFrom: sourceRef }))
        const nextSegmentStart = segments[selectedIndex + 1]?.startFrame
        const boundaries = nextSegmentStart == null
          ? []
          : result.kanaBoundaries.filter(boundary => boundary.frame === nextSegmentStart - 1)
        const boundaryEndFrameExclusive = nextSegmentStart == null
          ? endFrameExclusive
          : Math.min(sourceSnapshot.frameCount, nextSegmentStart + 1)
        if (units.length === 0) throw new Error('SOFA 未返回该 Segment 的 Kana/mora')
        const replaced = objectTree.replaceSynthesisKanaTrackRange(
          unitId,
          startFrame,
          endFrameExclusive,
          units,
          boundaries,
          boundaryEndFrameExclusive,
        )
        if (!replaced.ok) throw new Error(replaced.reason || 'KanaTrack 写入失败')
      } else {
        const startFrame = selected.startFrame
        const endFrameExclusive = segments[selectedIndex + 1]?.startFrame ?? sourceSnapshot.frameCount
        const sourceRef = {
          unitId,
          track: 'segment' as const,
          revision: sourceSnapshot.segmentRevision,
          guideSHA256: sourceSnapshot.guideSHA256,
        }
        const events = result.hEvents
          .filter(event => event.frame >= startFrame && event.frame < endFrameExclusive)
          .map(event => ({ ...event, generatedFrom: sourceRef }))
        if (!events.some(event => event.tokenId === 365)) {
          throw new Error('该 Segment 的训练等价 H 范围缺少 SEP')
        }
        const placement = result.hAudit.phraseModes.find(mode => mode.phraseId === segmentId)
        if (!placement) throw new Error('该 Segment 缺少训练 placement provenance')
        const replaced = objectTree.replaceSynthesisHTokenTrackRange(
          unitId,
          startFrame,
          endFrameExclusive,
          events,
          result.runtimeHashes.vocab,
          result.compilerSHA256,
          'Segment -> H',
          'segment',
          [{
            phraseId: segmentId,
            startFrame,
            endFrameExclusive,
            placementMode: placement.placementMode,
            fallbackReason: placement.fallbackReason,
          }],
        )
        if (!replaced.ok) throw new Error(replaced.reason || 'HTokenTrack 写入失败')
      }
      history.push({
        description: target === 'kana' ? 'Segment → KanaTrack' : 'Segment → HTokenTrack',
        patches: [],
        inversePatches: [],
        objectTree: { kind: 'snapshot', before, after: objectTree.snapshotTree() },
      })
      const updated = objectTree.node(unitId)
      const revision = updated?.kind === 'synthesisUnit'
        ? target === 'kana' ? updated.synthesisUnit.kanaTrack.revision : updated.synthesisUnit.hTokenTrack.revision
        : sourceSnapshot.targetRevision + 1
      state.progress = 100
      state.message = target === 'kana'
        ? `KanaTrack r${revision} · 仅覆盖 frame ${selected.startFrame}..${selected.speechEndFrameExclusive}`
        : `HTokenTrack r${revision} · Phone ${result.hAudit.phonePhraseCount} / PUL ${result.hAudit.pulPhraseCount}`
      return { ok: true }
    } catch (error: any) {
      state.error = error?.message || 'Text Control 对齐失败'
      state.message = state.error
      return { ok: false, reason: state.error }
    } finally {
      state.running = false
      state.kind = null
    }
  }

  async function alignKanaTextControl(
    unitId: string,
    kanaUnitId: string,
  ): Promise<{ ok: boolean; reason?: string }> {
    const state = stateFor(unitId)
    if (state.running) return { ok: false, reason: '该合成单元已有分析任务运行中' }
    const unit = objectTree.node(unitId)
    if (!unit || unit.kind !== 'synthesisUnit') return { ok: false, reason: '合成单元不存在' }
    const asset = objectTree.tree.assets[unit.synthesisUnit.guide.assetId]
    const blob = asset?.blobKey ? tracks.sourceBlobs.get(asset.blobKey) : null
    if (!blob) return { ok: false, reason: 'Owned Guide blob 不存在' }

    let selected
    let phraseContexts
    try {
      selected = getKanaControlRange(
        unit.synthesisUnit.kanaTrack,
        kanaUnitId,
        unit.synthesisUnit.frameContract.frameCount,
      )
      phraseContexts = buildKanaPhraseContexts(
        unit.synthesisUnit.kanaTrack,
        unit.synthesisUnit.frameContract.frameCount,
      )
    } catch (error: any) {
      return { ok: false, reason: error?.message || 'Kana control range 无效' }
    }

    const sourceSnapshot = {
      guideSHA256: unit.synthesisUnit.guide.audioSHA256,
      kanaRevision: unit.synthesisUnit.kanaTrack.revision,
      hRevision: unit.synthesisUnit.hTokenTrack.revision,
      frameCount: unit.synthesisUnit.frameContract.frameCount,
      startFrame: selected.startFrame,
      endFrameExclusive: selected.endFrameExclusive,
      phraseId: selected.phrase.id,
      phraseStartFrame: selected.phrase.startFrame,
      phraseEndFrameExclusive: selected.phrase.endFrameExclusive,
      moraIndex: selected.moraIndex,
      isPhraseEnd: selected.isPhraseEnd,
    }
    state.running = true
    state.progress = 0
    state.message = '准备 Kana → H Token'
    state.error = ''
    state.kind = 'h'
    try {
      const cacheKey = [
        'kana', unitId, sourceSnapshot.guideSHA256,
        sourceSnapshot.frameCount, sourceSnapshot.kanaRevision,
      ].join(':')
      let result = textControlCache.get(cacheKey)
      if (!result) {
        result = await runSynthesisTextControl({
          blob,
          sampleRate: unit.synthesisUnit.guide.sampleRate,
          guideSHA256: sourceSnapshot.guideSHA256,
          frameCount: sourceSnapshot.frameCount,
          sourceTrack: 'kana',
          sourceRevision: sourceSnapshot.kanaRevision,
          phrases: phraseContexts.map(phrase => ({
            id: phrase.id,
            kana: phrase.kana,
            startFrame: phrase.startFrame,
            endFrameExclusive: phrase.endFrameExclusive,
            controlEndFrameExclusive: phrase.controlEndFrameExclusive,
          })),
          onProgress: (progress, message) => {
            state.progress = progress
            state.message = message
          },
        })
        textControlCache.set(cacheKey, result)
      } else {
        state.progress = 100
        state.message = '复用当前 Guide / Kana revision 的 SOFA 候选'
      }

      const current = objectTree.node(unitId)
      if (!current || current.kind !== 'synthesisUnit') throw new Error('对齐完成前合成单元已删除')
      if (
        current.synthesisUnit.guide.audioSHA256 !== sourceSnapshot.guideSHA256
        || current.synthesisUnit.kanaTrack.revision !== sourceSnapshot.kanaRevision
        || current.synthesisUnit.hTokenTrack.revision !== sourceSnapshot.hRevision
        || current.synthesisUnit.frameContract.frameCount !== sourceSnapshot.frameCount
      ) {
        throw new Error('源 Kana、Guide 或 H 轨已在对齐期间更新；旧任务结果未写入')
      }
      const currentRange = getKanaControlRange(
        current.synthesisUnit.kanaTrack,
        kanaUnitId,
        sourceSnapshot.frameCount,
      )
      if (
        currentRange.startFrame !== sourceSnapshot.startFrame
        || currentRange.endFrameExclusive !== sourceSnapshot.endFrameExclusive
        || currentRange.phrase.id !== sourceSnapshot.phraseId
        || currentRange.moraIndex !== sourceSnapshot.moraIndex
      ) {
        throw new Error('Kana control range 与启动快照不一致')
      }

      const compiledPhrase = result.phraseRanges.find(range => range.phraseId === sourceSnapshot.phraseId)
      if (!compiledPhrase
        || compiledPhrase.startFrame !== sourceSnapshot.phraseStartFrame
        || compiledPhrase.speechEndFrameExclusive !== sourceSnapshot.phraseEndFrameExclusive) {
        throw new Error('Text Control 返回的 Kana phrase 范围与启动快照不一致')
      }
      const phraseMode = result.hAudit.phraseModes.find(mode => mode.phraseId === sourceSnapshot.phraseId)
      if (phraseMode?.placementMode !== 'phone') {
        throw new Error(`该 Kana 分句无法取得可靠 phone placement（${phraseMode?.fallbackReason || phraseMode?.placementMode || 'unknown'}）；请改用整句 Segment → H`)
      }
      const selectedEvents = result.hEvents.filter(event => (
        event.phraseId === sourceSnapshot.phraseId
        && event.moraIndex === sourceSnapshot.moraIndex
      ))
      if (selectedEvents.length === 0) throw new Error('SOFA 未返回所选 Kana 的可归属 H token')
      if (selectedEvents.some(event => (
        event.frame < sourceSnapshot.startFrame || event.frame >= sourceSnapshot.endFrameExclusive
      ))) {
        throw new Error('所选 Kana 的 H token 越过当前 control range；请先调整 Kana 边界')
      }
      const foreignEvents = result.hEvents.filter(event => (
        event.phraseId === sourceSnapshot.phraseId
        && event.moraIndex !== undefined
        && event.moraIndex !== sourceSnapshot.moraIndex
        && event.frame >= sourceSnapshot.startFrame
        && event.frame < sourceSnapshot.endFrameExclusive
      ))
      if (foreignEvents.length > 0) {
        throw new Error('相邻 Kana 的 H token 进入当前 control range；请先调整 Kana 边界')
      }

      const sepEvents = result.hEvents.filter(event => (
        event.phraseId === sourceSnapshot.phraseId
        && event.tokenId === 365
        && event.frame >= sourceSnapshot.startFrame
        && event.frame < sourceSnapshot.endFrameExclusive
      ))
      if (sourceSnapshot.isPhraseEnd && sepEvents.length !== 1) {
        throw new Error('Kana 分句末尾缺少唯一 SEP；未覆盖 H')
      }
      if (!sourceSnapshot.isPhraseEnd && sepEvents.length > 0) {
        throw new Error('非句末 Kana control range 意外包含 SEP；未覆盖 H')
      }

      const sourceRef = {
        unitId,
        track: 'kana' as const,
        revision: sourceSnapshot.kanaRevision,
        guideSHA256: sourceSnapshot.guideSHA256,
      }
      const events = [...selectedEvents, ...sepEvents]
        .sort((left, right) => left.frame - right.frame)
        .map(event => ({
          id: event.id,
          frame: event.frame,
          tokenId: event.tokenId,
          symbol: event.symbol,
          origin: 'kana-align' as const,
          generatedFrom: sourceRef,
        }))
      const before = objectTree.snapshotTree()
      const replaced = objectTree.replaceSynthesisHTokenTrackRange(
        unitId,
        sourceSnapshot.startFrame,
        sourceSnapshot.endFrameExclusive,
        events,
        result.runtimeHashes.vocab,
        result.compilerSHA256,
        'Kana -> H',
        'kana',
      )
      if (!replaced.ok) throw new Error(replaced.reason || 'HTokenTrack 写入失败')
      history.push({
        description: 'Kana → HTokenTrack',
        patches: [],
        inversePatches: [],
        objectTree: { kind: 'snapshot', before, after: objectTree.snapshotTree() },
      })
      const updated = objectTree.node(unitId)
      const revision = updated?.kind === 'synthesisUnit'
        ? updated.synthesisUnit.hTokenTrack.revision
        : sourceSnapshot.hRevision + 1
      state.progress = 100
      state.message = `HTokenTrack r${revision} · Kana ${currentRange.unit.kana} · frame ${sourceSnapshot.startFrame}..${sourceSnapshot.endFrameExclusive - 1}`
      return { ok: true }
    } catch (error: any) {
      state.error = error?.message || 'Kana → H 对齐失败'
      state.message = state.error
      return { ok: false, reason: state.error }
    } finally {
      state.running = false
      state.kind = null
    }
  }

  async function alignSegmentFromKana(
    unitId: string,
    segmentId: string,
  ): Promise<{ ok: boolean; reason?: string }> {
    const state = stateFor(unitId)
    if (state.running) return { ok: false, reason: '该合成单元已有分析任务运行中' }
    const unit = objectTree.node(unitId)
    if (!unit || unit.kind !== 'synthesisUnit') return { ok: false, reason: '合成单元不存在' }
    const segments = [...unit.synthesisUnit.segmentTrack.items].sort((left, right) => left.startFrame - right.startFrame)
    const segmentIndex = segments.findIndex(item => item.id === segmentId)
    if (segmentIndex < 0) return { ok: false, reason: 'Segment 不存在' }
    const segment = segments[segmentIndex]
    const controlEndFrameExclusive = segments[segmentIndex + 1]?.startFrame ?? unit.synthesisUnit.frameContract.frameCount
    const asset = objectTree.tree.assets[unit.synthesisUnit.guide.assetId]
    const blob = asset?.blobKey ? tracks.sourceBlobs.get(asset.blobKey) : null
    if (!blob) return { ok: false, reason: 'Owned Guide blob 不存在' }

    let phrase
    try {
      phrase = getKanaPhraseForSegment(unit.synthesisUnit.kanaTrack, unit.synthesisUnit.frameContract.frameCount, {
        segmentStartFrame: segment.startFrame,
        segmentSpeechEndFrameExclusive: segment.speechEndFrameExclusive,
        segmentControlEndFrameExclusive: controlEndFrameExclusive,
      })
    } catch (error: any) {
      return { ok: false, reason: error?.message || '当前 Segment 的 Kana 分句无效' }
    }

    const sourceSnapshot = {
      guideSHA256: unit.synthesisUnit.guide.audioSHA256,
      kanaRevision: unit.synthesisUnit.kanaTrack.revision,
      hRevision: unit.synthesisUnit.hTokenTrack.revision,
      frameCount: unit.synthesisUnit.frameContract.frameCount,
      phraseId: phrase.id,
      startFrame: segment.startFrame,
      speechEndFrameExclusive: segment.speechEndFrameExclusive,
      controlEndFrameExclusive,
    }
    state.running = true
    state.progress = 0
    state.message = '准备按当前 Segment Kana → H Token'
    state.error = ''
    state.kind = 'h'
    try {
      // This command is explicitly based on the Kana currently visible under
      // the Segment. Do not reuse an older SOFA result: the user may have
      // changed Kana text or any of its frame boundaries without changing the
      // semantic scope represented by the old cache key.
      const result = await runSynthesisTextControl({
        blob,
        sampleRate: unit.synthesisUnit.guide.sampleRate,
        guideSHA256: sourceSnapshot.guideSHA256,
        frameCount: sourceSnapshot.frameCount,
        sourceTrack: 'kana',
        sourceRevision: sourceSnapshot.kanaRevision,
        phrases: [{
          id: phrase.id,
          kana: phrase.kana,
          startFrame: phrase.startFrame,
          endFrameExclusive: phrase.endFrameExclusive,
          controlEndFrameExclusive: phrase.controlEndFrameExclusive,
          kanaUnits: phrase.units.map(({ unit }) => ({
            id: unit.id,
            kana: unit.kana,
            startFrame: unit.startFrame,
            endFrameExclusive: unit.endFrameExclusive,
          })),
        }],
        hardKanaBoundaries: true,
        onProgress: (progress, message) => {
          state.progress = progress
          state.message = message
        },
      })

      const current = objectTree.node(unitId)
      if (!current || current.kind !== 'synthesisUnit') throw new Error('对齐完成前合成单元已删除')
      if (current.synthesisUnit.guide.audioSHA256 !== sourceSnapshot.guideSHA256
        || current.synthesisUnit.kanaTrack.revision !== sourceSnapshot.kanaRevision
        || current.synthesisUnit.hTokenTrack.revision !== sourceSnapshot.hRevision
        || current.synthesisUnit.frameContract.frameCount !== sourceSnapshot.frameCount) {
        throw new Error('源 Kana、Guide 或 H 轨已在对齐期间更新；旧任务结果未写入')
      }
      getKanaPhraseForSegment(current.synthesisUnit.kanaTrack, sourceSnapshot.frameCount, {
        segmentStartFrame: sourceSnapshot.startFrame,
        segmentSpeechEndFrameExclusive: sourceSnapshot.speechEndFrameExclusive,
        segmentControlEndFrameExclusive: sourceSnapshot.controlEndFrameExclusive,
      })
      const compiledRange = result.phraseRanges.find(item => item.phraseId === sourceSnapshot.phraseId)
      if (result.hAudit.boundaryMode !== 'kana-hard') {
        throw new Error('SOFA 未返回 Kana 硬边界对齐 provenance；未覆盖 H')
      }
      if (!compiledRange
        || compiledRange.startFrame !== phrase.startFrame
        || compiledRange.speechEndFrameExclusive !== phrase.endFrameExclusive) {
        throw new Error('Text Control 返回的 Kana 分句范围与启动快照不一致')
      }
      const placement = result.hAudit.phraseModes.find(item => item.phraseId === sourceSnapshot.phraseId)
      if (!placement) throw new Error('当前 Kana 分句缺少训练 placement provenance')
      if (placement.placementMode !== 'phone') {
        throw new Error(`当前 Kana 分句无法取得可靠 phone placement（${placement.fallbackReason || placement.placementMode}）；未覆盖 H`)
      }
      const compiledMoras = result.kanaUnits
        .filter(item => item.phraseId === sourceSnapshot.phraseId)
        .sort((left, right) => left.startFrame - right.startFrame)
      if (compiledMoras.length !== phrase.units.length) {
        throw new Error(`SOFA mora 数量 ${compiledMoras.length} 与当前 KanaUnit 数量 ${phrase.units.length} 不一致；未覆盖 H`)
      }
      for (let moraIndex = 0; moraIndex < phrase.units.length; moraIndex++) {
        const expected = normalizeKanaMora(phrase.units[moraIndex].unit.kana)
        const actual = normalizeKanaMora(compiledMoras[moraIndex].kana)
        if (expected !== actual) {
          throw new Error(`第 ${moraIndex + 1} 个 Kana 不一致：当前「${expected}」，SOFA「${actual}」；未覆盖 H`)
        }
      }

      const phraseEvents = result.hEvents.filter(event => event.phraseId === sourceSnapshot.phraseId)
      const normalEvents = phraseEvents.filter(event => event.tokenId !== 365)
      for (let moraIndex = 0; moraIndex < phrase.units.length; moraIndex++) {
        const startFrame = phrase.units[moraIndex].unit.startFrame
        const endFrameExclusive = phrase.units[moraIndex].unit.endFrameExclusive
        const events = normalEvents.filter(event => event.moraIndex === moraIndex)
        if (events.length === 0) {
          throw new Error(`Kana「${phrase.units[moraIndex].unit.kana}」没有可归属 H token；未覆盖 H`)
        }
        if (events.some(event => event.frame < startFrame || event.frame >= endFrameExclusive)) {
          throw new Error(`Kana「${phrase.units[moraIndex].unit.kana}」的 H token 越过 frame ${startFrame}..${endFrameExclusive - 1}；未覆盖 H`)
        }
        const foreignEvents = normalEvents.filter(event => (
          event.moraIndex !== moraIndex
          && event.frame >= startFrame
          && event.frame < endFrameExclusive
        ))
        if (foreignEvents.length > 0) {
          throw new Error(`相邻 Kana 的 H token 侵入「${phrase.units[moraIndex].unit.kana}」边界；未覆盖 H`)
        }
      }
      if (normalEvents.some(event => (
        event.moraIndex === undefined
        || event.moraIndex < 0
        || event.moraIndex >= phrase.units.length
      ))) {
        throw new Error('当前 Kana 分句存在无法归属到 KanaUnit 的 H token；未覆盖 H')
      }
      const sepEvents = phraseEvents.filter(event => event.tokenId === 365)
      const lastKanaStart = phrase.units.at(-1)?.unit.startFrame ?? phrase.startFrame
      if (sepEvents.length !== 1
        || sepEvents[0].frame < lastKanaStart
        || sepEvents[0].frame >= phrase.controlEndFrameExclusive) {
        throw new Error('句末 Kana control range 内缺少唯一 SEP；未覆盖 H')
      }
      const selectedEvents = [...normalEvents, ...sepEvents]
        .sort((left, right) => left.frame - right.frame)
      const sourceRef = {
        unitId,
        track: 'kana' as const,
        revision: sourceSnapshot.kanaRevision,
        guideSHA256: sourceSnapshot.guideSHA256,
      }
      const events = selectedEvents.map(event => ({
        id: event.id,
        frame: event.frame,
        tokenId: event.tokenId,
        symbol: event.symbol,
        origin: 'kana-align' as const,
        generatedFrom: sourceRef,
      }))
      const before = objectTree.snapshotTree()
      const replaced = objectTree.replaceSynthesisHTokenTrackRange(
        unitId,
        sourceSnapshot.startFrame,
        sourceSnapshot.controlEndFrameExclusive,
        events,
        result.runtimeHashes.vocab,
        result.compilerSHA256,
        'Segment current Kana -> H',
        'kana',
        [{
          phraseId: sourceSnapshot.phraseId,
          startFrame: sourceSnapshot.startFrame,
          endFrameExclusive: sourceSnapshot.controlEndFrameExclusive,
          placementMode: placement.placementMode,
          fallbackReason: placement.fallbackReason,
        }],
      )
      if (!replaced.ok) throw new Error(replaced.reason || 'HTokenTrack 写入失败')
      history.push({
        description: '按 Segment 当前 Kana → HTokenTrack',
        patches: [], inversePatches: [],
        objectTree: { kind: 'snapshot', before, after: objectTree.snapshotTree() },
      })
      state.progress = 100
      state.message = `已按当前 Kana「${phrase.kana}」更新 H · frame ${sourceSnapshot.startFrame}..${sourceSnapshot.controlEndFrameExclusive - 1}`
      return { ok: true }
    } catch (error: any) {
      state.error = error?.message || '按当前 Segment Kana → H 失败'
      state.message = state.error
      return { ok: false, reason: state.error }
    } finally {
      state.running = false
      state.kind = null
    }
  }

  async function generateMidiPTrack(unitId: string): Promise<{ ok: boolean; reason?: string }> {
    const state = stateFor(unitId)
    if (state.running) return { ok: false, reason: '该合成单元已有分析任务运行中' }
    const unit = objectTree.node(unitId)
    if (!unit || unit.kind !== 'synthesisUnit') return { ok: false, reason: '合成单元不存在' }
    const asset = objectTree.tree.assets[unit.synthesisUnit.guide.assetId]
    const blob = asset?.blobKey ? tracks.sourceBlobs.get(asset.blobKey) : null
    if (!blob) return { ok: false, reason: 'Owned Guide blob 不存在' }
    const sourceSnapshot = {
      guideSHA256: unit.synthesisUnit.guide.audioSHA256,
      frameCount: unit.synthesisUnit.frameContract.frameCount,
      midiPRevision: unit.synthesisUnit.midiPTokenTrack.revision,
    }
    state.running = true
    state.progress = 0
    state.message = '准备 GAME medium K=4'
    state.error = ''
    state.kind = 'midi-p'
    try {
      const result = await runSynthesisMidiP({
        blob,
        sampleRate: unit.synthesisUnit.guide.sampleRate,
        guideSHA256: sourceSnapshot.guideSHA256,
        frameCount: sourceSnapshot.frameCount,
        midiPRevision: sourceSnapshot.midiPRevision,
        onProgress: (progress, message) => {
          state.progress = progress
          state.message = message
        },
      })
      const current = objectTree.node(unitId)
      if (!current || current.kind !== 'synthesisUnit') throw new Error('GAME 完成前合成单元已删除')
      if (
        current.synthesisUnit.guide.audioSHA256 !== sourceSnapshot.guideSHA256
        || current.synthesisUnit.frameContract.frameCount !== sourceSnapshot.frameCount
        || current.synthesisUnit.midiPTokenTrack.revision !== sourceSnapshot.midiPRevision
      ) {
        throw new Error('Guide 或 MIDI-P 轨已在 GAME 运行期间更新；旧任务结果未写入')
      }
      if (result.sourceSHA256 !== sourceSnapshot.guideSHA256) throw new Error('GAME 结果 Guide hash 不一致')
      const before = objectTree.snapshotTree()
      const replaced = objectTree.replaceSynthesisMidiPTrack(
        unitId,
        result.classes,
        result.runtimeHashes.game_model,
        result.compilerSHA256,
      )
      if (!replaced.ok) throw new Error(replaced.reason || 'MIDI-P Track 写入失败')
      history.push({
        description: 'Guide → GAME K=4 → MidiPTokenTrack',
        patches: [],
        inversePatches: [],
        objectTree: { kind: 'snapshot', before, after: objectTree.snapshotTree() },
      })
      const ready = objectTree.node(unitId)
      const revision = ready?.kind === 'synthesisUnit'
        ? ready.synthesisUnit.midiPTokenTrack.revision
        : sourceSnapshot.midiPRevision + 1
      const voicedNotes = result.rawNotes.filter(note => note.valid && note.presence).length
      const restFrames = result.classes.filter(value => value === 255).length
      state.progress = 100
      state.message = `MIDI-P r${revision} · ${voicedNotes} voiced notes · ${restFrames} REST frames`
      return { ok: true }
    } catch (error: any) {
      state.error = error?.message || 'GAME MIDI-P 失败'
      state.message = state.error
      return { ok: false, reason: state.error }
    } finally {
      state.running = false
      state.kind = null
    }
  }

  return { jobs, stateFor, transcribeSegmentTrack, transcribeSegmentText, alignSegmentTextControl, alignKanaTextControl, alignSegmentFromKana, generateMidiPTrack }
}
