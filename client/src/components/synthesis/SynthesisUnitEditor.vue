<script setup lang="ts">
import { computed, nextTick, onActivated, onBeforeUnmount, onDeactivated, onMounted, ref, watch } from 'vue'
import { NButton, NDropdown, NIcon, NInput, NInputNumber, NModal, NPopover, NRadioButton, NRadioGroup, NSelect, NSlider } from 'naive-ui'
import { Add, AlertCircleOutline, CheckmarkCircleOutline, ColorWandOutline, DownloadOutline, EllipsisHorizontal, LinkOutline, MicOutline, MusicalNotesOutline, OpenOutline, OptionsOutline, Pause, Play, Remove, Stop, TimeOutline, UnlinkOutline } from '@vicons/ionicons5'
import { useObjectTreeStore } from '@/stores/objectTree'
import { useGpuRuntimeStore, type ModelRuntimeStatus } from '@/stores/gpuRuntime'
import { useTracksStore } from '@/stores/tracks'
import { useHistoryStore } from '@/stores/history'
import { useEditorWorkspaceStore } from '@/stores/editorWorkspace'
import { useUiSettingsStore } from '@/stores/uiSettings'
import HTokenPicker from './HTokenPicker.vue'
import LyricProofreader from './LyricProofreader.vue'
import { lyricStatus } from '@/object-workbench/lyricProofreading'
import { V5P_H_TOKEN_BY_ID, type V5PHTokenCatalogEntry } from '@/generated/v5pHTokenCatalog'
import { useSynthesisUnitAnalysis } from '@/composables/useSynthesisUnitAnalysis'
import type { SegmentTextControlTarget } from '@/composables/useSynthesisUnitAnalysis'
type SegmentAlignmentTarget = SegmentTextControlTarget | 'current-kana-h' | 'pul'
import {
  createSynthesisMaterialSnapshot,
  getKanaControlRange,
  getKanaPhraseForSegment,
  isV5PModelId,
  V5P_DEFAULT_SAMPLING_SETTINGS,
  V5P_DEFAULT_MODEL,
  V5P_MODEL_META,
  type SynthesisHTokenEvent,
  type SynthesisSegmentObject,
  type SynthesisTake,
  type V5PModelId,
  type V5PSamplingSettings,
} from '@/object-workbench'
import { runSynthesisV5P } from '@/composables/synthesisV5PClient'
import { runSynthesisMidiP } from '@/composables/synthesisMidiPClient'
import type { SynthesisMidiPResult } from '@/composables/synthesisMidiPProtocol'
import { kanaToRomaji, romajiToKana } from '@/utils/kanaRomaji'
import { kanaToHTokens } from '@/utils/kanaToHTokens'

const props = defineProps<{ objectId: string }>()
const objectTree = useObjectTreeStore()
const gpuRuntime = useGpuRuntimeStore()
const tracks = useTracksStore()
const history = useHistoryStore()
const editorWorkspace = useEditorWorkspaceStore()
const uiSettings = useUiSettingsStore()
const analysis = useSynthesisUnitAnalysis()

const waveformCanvas = ref<HTMLCanvasElement | null>(null)
const audioElement = ref<HTMLAudioElement | null>(null)
const takeAudioElement = ref<HTMLAudioElement | null>(null)
const takeListRef = ref<HTMLElement | null>(null)
const editingTakeId = ref<string | null>(null)
const takeNameDraft = ref('')
const referenceAudioElement = ref<HTMLAudioElement | null>(null)
const guideUrl = ref('')
const referenceGuideUrl = ref('')
const takeUrl = ref('')
const waveform = ref<Float32Array | null>(null)
const pxPerFrame = ref(14)
const playheadFrame = ref(0)
const playing = ref(false)
const lyricAuditionEnd = ref<number | null>(null)
const referencePlaying = ref(false)
const referenceDropActive = ref(false)
const auditionSource = ref<'guide' | 'midi-p' | 'take'>('guide')
const playbackRate = ref(1)
const takePreparation = ref({ running: false, progress: 0, message: '' })
const takeGeneration = ref({ running: false, progress: 0, message: '' })
const samplingMenuOpen = ref(false)
const unifiedCfgDraft = ref(1)
const threeWayDraft = ref({ audio: 1, text: 1, midi: 1 })
const forceCapacity = ref(false)
const capacityRetry = ref<'v5p' | 'transcribe' | 'segment-transcribe' | 'sofa' | 'game' | 'midi-local'>('v5p')
const capacityDialog = ref<{
  modelId: string
  requiredMiB: number
  freeMiB: number
  insufficient: boolean
  estimate: any
  evictions: ModelRuntimeStatus[]
} | null>(null)
const capacityPreparing = ref<{ kind: string; message: string } | null>(null)
const pendingAnalysis = ref<{
  kind: 'transcribe' | 'segment-transcribe' | 'sofa' | 'game' | 'midi-local'
  segmentId?: string
  target?: SegmentAlignmentTarget
  kanaUnitId?: string
  extractor?: MidiLocalExtractor
} | null>(null)
type MidiLocalExtractor = 'game' | 'some'
const midiLocal = ref<{
  show: boolean
  segmentId: string
  extractor: 'game' | 'some' | 'compare'
  boundaryThreshold: number
  boundaryRadius: number
  presenceThreshold: number
  nsteps: number
  seed: number | null
  boundaryBias: number
  restThreshold: number
  minNoteFrames: number
  contextFrames: number
  running: boolean
  message: string
  progress: number
  game: SynthesisMidiPResult | null
  some: SynthesisMidiPResult | null
  audition: 'current' | 'game' | 'some'
}>({
  show: false, segmentId: '', extractor: 'compare',
  boundaryThreshold: 0.2, boundaryRadius: 2, presenceThreshold: 0.2, nsteps: 4, seed: null,
  boundaryBias: 0, restThreshold: 0.1, minNoteFrames: 2, contextFrames: 7,
  running: false, message: '', progress: 0, game: null, some: null, audition: 'current',
})
const hPicker = ref({ show: false, frame: 0 })
const hoveredHTokenId = ref<number | null>(null)
const hTokenTooltip = ref({ show: false, x: 0, y: 0, frame: 0 })
const hDrag = ref<{
  eventId: string
  sourceFrame: number
  targetFrame: number
  startX: number
} | null>(null)
const statusNotice = ref('')
const blockingError = ref({ show: false, title: '操作失败', message: '' })
const segmentMenu = ref({ show: false, x: 0, y: 0, segmentId: '', mode: 'object' as 'object' | 'empty', startFrame: 0, endFrameExclusive: 1 })
const kanaMenu = ref({ show: false, x: 0, y: 0, kanaUnitId: '' })
type EditorSelection =
  | { type: 'guide' }
  | { type: 'segment', id: string }
  | { type: 'kana', id: string }
  | { type: 'h', frame: number }
  | { type: 'midi-p', frame: number }
  | null
const editorSelection = ref<EditorSelection>({ type: 'guide' })
const selectedSegmentId = computed(() => editorSelection.value?.type === 'segment' ? editorSelection.value.id : '')
const selectedKanaUnitId = computed(() => editorSelection.value?.type === 'kana' ? editorSelection.value.id : '')
const guideMenu = ref({ show: false, x: 0, y: 0 })
const midiGenerationConfirm = ref({ show: false, manualCount: 0 })
const midiEditor = ref({ show: false, frame: 0, midiClass: 120, asFlow: false })
const midiDrag = ref<{
  sourceFrame: number
  targetFrame: number
  sourceClass: number
  targetClass: number
  startX: number
  startY: number
} | null>(null)
const midiMoveConfirm = ref({
  show: false,
  sourceFrame: 0,
  targetFrame: 0,
  targetClass: 120,
})
const alignmentConfirm = ref({
  show: false,
  segmentId: '',
  target: 'kana' as SegmentAlignmentTarget,
  startFrame: 0,
  endFrameExclusive: 0,
  objectCount: 0,
  manualCount: 0,
})
const kanaAlignmentConfirm = ref({
  show: false,
  kanaUnitId: '',
  kana: '',
  startFrame: 0,
  endFrameExclusive: 0,
  objectCount: 0,
  manualCount: 0,
})
const segmentEditor = ref({
  show: false,
  mode: 'edit' as 'edit' | 'create',
  id: '',
  text: '',
  kana: '',
  romaji: '',
  startFrame: 0,
  speechEndFrameExclusive: 1,
})
const segmentDrag = ref<{
  segmentId: string
  edge: 'start' | 'end'
  startX: number
  originalStart: number
  originalEnd: number
  previewStart: number
  previewEnd: number
  minStart: number
  maxEnd: number
} | null>(null)
const kanaEditor = ref({ show: false, id: '', kana: '', romaji: '' })
const kanaDrag = ref<{
  unitId: string
  edge: 'start' | 'end'
  startX: number
  originalFrame: number
  previewFrame: number
  minFrame: number
  maxFrame: number
} | null>(null)
const kanaObjectDrag = ref<{
  unitId: string
  startX: number
  originalStartFrame: number
  widthFrames: number
  previewStartFrame: number
} | null>(null)
const kanaSegDrag = ref<{
  boundaryId: string
  startX: number
  originalFrame: number
  previewFrame: number
} | null>(null)
let animationFrame = 0
let noticeTimer = 0
let midiAudioContext: AudioContext | null = null
let midiPlaybackStartTime = 0
let midiPlaybackStartFrame = 0
let scheduledMidiNodes: OscillatorNode[] = []
let guideLoadGeneration = 0
let midiPlaybackGeneration = 0
let midiPlaybackStarting = false

const unit = computed(() => {
  const node = objectTree.node(props.objectId)
  return node?.kind === 'synthesisUnit' ? node : null
})
const synthesis = computed(() => unit.value?.synthesisUnit ?? null)
const unitModel = computed<V5PModelId>({
  get: () => {
    const value = synthesis.value?.presetId
    return value && isV5PModelId(value) ? value : V5P_DEFAULT_MODEL
  },
  set: value => {
    if (unit.value) objectTree.setSynthesisUnitPreset(unit.value.id, value)
  },
})
const unitModelMeta = computed(() => V5P_MODEL_META[unitModel.value])
const modelOptions = Object.entries(V5P_MODEL_META).map(([value, meta]) => ({
  label: meta.label,
  value,
}))
const samplingSettings = computed(() => synthesis.value?.samplingSettings ?? V5P_DEFAULT_SAMPLING_SETTINGS)
const guidanceMode = computed<'unified' | 'three-way'>({
  get: () => samplingSettings.value.guidance.mode,
  set: mode => {
    if (!unit.value || mode === samplingSettings.value.guidance.mode) return
    const current = samplingSettings.value
    if (current.guidance.mode === 'unified') {
      unifiedCfgDraft.value = current.guidance.cfg
      threeWayDraft.value = {
        audio: current.guidance.cfg,
        text: current.guidance.cfg,
        midi: current.guidance.cfg,
      }
    } else {
      threeWayDraft.value = {
        audio: current.guidance.audio,
        text: current.guidance.text,
        midi: current.guidance.midi,
      }
    }
    updateSamplingSettings({
      ...current,
      guidance: mode === 'unified'
        ? { mode: 'unified', cfg: unifiedCfgDraft.value }
        : { mode: 'three-way', ...threeWayDraft.value, formula: 'audio-text-midi-telescoping.v1' },
    })
  },
})
const unifiedCfg = computed<number>({
  get: () => samplingSettings.value.guidance.mode === 'unified'
    ? samplingSettings.value.guidance.cfg
    : unifiedCfgDraft.value,
  set: value => {
    unifiedCfgDraft.value = value
    if (samplingSettings.value.guidance.mode === 'unified') {
      updateSamplingSettings({ ...samplingSettings.value, guidance: { mode: 'unified', cfg: value } })
    }
  },
})
const audioCfg = channelCfg('audio')
const textCfg = channelCfg('text')
const midiCfg = channelCfg('midi')
const samplingSteps = computed<number>({
  get: () => samplingSettings.value.steps,
  set: steps => updateSamplingSettings({ ...samplingSettings.value, steps }),
})
const samplingSeed = computed<number>({
  get: () => samplingSettings.value.seed,
  set: seed => updateSamplingSettings({ ...samplingSettings.value, seed }),
})
const samplingSummary = computed(() => {
  const guidance = samplingSettings.value.guidance
  return guidance.mode === 'unified'
    ? `CFG ${guidance.cfg.toFixed(1)}`
    : `3CFG A${guidance.audio.toFixed(1)} T${guidance.text.toFixed(1)} M${guidance.midi.toFixed(1)}`
})

function channelCfg(channel: 'audio' | 'text' | 'midi') {
  return computed<number>({
    get: () => samplingSettings.value.guidance.mode === 'three-way'
      ? samplingSettings.value.guidance[channel]
      : threeWayDraft.value[channel],
    set: value => {
      threeWayDraft.value = { ...threeWayDraft.value, [channel]: value }
      const current = samplingSettings.value
      if (current.guidance.mode === 'three-way') {
        updateSamplingSettings({
          ...current,
          guidance: { ...current.guidance, [channel]: value },
        })
      }
    },
  })
}

function updateSamplingSettings(settings: V5PSamplingSettings) {
  if (unit.value) objectTree.setSynthesisUnitSamplingSettings(unit.value.id, settings)
}

function freezeSamplingSettings(settings: V5PSamplingSettings): V5PSamplingSettings {
  const guidance = settings.guidance.mode === 'unified'
    ? { mode: 'unified' as const, cfg: Number(settings.guidance.cfg) }
    : {
        mode: 'three-way' as const,
        audio: Number(settings.guidance.audio),
        text: Number(settings.guidance.text),
        midi: Number(settings.guidance.midi),
        formula: 'audio-text-midi-telescoping.v1' as const,
      }
  return {
    guidance,
    steps: Number(settings.steps),
    seed: Number(settings.seed),
  }
}

function takeSamplingLabel(take: SynthesisTake) {
  const settings = take.samplingSettings
  if (!settings) return `legacy CFG · seed ${take.seed}`
  const guidance = settings.guidance
  const cfg = guidance.mode === 'unified'
    ? `CFG ${guidance.cfg.toFixed(1)}`
    : `3CFG A${guidance.audio.toFixed(1)} T${guidance.text.toFixed(1)} M${guidance.midi.toFixed(1)}`
  return `${cfg} · ${settings.steps} steps · seed ${settings.seed}`
}
const frameCount = computed(() => synthesis.value?.frameContract.frameCount ?? 1)
const frameRate = computed(() => synthesis.value?.frameContract.frameRate ?? (44100 / 2048))
const timelineWidth = computed(() => Math.max(640, frameCount.value * pxPerFrame.value))
const modelDuration = computed(() => (synthesis.value?.frameContract.modelSampleCount ?? 0) / 44100)

// The editor has one horizontal coordinate system: the V5-P latent frame grid.
// Audio and MIDI are playback backends only; neither owns display geometry.
function frameToDisplayX(frame: number): number {
  return frame * pxPerFrame.value
}

function frameToAudioTime(frame: number): number {
  return frame / frameRate.value
}

function audioTimeToFrame(time: number): number {
  return Math.max(0, Math.min(frameCount.value - 1, Math.floor(time * frameRate.value)))
}

function displayXToFrame(x: number): number {
  return Math.max(0, Math.min(frameCount.value - 1, Math.floor(x / pxPerFrame.value)))
}
const guideAsset = computed(() => {
  const assetId = synthesis.value?.guide.assetId
  return assetId ? objectTree.tree.assets[assetId] : null
})
const guideBlob = computed(() => {
  const key = guideAsset.value?.blobKey
  return key ? tracks.sourceBlobs.get(key) ?? null : null
})
const referenceUnit = computed(() => {
  const referenceUnitId = synthesis.value?.reference?.unitId
  if (!referenceUnitId) return null
  const node = objectTree.node(referenceUnitId)
  return node?.kind === 'synthesisUnit' ? node : null
})
const referenceGuideAsset = computed(() => {
  const assetId = referenceUnit.value?.synthesisUnit.guide.assetId
  return assetId ? objectTree.tree.assets[assetId] : null
})
const referenceGuideBlob = computed(() => {
  const key = referenceGuideAsset.value?.blobKey
  return key ? tracks.sourceBlobs.get(key) ?? null : null
})
const takePrerequisiteMessage = computed(() => {
  if (!referenceUnit.value) return '请先绑定 A 区参考合成单元'
  if (!guideBlob.value) return '当前 B 区 Guide 尚未加载'
  if (!referenceGuideBlob.value) return 'A 区参考 Guide 尚未加载'
  return ''
})
const activeTake = computed(() => synthesis.value?.takes.find(take => (
  take.id === synthesis.value?.activeTakeId
)) ?? null)
const activeTakeAsset = computed(() => {
  const assetId = activeTake.value?.outputAssetId
  return assetId ? objectTree.tree.assets[assetId] : null
})
const activeTakeBlob = computed(() => {
  const blobKey = activeTakeAsset.value?.blobKey
  return blobKey ? tracks.sourceBlobs.get(blobKey) ?? null : null
})
const referenceStatus = computed(() => {
  if (!synthesis.value?.reference) return { label: '未绑定', warning: false }
  const reference = referenceUnit.value?.synthesisUnit
  if (!reference) return { label: '引用对象不存在', warning: true }
  if (reference.segmentTrack.status !== 'ready') return { label: 'Segment 未生成', warning: true }
  if (reference.hTokenTrack.status !== 'ready') return { label: 'H 未生成', warning: true }
  return { label: '控制已准备', warning: false }
})
const referenceMenuOptions = computed(() => Object.values(objectTree.index.nodes)
  .filter(node => node.kind === 'synthesisUnit' && node.id !== props.objectId)
  .map((node) => {
    if (node.kind !== 'synthesisUnit') throw new Error('unreachable')
    const policy = objectTree.canBindSynthesisReferenceUnit(props.objectId, node.id)
    return {
      label: `${node.name} · ${formatTime(node.synthesisUnit.guide.duration)}`,
      key: node.id,
      disabled: !policy.ok,
      props: policy.reason ? { title: policy.reason } : undefined,
    }
  })
  .sort((left, right) => String(left.label).localeCompare(String(right.label), 'zh-CN')))
const frameTicks = computed(() => Array.from({ length: frameCount.value }, (_, frame) => frame))
const majorTickEvery = computed(() => pxPerFrame.value >= 18 ? 5 : pxPerFrame.value >= 10 ? 10 : 20)
const midiReady = computed(() => synthesis.value?.midiPTokenTrack.status === 'ready')
const localMidiRange = computed(() => {
  const items = [...(synthesis.value?.segmentTrack.items ?? [])].sort((left, right) => left.startFrame - right.startFrame)
  const index = items.findIndex(item => item.id === midiLocal.value.segmentId)
  if (index < 0) return null
  return {
    segment: items[index],
    startFrame: items[index].startFrame,
    endFrameExclusive: items[index + 1]?.startFrame ?? frameCount.value,
  }
})
const localMidiCandidate = computed(() => {
  if (midiLocal.value.audition === 'game') return midiLocal.value.game
  if (midiLocal.value.audition === 'some') return midiLocal.value.some
  return null
})
const midiPlaybackClasses = computed(() => {
  const classes = [...(synthesis.value?.midiPTokenTrack.classes ?? [])]
  const candidate = localMidiCandidate.value
  const range = localMidiRange.value
  if (!candidate || !range || candidate.classes.length !== range.endFrameExclusive - range.startFrame) return classes
  classes.splice(range.startFrame, candidate.classes.length, ...candidate.classes)
  return classes
})
const midiPlaybackRange = ref<{ startFrame: number; endFrameExclusive: number } | null>(null)
const midiPlaybackFlowFrameSet = computed(() => {
  if (!localMidiCandidate.value) return new Set(synthesis.value?.midiPTokenTrack.flowFrames ?? [])
  const flow = new Set<number>()
  for (let frame = 1; frame < midiPlaybackClasses.value.length; frame++) {
    if (midiPlaybackClasses.value[frame] < 255
      && midiPlaybackClasses.value[frame] === midiPlaybackClasses.value[frame - 1]) flow.add(frame)
  }
  return flow
})
const midiFlowFrameSet = computed(() => new Set(synthesis.value?.midiPTokenTrack.flowFrames ?? []))
const midiPitchRange = computed(() => {
  const classes = synthesis.value?.midiPTokenTrack.classes.filter(value => value < 255) ?? []
  if (classes.length === 0) return { min: 96, max: 168 }
  let min = Math.max(0, Math.min(...classes) - 12)
  let max = Math.min(254, Math.max(...classes) + 12)
  if (max - min < 48) {
    const center = (min + max) / 2
    min = Math.max(0, Math.floor(center - 24))
    max = Math.min(254, Math.ceil(center + 24))
  }
  min = Math.min(min, 120)
  max = Math.max(max, 144)
  return { min, max }
})
const midiPitchTicks = computed(() => {
  const range = midiPitchRange.value
  const firstClass = Math.max(0, Math.floor(range.min))
  const lastClass = Math.min(254, Math.ceil(range.max))
  return Array.from({ length: Math.max(0, lastClass - firstClass + 1) }, (_, index) => {
    const classId = firstClass + index
    return {
      classId,
      label: classId % 24 === 0 ? midiPitchName(classId) : '',
      semitone: classId % 2 === 0,
      octave: classId % 24 === 0,
    }
  })
})
const midiEditorLabel = computed(() => midiEditor.value.asFlow
  ? `FLOW -> ${midiClassLabel(midiEditor.value.midiClass)}`
  : midiClassLabel(midiEditor.value.midiClass))
const durationLabel = computed(() => formatTime(modelDuration.value))
const hoveredHEntry = computed(() => hoveredHTokenId.value == null ? null : V5P_H_TOKEN_BY_ID.get(hoveredHTokenId.value) ?? null)
const pickerCurrentTokenId = computed(() => (
  synthesis.value?.hTokenTrack.events.find(event => event.frame === hPicker.value.frame)?.tokenId ?? null
))
const selectedSegment = computed(() => {
  const selection = editorSelection.value
  return selection?.type === 'segment'
    ? synthesis.value?.segmentTrack.items.find(item => item.id === selection.id) ?? null
    : null
})
const selectedKana = computed(() => {
  const selection = editorSelection.value
  return selection?.type === 'kana'
    ? synthesis.value?.kanaTrack.units.find(item => item.id === selection.id) ?? null
    : null
})
const selectedKanaDirectHTokens = computed(() => {
  const kana = selectedKana.value
  if (!kana) return []
  try {
    return kanaToHTokens(kana.kana)
  } catch {
    return []
  }
})
const selectedHFrame = computed(() => editorSelection.value?.type === 'h' ? editorSelection.value.frame : null)
const selectedHEvent = computed(() => selectedHFrame.value == null ? null
  : synthesis.value?.hTokenTrack.events.find(event => event.frame === selectedHFrame.value) ?? null)
const selectedHEntry = computed(() => selectedHEvent.value
  ? V5P_H_TOKEN_BY_ID.get(selectedHEvent.value.tokenId) ?? null
  : null)
const selectedMidiFrame = computed(() => editorSelection.value?.type === 'midi-p' ? editorSelection.value.frame : null)
const selectedMidiClass = computed(() => selectedMidiFrame.value == null ? null
  : synthesis.value?.midiPTokenTrack.classes[selectedMidiFrame.value] ?? null)
const selectedMidiIsFlow = computed(() => selectedMidiFrame.value != null && isMidiFlowFrame(selectedMidiFrame.value))
const analysisJob = computed(() => analysis.stateFor(props.objectId))
const textAnalysisRunning = computed(() => analysisJob.value.running && ['segment', 'kana', 'h'].includes(analysisJob.value.kind ?? ''))
const midiAnalysisRunning = computed(() => analysisJob.value.running && analysisJob.value.kind === 'midi-p')
const analysisProgress = computed(() => Math.max(0, Math.min(100, Math.round(analysisJob.value.progress))))
const analysisBusy = computed(() => analysisJob.value.running)
const segmentMenuOptions = computed(() => segmentMenu.value.mode === 'empty'
  ? [{ label: '在此处新建 Segment', key: 'create', disabled: frameCount.value < 1 }]
  : [
    { label: '自动对齐至 Kana', key: 'kana', disabled: analysisJob.value.running },
    { label: '按当前 Kana 边界对齐至 H Token', key: 'current-kana-h', disabled: analysisJob.value.running },
    { label: '按 Segment 文本自由对齐至 H Token（忽略 Kana 边界）', key: 'h', disabled: analysisJob.value.running },
    { label: '按 PUL 生成 H Token', key: 'pul-h', disabled: analysisJob.value.running },
    { label: '重新转录本 Segment 文本', key: 'retranscribe-text', disabled: analysisJob.value.running },
    { label: '清空区域内 Kana', key: 'clear-kana', disabled: analysisJob.value.running },
    { label: '清空区域内 H Token', key: 'clear-h', disabled: analysisJob.value.running },
    { label: '重提取本句 MIDI-P', key: 'midi-local', disabled: analysisJob.value.running || midiLocal.value.running },
  ])
const kanaMenuOptions = computed(() => [
  { label: '自动对齐至 H Token', key: 'h', disabled: analysisJob.value.running },
  { label: '映射至 H Token', key: 'map-h', disabled: analysisJob.value.running },
])
const guideMenuOptions = computed(() => [
  { label: 'GAME 自动生成 MIDI-P', key: 'midi-p', disabled: analysisJob.value.running },
  { label: '自动转录为 Segment', key: 'segment', disabled: analysisJob.value.running },
])
const timelineScrollRef = ref<HTMLElement | null>(null)

watch(guideBlob, loadGuide, { immediate: true })
watch(referenceGuideBlob, loadReferenceGuide, { immediate: true })
watch(activeTakeBlob, loadActiveTake, { immediate: true })
watch(() => synthesis.value?.activeTakeId, takeId => {
  if (takeId && activeTakeBlob.value) auditionSource.value = 'take'
})
watch(pxPerFrame, () => nextTick(drawWaveform))
watch(() => uiSettings.settings.theme, () => nextTick(drawWaveform))
watch(() => props.objectId, () => {
  stopPlayback()
  playheadFrame.value = 0
  editorSelection.value = { type: 'guide' }
})
watch(auditionSource, () => {
  const frame = playheadFrame.value
  stopPlayback()
  playheadFrame.value = Math.min(frameCount.value - 1, Math.max(0, frame))
  syncAudioPlaybackPosition()
})
watch(playbackRate, () => {
  syncAudioPlaybackRate()
  if (auditionSource.value === 'midi-p' && playing.value) restartMidiPlayback()
})
watch(() => midiLocal.value.show, (show, wasShowing) => {
  if (show || !wasShowing) return
  stopPlayback()
  midiLocal.value.audition = 'current'
})
watch(() => midiEditor.value.midiClass, (value, previous) => {
  if (midiEditor.value.show && value !== previous) previewMidiClass(value)
})

function bindEditorKeyboard() {
  ;(window as any).__synthesisUnitEditorActive = true
  window.removeEventListener('keydown', handleEditorKeydown, true)
  window.addEventListener('keydown', handleEditorKeydown, true)
}

function unbindEditorKeyboard() {
  ;(window as any).__synthesisUnitEditorActive = false
  window.removeEventListener('keydown', handleEditorKeydown, true)
  stopPlayback()
}

onMounted(() => {
  bindEditorKeyboard()
  ;(window as any).__playbackStop?.()
  syncAudioPlaybackRate()
})

onActivated(() => {
  bindEditorKeyboard()
})

onDeactivated(() => {
  unbindEditorKeyboard()
  clearKanaObjectDragListeners()
  clearKanaSegDragListeners()
})

async function loadGuide(blob: Blob | null) {
  const generation = ++guideLoadGeneration
  stopPlayback()
  waveform.value = null
  if (guideUrl.value) URL.revokeObjectURL(guideUrl.value)
  guideUrl.value = blob ? URL.createObjectURL(blob) : ''
  if (!blob) return
  const context = new AudioContext()
  try {
    const decoded = await context.decodeAudioData(await blob.arrayBuffer())
    if (generation !== guideLoadGeneration) return
    const mono = new Float32Array(decoded.length)
    for (let channelIndex = 0; channelIndex < decoded.numberOfChannels; channelIndex++) {
      const channel = decoded.getChannelData(channelIndex)
      for (let index = 0; index < channel.length; index++) mono[index] += channel[index] / decoded.numberOfChannels
    }
    const modelSampleCount = synthesis.value?.frameContract.modelSampleCount ?? mono.length
    // Trailing samples belong to the owned Guide but not to a V5-P latent
    // frame. Keep them out of the waveform geometry so it shares the same
    // horizontal axis as Text and MIDI-P.
    waveform.value = mono.slice(0, Math.min(modelSampleCount, mono.length))
    await nextTick()
    drawWaveform()
  } finally {
    await context.close()
  }
}

function loadReferenceGuide(blob: Blob | null) {
  stopReferencePlayback()
  if (referenceGuideUrl.value) URL.revokeObjectURL(referenceGuideUrl.value)
  referenceGuideUrl.value = blob ? URL.createObjectURL(blob) : ''
}

function loadActiveTake(blob: Blob | null) {
  stopPrimaryPlayback()
  if (takeUrl.value) URL.revokeObjectURL(takeUrl.value)
  takeUrl.value = blob ? URL.createObjectURL(blob) : ''
  if (!blob && auditionSource.value === 'take') auditionSource.value = 'guide'
}

function syncAudioPlaybackPosition() {
  const time = frameToAudioTime(playheadFrame.value)
  if (audioElement.value) audioElement.value.currentTime = time
  if (takeAudioElement.value) takeAudioElement.value.currentTime = time
}

function syncAudioPlaybackRate() {
  if (audioElement.value) audioElement.value.playbackRate = playbackRate.value
  if (takeAudioElement.value) takeAudioElement.value.playbackRate = playbackRate.value
}

function chooseReferenceUnit(key: string | number) {
  bindReferenceUnit(String(key))
}

function resolveReferenceUnitId(nodeId: string): string | null {
  const node = objectTree.node(nodeId)
  if (node?.kind === 'synthesisUnit') return node.id
  if (node?.kind !== 'trackObject') return null
  const source = objectTree.node(node.trackObject.sourceObjectId)
  return source?.kind === 'synthesisUnit' ? source.id : null
}

function bindReferenceUnit(referenceNodeId: string) {
  if (!unit.value) return
  const referenceUnitId = resolveReferenceUnitId(referenceNodeId)
  if (!referenceUnitId) {
    flashStatus('A 区参考只接受合成单元或其时间线 OBJ')
    return
  }
  const reference = objectTree.node(referenceUnitId)
  const before = objectTree.snapshotTree()
  const result = objectTree.bindSynthesisReferenceUnit(unit.value.id, referenceUnitId)
  if (!result.ok) {
    flashStatus(result.reason ?? 'A 区参考绑定失败')
    return
  }
  history.push({
    description: `绑定 A 区参考 · ${reference?.name ?? referenceUnitId}`,
    patches: [],
    inversePatches: [],
    objectTree: { kind: 'snapshot', before, after: objectTree.snapshotTree() },
  })
  flashStatus(`A 区参考 · ${reference?.name ?? referenceUnitId} · 完整 Guide · 跟随最新`)
}

function unbindReferenceUnit() {
  if (!unit.value) return
  const referenceName = referenceUnit.value?.name ?? '失效引用'
  const before = objectTree.snapshotTree()
  const result = objectTree.unbindSynthesisReferenceUnit(unit.value.id)
  if (!result.ok) {
    flashStatus(result.reason ?? 'A 区参考解除失败')
    return
  }
  history.push({
    description: `解除 A 区参考 · ${referenceName}`,
    patches: [],
    inversePatches: [],
    objectTree: { kind: 'snapshot', before, after: objectTree.snapshotTree() },
  })
  flashStatus('A 区参考已解除')
}

function handleReferenceDragOver(event: DragEvent) {
  if (!event.dataTransfer?.types.includes('application/x-aisvc-node-id')) return
  event.preventDefault()
  event.dataTransfer.dropEffect = 'copy'
  referenceDropActive.value = true
}

function handleReferenceDrop(event: DragEvent) {
  referenceDropActive.value = false
  const referenceUnitId = event.dataTransfer?.getData('application/x-aisvc-node-id')
  if (!referenceUnitId) return
  event.preventDefault()
  bindReferenceUnit(referenceUnitId)
}

function openReferenceUnit() {
  const reference = referenceUnit.value
  if (!reference) return
  editorWorkspace.openSynthesisUnitTab(reference.id, reference.name)
}

async function toggleReferenceGuide() {
  const audio = referenceAudioElement.value
  if (!audio || !referenceGuideUrl.value) {
    flashStatus('A 区完整 Guide 不可读')
    return
  }
  if (referencePlaying.value) {
    audio.pause()
    referencePlaying.value = false
    return
  }
  stopPrimaryPlayback()
  if (audio.ended || audio.currentTime >= (referenceUnit.value?.synthesisUnit.guide.duration ?? 0)) {
    audio.currentTime = 0
  }
  try {
    await audio.play()
    referencePlaying.value = true
  } catch (error: any) {
    flashStatus(error?.message || 'A 区 Guide 播放失败')
  }
}

function drawWaveform() {
  const canvas = waveformCanvas.value
  const samples = waveform.value
  if (!canvas || !samples) return
  const cssWidth = timelineWidth.value
  const cssHeight = 72
  canvas.width = Math.min(8192, Math.max(640, Math.round(cssWidth)))
  canvas.height = cssHeight * Math.min(2, window.devicePixelRatio || 1)
  const context = canvas.getContext('2d')
  if (!context) return
  const width = canvas.width
  const height = canvas.height
  context.clearRect(0, 0, width, height)
  context.strokeStyle = uiSettings.palette.success
  context.lineWidth = 1
  const middle = height / 2
  const samplesPerPixel = samples.length / width
  context.beginPath()
  for (let x = 0; x < width; x++) {
    const start = Math.floor(x * samplesPerPixel)
    const end = Math.min(samples.length, Math.max(start + 1, Math.floor((x + 1) * samplesPerPixel)))
    let min = 1
    let max = -1
    for (let index = start; index < end; index++) {
      min = Math.min(min, samples[index])
      max = Math.max(max, samples[index])
    }
    context.moveTo(x + 0.5, middle + min * middle * 0.84)
    context.lineTo(x + 0.5, middle + max * middle * 0.84)
  }
  context.stroke()
}

async function togglePlayback() {
  stopReferencePlayback()
  if (auditionSource.value === 'midi-p') {
    await toggleMidiPPlayback()
    return
  }
  const audio = auditionSource.value === 'take' ? takeAudioElement.value : audioElement.value
  if (!audio) return
  syncAudioPlaybackRate()
  if (playing.value) {
    audio.pause()
    playing.value = false
    cancelAnimationFrame(animationFrame)
    return
  }
  if (audio.currentTime >= modelDuration.value) audio.currentTime = 0
  await audio.play()
  playing.value = true
  tickPlayback()
}

function stopPrimaryPlayback() {
  lyricAuditionEnd.value = null
  midiPlaybackGeneration++
  midiPlaybackStarting = false
  for (const audio of [audioElement.value, takeAudioElement.value]) {
    if (!audio) continue
    audio.pause()
    audio.currentTime = 0
  }
  cancelAnimationFrame(animationFrame)
  stopScheduledMidiNodes()
  playing.value = false
  playheadFrame.value = 0
  midiPlaybackRange.value = null
}

function stopReferencePlayback() {
  const audio = referenceAudioElement.value
  if (audio) {
    audio.pause()
    audio.currentTime = 0
  }
  referencePlaying.value = false
}

function stopPlayback() {
  stopPrimaryPlayback()
  stopReferencePlayback()
}

async function toggleMidiPPlayback() {
  if (!midiReady.value || midiPlaybackStarting) return
  const generation = ++midiPlaybackGeneration
  midiPlaybackStarting = true
  try {
    const context = await ensureMidiAudioContext()
    if (generation !== midiPlaybackGeneration) return
    if (playing.value) {
      const elapsed = Math.max(0, context.currentTime - midiPlaybackStartTime)
      playheadFrame.value = Math.min(
        frameCount.value - 1,
        midiPlaybackStartFrame + Math.floor(elapsed * frameRate.value * playbackRate.value),
      )
      stopScheduledMidiNodes()
      cancelAnimationFrame(animationFrame)
      playing.value = false
      return
    }
    const classes = midiPlaybackClasses.value
    const flowFrames = midiPlaybackFlowFrameSet.value
    const range = midiPlaybackRange.value
    const playbackEnd = range?.endFrameExclusive ?? frameCount.value
    if (playbackEnd <= 0) return
    if (playheadFrame.value < (range?.startFrame ?? 0) || playheadFrame.value >= playbackEnd - 1) {
      playheadFrame.value = range?.startFrame ?? 0
    }
    midiPlaybackStartFrame = playheadFrame.value
    midiPlaybackStartTime = context.currentTime + 0.04
    let runStart = midiPlaybackStartFrame
    while (runStart < Math.min(classes.length, playbackEnd)) {
      const midiClass = classes[runStart]
      let runEnd = runStart + 1
      while (runEnd < Math.min(classes.length, playbackEnd)
        && classes[runEnd] === midiClass
        && (midiClass >= 255 || flowFrames.has(runEnd))) runEnd++
      if (midiClass < 255) {
        schedulePianoTone(
          midiClass,
          midiPlaybackStartTime + (runStart - midiPlaybackStartFrame) / frameRate.value / playbackRate.value,
          (runEnd - runStart) / frameRate.value / playbackRate.value,
          true,
        )
      }
      runStart = runEnd
    }
    playing.value = true
    tickMidiPlayback()
  } finally {
    if (generation === midiPlaybackGeneration) midiPlaybackStarting = false
  }
}

function restartMidiPlayback() {
  if (!midiAudioContext || !playing.value) return
  const elapsed = Math.max(0, midiAudioContext.currentTime - midiPlaybackStartTime)
  playheadFrame.value = Math.min(
    frameCount.value - 1,
    midiPlaybackStartFrame + Math.floor(elapsed * frameRate.value * playbackRate.value),
  )
  stopScheduledMidiNodes()
  cancelAnimationFrame(animationFrame)
  playing.value = false
  void toggleMidiPPlayback()
}

function tickMidiPlayback() {
  if (!playing.value || auditionSource.value !== 'midi-p' || !midiAudioContext) return
  const elapsedFrames = Math.floor(Math.max(0, midiAudioContext.currentTime - midiPlaybackStartTime) * frameRate.value * playbackRate.value)
  const frame = midiPlaybackStartFrame + elapsedFrames
  const playbackEnd = midiPlaybackRange.value?.endFrameExclusive ?? frameCount.value
  if (frame >= playbackEnd) {
    midiPlaybackGeneration++
    midiPlaybackStarting = false
    stopScheduledMidiNodes()
    cancelAnimationFrame(animationFrame)
    playing.value = false
    playheadFrame.value = Math.max(0, playbackEnd - 1)
    return
  }
  playheadFrame.value = Math.max(midiPlaybackStartFrame, frame)
  animationFrame = requestAnimationFrame(tickMidiPlayback)
}

async function ensureMidiAudioContext() {
  midiAudioContext ??= new AudioContext()
  if (midiAudioContext.state === 'suspended') await midiAudioContext.resume()
  return midiAudioContext
}

function previewMidiClass(midiClass: number) {
  if (midiClass >= 255 || midiClass < 0) return
  void ensureMidiAudioContext().then(context => {
    schedulePianoTone(midiClass, context.currentTime, 0.28, false)
  })
}

function schedulePianoTone(midiClass: number, startTime: number, duration: number, tracked: boolean) {
  const context = midiAudioContext
  if (!context || midiClass >= 255) return
  const frequency = 440 * 2 ** ((midiClass / 2 - 69) / 12)
  const gain = context.createGain()
  gain.gain.setValueAtTime(0.0001, startTime)
  gain.gain.exponentialRampToValueAtTime(0.16, startTime + 0.008)
  gain.gain.exponentialRampToValueAtTime(0.0001, startTime + Math.max(0.08, duration + 0.08))
  gain.connect(context.destination)
  for (const [multiple, level] of [[1, 1], [2, 0.24]] as const) {
    const oscillator = context.createOscillator()
    const harmonicGain = context.createGain()
    oscillator.type = 'sine'
    oscillator.frequency.setValueAtTime(frequency * multiple, startTime)
    harmonicGain.gain.value = level
    oscillator.connect(harmonicGain).connect(gain)
    oscillator.start(startTime)
    oscillator.stop(startTime + Math.max(0.1, duration + 0.1))
    if (tracked) scheduledMidiNodes.push(oscillator)
  }
}

function stopScheduledMidiNodes() {
  for (const node of scheduledMidiNodes) {
    try { node.stop() } catch {}
  }
  scheduledMidiNodes = []
}

function tickPlayback() {
  const audio = auditionSource.value === 'take' ? takeAudioElement.value : audioElement.value
  if (!audio || !playing.value) return
  if (lyricAuditionEnd.value !== null && audio.currentTime >= lyricAuditionEnd.value) {
    audio.pause()
    playing.value = false
    lyricAuditionEnd.value = null
    return
  }
  if (audio.currentTime >= modelDuration.value || audio.ended) {
    stopPlayback()
    return
  }
  playheadFrame.value = audioTimeToFrame(audio.currentTime)
  animationFrame = requestAnimationFrame(tickPlayback)
}

function seekFromPointer(event: MouseEvent) {
  const target = event.currentTarget as HTMLElement
  const rect = target.getBoundingClientRect()
  const ratio = Math.max(0, Math.min(1, (event.clientX - rect.left) / rect.width))
  const frame = displayXToFrame(ratio * timelineWidth.value)
  playheadFrame.value = frame
  syncAudioPlaybackPosition()
}

function seekGuideFromPointer(event: MouseEvent) {
  editorSelection.value = { type: 'guide' }
  const restartMidi = playing.value && auditionSource.value === 'midi-p'
  const target = event.currentTarget as HTMLElement
  const rect = target.getBoundingClientRect()
  const ratio = Math.max(0, Math.min(1, (event.clientX - rect.left) / rect.width))
  const frame = displayXToFrame(ratio * timelineWidth.value)
  const time = frameToAudioTime(frame)
  playheadFrame.value = frame
  if (restartMidi) {
    stopScheduledMidiNodes()
    cancelAnimationFrame(animationFrame)
    playing.value = false
  }
  if (takeAudioElement.value) {
    takeAudioElement.value.pause()
    takeAudioElement.value.currentTime = time
  }
  if (audioElement.value) {
    audioElement.value.currentTime = time
  }
  if (restartMidi) void toggleMidiPPlayback()
}

function handleTimelineWheel(event: WheelEvent) {
  const el = event.currentTarget instanceof HTMLElement ? event.currentTarget : timelineScrollRef.value
  if (!el) return
  event.preventDefault()
  const unit = event.deltaMode === 1 ? 40 : 1
  const speed = event.altKey ? 3 : 1
  const delta = event.deltaX || event.deltaY
  el.scrollLeft += delta * unit * speed
}

async function generateTake() {
  if (!unit.value || !referenceUnit.value || !guideBlob.value || !referenceGuideBlob.value) {
    flashStatus('请先绑定可用的 A 区参考和完整 Guide')
    return
  }
  if (takeGeneration.value.running || takePreparation.value.running) return
  takePreparation.value = { running: true, progress: 1, message: '准备生成 Take' }
  try {
    if (forceCapacity.value) {
      forceCapacity.value = false
      takePreparation.value = { running: false, progress: 0, message: '' }
      await generateTakeCore()
      return
    }
    const durationSeconds = unit.value.synthesisUnit.guide.duration ?? 0
    const modelId = unitModel.value
    takePreparation.value = { running: true, progress: 8, message: '检查显存与 V5-P Runtime' }
    const prepared = await gpuRuntime.prepareRuntime(
      modelId,
      durationSeconds,
      samplingSettings.value.guidance.mode,
    ) as any
    if (!prepared.ok) {
      takePreparation.value = { running: false, progress: 0, message: '' }
      if (prepared.busy) {
        flashStatus(prepared.reason || '模型正在运行其他任务')
        return
      }
      if (prepared.action === 'confirm') {
        capacityRetry.value = 'v5p'
        capacityDialog.value = {
          modelId,
          requiredMiB: prepared.required,
          freeMiB: prepared.policy.freeMiB,
          insufficient: false,
          estimate: prepared.policy.estimate,
          evictions: prepared.evictions,
        }
        return
      }
      if (prepared.insufficient) {
        capacityRetry.value = 'v5p'
        capacityDialog.value = {
          modelId,
          requiredMiB: prepared.required,
          freeMiB: prepared.policy.freeMiB,
          insufficient: true,
          estimate: prepared.policy.estimate,
          evictions: [],
        }
        return
      }
      flashStatus(prepared.reason || '显存策略检查失败')
      return
    }
    takePreparation.value = { running: false, progress: 0, message: '' }
    await generateTakeCore()
  } catch (error: any) {
    takePreparation.value = { running: false, progress: 0, message: '' }
    flashStatus(error?.message || 'Take 准备失败')
  }
}

async function generateTakeCore() {
  if (!unit.value || !referenceUnit.value || !guideBlob.value || !referenceGuideBlob.value) {
    flashStatus('请先绑定可用的 A 区参考和完整 Guide')
    return
  }
  if (takeGeneration.value.running) return
  let snapshot: ReturnType<typeof createSynthesisMaterialSnapshot>
  try {
    snapshot = createSynthesisMaterialSnapshot(referenceUnit.value, unit.value)
  } catch (error: any) {
    flashStatus(error?.message || 'V5-P 合成材料尚未准备完成')
    return
  }
  const targetUnitId = unit.value.id
  const takeId = `take:${crypto.randomUUID()}`
  const modelId = unitModel.value
  const modelMeta = unitModelMeta.value
  // samplingSettings is a Vue computed value; build a plain transport object
  // instead of passing its reactive Proxy to structuredClone/fetch.
  const frozenSampling = freezeSamplingSettings(samplingSettings.value)
  const queued = objectTree.queueSynthesisTake(targetUnitId, {
    id: takeId,
    name: `Take ${(synthesis.value?.takes.length ?? 0) + 1}`,
    status: 'running',
    targetUnitRevision: snapshot.target.unitRevision,
    referenceUnitId: snapshot.reference.unitId,
    referenceUnitRevision: snapshot.reference.unitRevision,
    presetId: modelId,
    checkpointSHA256: modelMeta.checkpointSHA256,
    vaeSHA256: modelMeta.vaeSHA256,
    adapterSHA256: modelMeta.adapterSHA256,
    seed: frozenSampling.seed,
    samplingSettings: frozenSampling,
    createdAt: new Date().toISOString(),
  })
  if (!queued.ok) {
    flashStatus(queued.reason ?? 'Take 创建失败')
    return
  }
  takeGeneration.value = { running: true, progress: 0, message: '准备 V5-P' }
  try {
    const { result, blob } = await runSynthesisV5P({
      referenceBlob: referenceGuideBlob.value,
      targetBlob: guideBlob.value,
      snapshot,
      presetId: modelId,
      steps: frozenSampling.steps,
      guidance: frozenSampling.guidance,
      seed: frozenSampling.seed,
      onProgress: (progress, message) => {
        takeGeneration.value = { running: true, progress, message }
      },
    })
    const completed = await objectTree.completeSynthesisTake(targetUnitId, takeId, blob, result)
    if (!completed.ok) throw new Error(completed.reason ?? 'Take 落库失败')
    auditionSource.value = 'take'
    flashStatus(`${activeTake.value?.name ?? 'Take'} 已完成 · snapshot ${result.snapshotSHA256.slice(0, 10)}`)
  } catch (error: any) {
    const message = error?.message || 'V5-P 合成失败'
    if (message.includes('用户已取消 GPU 任务')) objectTree.cancelSynthesisTake(targetUnitId, takeId, message)
    else objectTree.failSynthesisTake(targetUnitId, takeId, message)
    flashStatus(message)
  } finally {
    takeGeneration.value = { running: false, progress: 0, message: '' }
  }
}

async function evictFromCapacityDialog() {
  const dialog = capacityDialog.value
  if (!dialog) return
  const evicted = await gpuRuntime.evictUntilFit(dialog.modelId, dialog.requiredMiB, dialog.evictions)
  if (!evicted) {
    capacityDialog.value = { ...dialog, insufficient: true, evictions: [] }
    return
  }
  capacityDialog.value = null
  await runCapacityRetry()
}

function forceRunFromCapacityDialog() {
  capacityDialog.value = null
  forceCapacity.value = true
  void runCapacityRetry()
}

function closeCapacityDialog() {
  capacityDialog.value = null
}

async function ensureAnalysisCapacity(
  requests: Array<{ modelId: string }>,
  kind: 'transcribe' | 'segment-transcribe' | 'sofa' | 'game' | 'midi-local',
  context?: { segmentId?: string; target?: SegmentAlignmentTarget; kanaUnitId?: string; extractor?: MidiLocalExtractor },
): Promise<boolean> {
  capacityPreparing.value = {
    kind,
    message: kind === 'game' || kind === 'midi-local'
      ? `检查显存 / 加载 ${context?.extractor === 'some' ? 'SOME' : 'GAME'}`
      : kind === 'transcribe' || kind === 'segment-transcribe'
        ? '检查显存 / 加载 Whisper + SOFA'
        : '检查显存 / 加载 SOFA',
  }
  try {
    if (forceCapacity.value) {
      forceCapacity.value = false
      gpuRuntime.clearActiveStageReleases()
      return true
    }
    const durationSeconds = unit.value?.synthesisUnit.guide.duration ?? 0
    const prepared = await gpuRuntime.prepareCompositeTask(
      requests.map(request => request.modelId),
      durationSeconds,
    ) as any
    if (prepared.ok) {
      pendingAnalysis.value = null
      gpuRuntime.setActiveStageReleases(prepared.stageReleases ?? [])
      return true
    }
    if (prepared.busy) {
      showBlockingError(prepared.reason || '模型正在运行其他任务', '无法开始分析')
      return false
    }
    pendingAnalysis.value = { kind, ...context }
    capacityRetry.value = kind
    if (prepared.action === 'confirm') {
      capacityDialog.value = {
        modelId: requests[0].modelId,
        requiredMiB: prepared.required,
        freeMiB: prepared.policy.freeMiB,
        insufficient: false,
        estimate: prepared.policy.estimate,
        evictions: prepared.evictions,
      }
      return false
    }
    if (prepared.insufficient) {
      capacityDialog.value = {
        modelId: requests[0].modelId,
        requiredMiB: prepared.required,
        freeMiB: prepared.policy.freeMiB,
        insufficient: true,
        estimate: prepared.policy.estimate,
        evictions: [],
      }
      return false
    }
    showBlockingError(prepared.reason || '显存策略检查失败', '显存准备失败')
    return false
  } catch (error: any) {
    showBlockingError(error?.message || '显存准备失败', '显存准备失败')
    return false
  } finally {
    capacityPreparing.value = null
  }
}

async function runCapacityRetry() {
  const kind = capacityRetry.value
  if (kind === 'v5p') {
    await generateTake()
    return
  }
  if (kind === 'transcribe') {
    await transcribeSegmentTrack()
    return
  }
  if (kind === 'segment-transcribe') {
    const pending = pendingAnalysis.value
    if (pending?.segmentId) await retranscribeSegmentText(pending.segmentId)
    return
  }
  if (kind === 'game') {
    await generateMidiPTrack()
    return
  }
  if (kind === 'midi-local') {
    const pending = pendingAnalysis.value
    if (pending?.segmentId && pending.extractor) await runLocalMidiExtraction(pending.segmentId, pending.extractor, true)
    return
  }
  const pending = pendingAnalysis.value
  if (pending?.kanaUnitId) await executeKanaAlignment(pending.kanaUnitId)
  else if (pending?.segmentId && pending.target === 'current-kana-h') await executeSegmentKanaAlignment(pending.segmentId)
  else if (pending?.segmentId && (pending.target === 'kana' || pending.target === 'h')) {
    await executeSegmentAlignment(pending.segmentId, pending.target)
  }
}

function selectTake(takeId: string) {
  const result = objectTree.setActiveSynthesisTake(props.objectId, takeId)
  if (!result.ok) {
    flashStatus(result.reason ?? 'Take 尚不可试听')
    return
  }
  auditionSource.value = 'take'
}

async function beginTakeRename(take: SynthesisTake) {
  editingTakeId.value = take.id
  takeNameDraft.value = take.name
  await nextTick()
  takeListRef.value?.querySelector<HTMLInputElement>('.take-name-input')?.select()
}

function cancelTakeRename() {
  editingTakeId.value = null
}

function commitTakeRename() {
  const takeId = editingTakeId.value
  if (!takeId) return
  editingTakeId.value = null
  const name = takeNameDraft.value.trim()
  const take = synthesis.value?.takes.find(item => item.id === takeId)
  if (!take || name === take.name) return
  if (!name) {
    flashStatus('Take 名称不能为空')
    return
  }
  const before = objectTree.snapshotTree()
  const result = objectTree.renameSynthesisTake(props.objectId, takeId, name)
  if (!result.ok) {
    flashStatus(result.reason ?? 'Take 重命名失败')
    return
  }
  history.push({
    description: `重命名 Take · ${name}`,
    patches: [],
    inversePatches: [],
    objectTree: { kind: 'snapshot', before, after: objectTree.snapshotTree() },
  })
}

async function exportActiveTake() {
  const take = activeTake.value
  const blob = activeTakeBlob.value
  if (!take || !blob || take.status !== 'ready') {
    flashStatus('当前没有可导出的 Take')
    return
  }
  const before = objectTree.snapshotTree()
  const tracksBefore = tracks.snapshotState()
  const result = await objectTree.addRenderedAudioToTimeline({
    blob,
    outputFileName: `${unit.value?.name ?? 'V5-P'}_${take.name}.wav`,
    renderKind: 'v5p',
    timelineStart: synthesis.value?.defaultTimelineStart ?? 0,
  })
  if (result.ok && result.renderObjectId) {
    const renderObject = objectTree.node(result.renderObjectId)
    const trackSourceObject = result.trackSourceObjectId ? objectTree.node(result.trackSourceObjectId) : null
    const blobKeys = [
      renderObject?.kind === 'audio'
      ? objectTree.tree.assets[renderObject.audio.assetId]?.blobKey
      : undefined,
      trackSourceObject?.kind === 'audio'
        ? objectTree.tree.assets[trackSourceObject.audio.assetId]?.blobKey
        : undefined,
    ].filter((key): key is string => Boolean(key))
    history.push({
      description: '导出 V5-P Take',
      patches: [],
      inversePatches: [],
      objectTree: {
        kind: 'snapshot',
        before,
        after: objectTree.snapshotTree(),
        tracksBefore,
        tracksAfter: tracks.snapshotState(),
        blobChanges: blobKeys.map(key => ({ key, before: null, after: blob })),
      },
    })
  }
  flashStatus(result.ok ? `${take.name} 已导出到正式音轨` : (result.reason ?? 'Take 导出失败'))
}

function frameFromPointer(event: MouseEvent | PointerEvent) {
  const target = event.currentTarget as HTMLElement
  const rect = target.getBoundingClientRect()
  return displayXToFrame(event.clientX - rect.left)
}

function selectHFrame(frame: number) {
  editorSelection.value = { type: 'h', frame }
  playheadFrame.value = frame
  const time = frameToAudioTime(frame)
  if (audioElement.value) audioElement.value.currentTime = time
  if (takeAudioElement.value) takeAudioElement.value.currentTime = time
}

function selectHFrameFromPointer(event: MouseEvent) {
  selectHFrame(frameFromPointer(event))
}

function openHTokenPickerAtFrame(frame: number) {
  selectHFrame(frame)
  hPicker.value = { show: true, frame }
}

function openHTokenPicker(event: MouseEvent, frame?: number) {
  event.preventDefault()
  event.stopPropagation()
  openHTokenPickerAtFrame(frame ?? frameFromPointer(event))
}

function chooseHToken(entry: V5PHTokenCatalogEntry | null) {
  if (!unit.value) return
  const before = objectTree.snapshotTree()
  const result = objectTree.setSynthesisHTokenAtFrame(
    unit.value.id,
    hPicker.value.frame,
    entry ? { tokenId: entry.id, symbol: entry.token } : null,
  )
  if (!result.ok) {
    flashStatus(result.reason ?? 'H Token 修改失败')
    return
  }
  history.push({
    description: entry ? `替换 H Token · frame ${hPicker.value.frame}` : `清除 H Token · frame ${hPicker.value.frame}`,
    patches: [],
    inversePatches: [],
    objectTree: { kind: 'snapshot', before, after: objectTree.snapshotTree() },
  })
  flashStatus(entry ? `${entry.chineseName} · ${entry.token} · frame ${hPicker.value.frame}` : `frame ${hPicker.value.frame} 已恢复为 0 filler`)
}

async function transcribeSegmentTrack() {
  const ok = await ensureAnalysisCapacity([
    { modelId: 'Whisper large-v3' },
    { modelId: 'SOFA Japanese' },
  ], 'transcribe')
  if (!ok) return
  try {
    const result = await analysis.transcribeSegmentTrack(props.objectId)
    flashStatus(result.ok ? analysisJob.value.message : result.reason ?? 'Whisper + SOFA 失败')
  } finally {
    gpuRuntime.clearActiveStageReleases()
  }
}

async function retranscribeSegmentText(segmentId: string) {
  const ok = await ensureAnalysisCapacity([
    { modelId: 'Whisper large-v3' },
    { modelId: 'SOFA Japanese' },
  ], 'segment-transcribe', { segmentId })
  if (!ok) return
  try {
    const result = await analysis.transcribeSegmentText(props.objectId, segmentId)
    flashStatus(result.ok ? analysisJob.value.message : result.reason ?? 'Segment 文本转录失败')
  } finally {
    gpuRuntime.clearActiveStageReleases()
  }
}

function openGuideMenu(event: MouseEvent) {
  event.preventDefault()
  event.stopPropagation()
  guideMenu.value = { show: false, x: event.clientX, y: event.clientY }
  nextTick(() => { guideMenu.value.show = true })
}

function chooseGuideMenu(key: string) {
  guideMenu.value.show = false
  if (key === 'segment') void transcribeSegmentTrack()
  if (key === 'midi-p') requestMidiPGeneration()
}

function requestMidiPGeneration() {
  const manualCount = synthesis.value?.midiPTokenTrack.manualFrames?.length ?? 0
  if (manualCount > 0) {
    midiGenerationConfirm.value = { show: true, manualCount }
    return
  }
  void generateMidiPTrack()
}

async function confirmMidiPGeneration() {
  midiGenerationConfirm.value.show = false
  await generateMidiPTrack()
}

async function generateMidiPTrack() {
  const ok = await ensureAnalysisCapacity([{ modelId: 'GAME-1.0-medium' }], 'game')
  if (!ok) return
  const result = await analysis.generateMidiPTrack(props.objectId)
  flashStatus(result.ok ? analysisJob.value.message : result.reason ?? 'GAME MIDI-P 失败')
}

function openLocalMidiExtraction(segmentId: string) {
  const range = [...(synthesis.value?.segmentTrack.items ?? [])]
    .sort((left, right) => left.startFrame - right.startFrame)
  const segment = range.find(item => item.id === segmentId)
  if (!segment) return
  midiLocal.value = {
    ...midiLocal.value,
    show: true,
    segmentId,
    game: null,
    some: null,
    audition: 'current',
    message: `frame ${segment.startFrame}..${(range[range.indexOf(segment) + 1]?.startFrame ?? frameCount.value) - 1}`,
  }
}

function localMidiParameters(extractor: MidiLocalExtractor): Record<string, number> {
  return extractor === 'game'
    ? {
        boundaryThreshold: midiLocal.value.boundaryThreshold,
        boundaryRadius: midiLocal.value.boundaryRadius,
        presenceThreshold: midiLocal.value.presenceThreshold,
        nsteps: midiLocal.value.nsteps,
        contextFrames: midiLocal.value.contextFrames,
        ...(midiLocal.value.seed == null ? {} : { seed: midiLocal.value.seed }),
      }
    : {
        boundaryBias: midiLocal.value.boundaryBias,
        restThreshold: midiLocal.value.restThreshold,
        minNoteFrames: midiLocal.value.minNoteFrames,
        contextFrames: midiLocal.value.contextFrames,
      }
}

async function runLocalMidiExtraction(segmentId: string, extractor: MidiLocalExtractor, capacityReady = false) {
  const range = [...(synthesis.value?.segmentTrack.items ?? [])].sort((left, right) => left.startFrame - right.startFrame)
  const index = range.findIndex(item => item.id === segmentId)
  const segment = range[index]
  if (!segment || !guideBlob.value) {
    flashStatus('本句或 Owned Guide 不存在')
    return
  }
  const startFrame = segment.startFrame
  const endFrameExclusive = range[index + 1]?.startFrame ?? frameCount.value
  const modelId = extractor === 'game' ? 'GAME-1.0-medium' : 'OpenVPI-SOME'
  if (!capacityReady) {
    const ok = await ensureAnalysisCapacity([{ modelId }], 'midi-local', { segmentId, extractor })
    if (!ok) return
  }
  midiLocal.value.running = true
  midiLocal.value.progress = 2
  midiLocal.value.message = `${extractor.toUpperCase()} 上传本句`
  try {
    const result = await runSynthesisMidiP({
      blob: guideBlob.value,
      sampleRate: synthesis.value?.guide.sampleRate ?? 44100,
      guideSHA256: synthesis.value?.guide.audioSHA256 ?? '',
      frameCount: frameCount.value,
      midiPRevision: synthesis.value?.midiPTokenTrack.revision ?? 0,
      extractor,
      startFrame,
      endFrameExclusive,
      contextFrames: midiLocal.value.contextFrames,
      parameters: localMidiParameters(extractor),
      onProgress: (progress, message) => {
        midiLocal.value.progress = progress
        midiLocal.value.message = message
      },
    })
    if (extractor === 'game') midiLocal.value.game = result
    else midiLocal.value.some = result
    midiLocal.value.audition = extractor
    midiLocal.value.message = `${extractor.toUpperCase()} 候选完成 · ${result.classes.length} frames`
    flashStatus(`${extractor.toUpperCase()} 本句候选已生成，确认后才会覆盖`)
  } catch (error: any) {
    midiLocal.value.message = error?.message || `${extractor.toUpperCase()} 提取失败`
    flashStatus(midiLocal.value.message)
  } finally {
    midiLocal.value.running = false
  }
}

async function runSelectedLocalMidiExtraction() {
  const segmentId = midiLocal.value.segmentId
  if (!segmentId || midiLocal.value.running) return
  if (midiLocal.value.extractor === 'compare') {
    await runLocalMidiExtraction(segmentId, 'game')
    if (midiLocal.value.game) await runLocalMidiExtraction(segmentId, 'some')
  } else {
    await runLocalMidiExtraction(segmentId, midiLocal.value.extractor)
  }
}

function applyLocalMidiCandidate(extractor: MidiLocalExtractor) {
  const candidate = extractor === 'game' ? midiLocal.value.game : midiLocal.value.some
  const range = localMidiRange.value
  if (!candidate || !range || !unit.value) return
  stopPlayback()
  const before = objectTree.snapshotTree()
  const result = objectTree.replaceSynthesisMidiPTrackRange(
    unit.value.id,
    range.startFrame,
    range.endFrameExclusive,
    candidate.classes,
    extractor,
    candidate.runtimeHashes.game_model ?? candidate.runtimeHashes.some_model,
    candidate.compilerSHA256,
  )
  if (!result.ok) {
    flashStatus(result.reason ?? '本句 MIDI-P 应用失败')
    return
  }
  history.push({
    description: `应用 ${extractor.toUpperCase()} 本句 MIDI-P`, patches: [], inversePatches: [],
    objectTree: { kind: 'snapshot', before, after: objectTree.snapshotTree() },
  })
  midiLocal.value.show = false
  midiLocal.value.audition = 'current'
  flashStatus(`${extractor.toUpperCase()} 已应用，仅覆盖本句 frame ${range.startFrame}..${range.endFrameExclusive - 1}`)
}

async function auditionLocalMidiCandidate(source: 'current' | 'game' | 'some') {
  const range = localMidiRange.value
  if (!range || !midiReady.value) return
  stopPlayback()
  midiLocal.value.audition = source
  auditionSource.value = 'midi-p'
  await nextTick()
  midiPlaybackRange.value = { startFrame: range.startFrame, endFrameExclusive: range.endFrameExclusive }
  playheadFrame.value = range.startFrame
  await toggleMidiPPlayback()
}

function stopLocalMidiAudition() {
  stopPlayback()
}

function openMidiEditor(event: MouseEvent, frame?: number) {
  event.preventDefault()
  event.stopPropagation()
  const targetFrame = frame ?? frameFromPointer(event)
  openMidiEditorAtFrame(targetFrame)
}

function selectMidiFrame(frame: number) {
  editorSelection.value = { type: 'midi-p', frame }
  playheadFrame.value = frame
  const time = frameToAudioTime(frame)
  if (audioElement.value) audioElement.value.currentTime = time
  if (takeAudioElement.value) takeAudioElement.value.currentTime = time
}

function clickMidiFrame(frame: number, midiClass: number) {
  selectMidiFrame(frame)
  const resolvedClass = midiClassAt(frame, midiClass)
  if (isMidiFlowFrame(frame)) {
    const headFrame = midiFlowHeadFrame(frame)
    const headClass = synthesis.value?.midiPTokenTrack.classes[headFrame] ?? 255
    if (headClass < 255) previewMidiClass(headClass)
    return
  }
  if (resolvedClass < 255) previewMidiClass(resolvedClass)
}

function selectMidiFrameFromPointer(event: MouseEvent) {
  selectMidiFrame(frameFromPointer(event))
}

function openMidiEditorAtFrame(targetFrame: number) {
  selectMidiFrame(targetFrame)
  const currentClass = synthesis.value?.midiPTokenTrack.classes[targetFrame]
  if (currentClass == null) return
  midiEditor.value = {
    show: true,
    frame: targetFrame,
    midiClass: currentClass,
    asFlow: isMidiFlowFrame(targetFrame),
  }
  if (currentClass < 255) previewMidiClass(currentClass)
}

function setSelectedMidiRest() {
  const frame = selectedMidiFrame.value
  const currentClass = selectedMidiClass.value
  if (!unit.value || frame == null || currentClass == null || currentClass === 255) return
  const before = objectTree.snapshotTree()
  const result = objectTree.setSynthesisMidiPFrame(unit.value.id, frame, 255, false)
  if (!result.ok) {
    flashStatus(result.reason ?? 'MIDI-P 修改失败')
    return
  }
  history.push({
    description: `写入 MIDI-P REST · frame ${frame}`,
    patches: [], inversePatches: [],
    objectTree: { kind: 'snapshot', before, after: objectTree.snapshotTree() },
  })
  flashStatus(`frame ${frame} 已写入 REST`)
}

function adjustMidiEditor(delta: number) {
  const current = midiEditor.value.midiClass
  const pitch = current >= 255 ? 120 : current
  midiEditor.value.asFlow = false
  midiEditor.value.midiClass = Math.max(0, Math.min(254, pitch + delta))
  previewMidiClass(midiEditor.value.midiClass)
}

function setMidiEditorRest() {
  midiEditor.value.asFlow = false
  midiEditor.value.midiClass = 255
}

function setMidiEditorFlow() {
  if (midiEditor.value.asFlow) {
    midiEditor.value.asFlow = false
    if (midiEditor.value.midiClass < 255) previewMidiClass(midiEditor.value.midiClass)
    return
  }
  const frame = midiEditor.value.frame
  const previousClass = synthesis.value?.midiPTokenTrack.classes[frame - 1]
  if (frame === 0 || previousClass == null || previousClass >= 255) {
    flashStatus('FLOW 前必须有一个有音高的 MIDI-P token')
    return
  }
  midiEditor.value.asFlow = true
  midiEditor.value.midiClass = previousClass
  previewMidiClass(previousClass)
}

function setMidiEditorClass(value: number | null) {
  if (value == null) return
  midiEditor.value.asFlow = false
  midiEditor.value.midiClass = value
  previewMidiClass(value)
}

function saveMidiEditor() {
  if (!unit.value) return
  const currentClass = synthesis.value?.midiPTokenTrack.classes[midiEditor.value.frame]
  const currentIsFlow = isMidiFlowFrame(midiEditor.value.frame)
  if (currentClass === midiEditor.value.midiClass && currentIsFlow === midiEditor.value.asFlow) {
    midiEditor.value.show = false
    return
  }
  const before = objectTree.snapshotTree()
  const result = objectTree.setSynthesisMidiPFrame(
    unit.value.id,
    midiEditor.value.frame,
    midiEditor.value.midiClass,
    midiEditor.value.asFlow,
  )
  if (!result.ok) {
    flashStatus(result.reason ?? 'MIDI-P 修改失败')
    return
  }
  history.push({
    description: `${midiEditor.value.asFlow ? '写入 FLOW' : '替换 MIDI-P'} · frame ${midiEditor.value.frame}`,
    patches: [], inversePatches: [],
    objectTree: { kind: 'snapshot', before, after: objectTree.snapshotTree() },
  })
  if (midiEditor.value.midiClass < 255) previewMidiClass(midiEditor.value.midiClass)
  midiEditor.value.show = false
  flashStatus(`frame ${midiEditor.value.frame} · ${midiEditorLabel.value}`)
}

function beginMidiClassDrag(event: PointerEvent, frame: number, sourceClass: number) {
  if (event.button !== 0 || sourceClass >= 255) return
  if (isMidiFlowFrame(frame)) {
    flashStatus(`frame ${frame} 是 FLOW；请拖动 frame ${midiFlowHeadFrame(frame)} 的头 token`)
    return
  }
  event.preventDefault()
  event.stopPropagation()
  midiDrag.value = {
    sourceFrame: frame,
    targetFrame: frame,
    sourceClass,
    targetClass: sourceClass,
    startX: event.clientX,
    startY: event.clientY,
  }
  window.addEventListener('pointermove', updateMidiClassDrag)
  window.addEventListener('pointerup', finishMidiClassDrag, { once: true })
  window.addEventListener('pointercancel', cancelMidiClassDrag, { once: true })
}

function updateMidiClassDrag(event: PointerEvent) {
  const drag = midiDrag.value
  if (!drag) return
  const nextFrame = Math.max(0, Math.min(
    frameCount.value - 1,
    drag.sourceFrame + Math.round((event.clientX - drag.startX) / pxPerFrame.value),
  ))
  const nextClass = Math.max(0, Math.min(254, drag.sourceClass - Math.round((event.clientY - drag.startY) / 6)))
  if (nextClass === drag.targetClass && nextFrame === drag.targetFrame) return
  drag.targetFrame = nextFrame
  drag.targetClass = nextClass
  previewMidiClass(nextClass)
}

function finishMidiClassDrag() {
  const drag = midiDrag.value
  clearMidiDragListeners()
  if (!drag || !unit.value) return
  if (drag.targetFrame === drag.sourceFrame && drag.targetClass === drag.sourceClass) return
  const targetIsManual = drag.targetFrame !== drag.sourceFrame
    && (synthesis.value?.midiPTokenTrack.manualFrames ?? []).includes(drag.targetFrame)
  if (targetIsManual) {
    midiMoveConfirm.value = {
      show: true,
      sourceFrame: drag.sourceFrame,
      targetFrame: drag.targetFrame,
      targetClass: drag.targetClass,
    }
    return
  }
  commitMidiDrag(drag.sourceFrame, drag.targetFrame, drag.targetClass, false)
}

function confirmMidiMove() {
  const move = midiMoveConfirm.value
  move.show = false
  commitMidiDrag(move.sourceFrame, move.targetFrame, move.targetClass, true)
}

function commitMidiDrag(sourceFrame: number, targetFrame: number, targetClass: number, forceReplace: boolean) {
  if (!unit.value) return
  const before = objectTree.snapshotTree()
  const result = objectTree.moveSynthesisMidiPFrame(
    unit.value.id,
    sourceFrame,
    targetFrame,
    targetClass,
    forceReplace,
  )
  if (!result.ok) {
    flashStatus(result.reason ?? 'MIDI-P 修改失败')
    return
  }
  const moved = sourceFrame !== targetFrame
  history.push({
    description: moved
      ? `移动 MIDI-P · frame ${sourceFrame} -> ${targetFrame}`
      : `拖动 MIDI-P 音高 · frame ${sourceFrame}`,
    patches: [], inversePatches: [],
    objectTree: { kind: 'snapshot', before, after: objectTree.snapshotTree() },
  })
  previewMidiClass(targetClass)
  flashStatus(moved
    ? `frame ${sourceFrame} -> ${targetFrame} · ${midiClassLabel(targetClass)} · 源 frame = REST`
    : `frame ${sourceFrame} · ${midiClassLabel(targetClass)}`)
}

function cancelMidiClassDrag() {
  clearMidiDragListeners()
}

function clearMidiDragListeners() {
  window.removeEventListener('pointermove', updateMidiClassDrag)
  window.removeEventListener('pointerup', finishMidiClassDrag)
  window.removeEventListener('pointercancel', cancelMidiClassDrag)
  midiDrag.value = null
}

function midiClassAt(frame: number, fallback: number) {
  const drag = midiDrag.value
  if (!drag) return fallback
  if (drag.sourceFrame === drag.targetFrame && midiFlowHeadFrame(frame) === drag.sourceFrame) return drag.targetClass
  if (frame === drag.sourceFrame) return 255
  if (frame === drag.targetFrame) return drag.targetClass
  return fallback
}

function isMidiFlowFrame(frame: number): boolean {
  return midiFlowFrameSet.value.has(frame)
}

function midiFlowHeadFrame(frame: number): number {
  let headFrame = frame
  while (headFrame > 0 && midiFlowFrameSet.value.has(headFrame)) headFrame--
  return headFrame
}

function midiCellTitle(frame: number, midiClass: number): string {
  const label = midiClassLabel(midiClassAt(frame, midiClass))
  return isMidiFlowFrame(frame)
    ? `frame ${frame} · FLOW -> ${label} · head frame ${midiFlowHeadFrame(frame)}`
    : `frame ${frame} · ${label}`
}

function midiCellStyle(frame: number, midiClass: number) {
  const value = midiClassAt(frame, midiClass)
  if (value === 255) return { left: `${frameToDisplayX(frame)}px`, width: `${pxPerFrame.value}px`, top: '606px', height: '6px' }
  if (value === 256) return { left: `${frameToDisplayX(frame)}px`, width: `${pxPerFrame.value}px`, top: '630px', height: '4px' }
  return {
    left: `${frameToDisplayX(frame)}px`,
    width: `${pxPerFrame.value}px`,
    top: midiPitchTop(value),
    height: '8px',
  }
}

function midiPitchTop(midiClass: number): string {
  const range = midiPitchRange.value
  const ratio = (range.max - midiClass) / Math.max(1, range.max - range.min)
  return `${36 + Math.max(0, Math.min(1, ratio)) * 522}px`
}

function midiClassLabel(midiClass: number) {
  if (midiClass === 255) return 'REST'
  if (midiClass === 256) return 'PAD'
  return `${midiPitchName(midiClass)} · class ${midiClass}`
}

function midiPitchName(midiClass: number) {
  if (midiClass === 255) return 'REST'
  if (midiClass === 256) return 'PAD'
  const midi = midiClass / 2
  const note = Math.floor(midi)
  const names = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B']
  const cents = midi - note >= 0.5 ? '+50' : ''
  return `${names[((note % 12) + 12) % 12]}${Math.floor(note / 12) - 1}${cents}`
}

function handleEditorKeydown(event: KeyboardEvent) {
  const targetElement = event.target instanceof HTMLElement ? event.target : null
  if (targetElement?.closest('[data-lyric-proofreader]')) return
  const isEditorTabTarget = Boolean(targetElement?.closest('.editor-tab'))
  const ctrl = event.ctrlKey || event.metaKey
  if (ctrl && event.key.toLocaleLowerCase() === 's') {
    event.preventDefault()
    event.stopImmediatePropagation()
    ;(window as any).__saveProject?.()
    return
  }
  if (ctrl && event.key.toLocaleLowerCase() === 'o') {
    event.preventDefault()
    event.stopImmediatePropagation()
    ;(window as any).__loadProject?.()
    return
  }
  const isTextEntry = Boolean(targetElement?.closest('input, textarea, select, [contenteditable="true"]'))
  if (!isTextEntry && (event.code === 'Space' || event.key === ' ') && !event.repeat) {
    event.preventDefault()
    event.stopImmediatePropagation()
    void togglePlayback()
    return
  }
  if (isEditableTarget(event.target) && !isEditorTabTarget) return
  if (ctrl && event.key.toLocaleLowerCase() === 'z') {
    event.preventDefault()
    event.stopImmediatePropagation()
    if (event.shiftKey) redoEditor()
    else undoEditor()
    return
  }
  if (event.key === 'Delete' || event.key === 'Backspace') {
    if (!editorSelection.value || editorSelection.value.type === 'guide') return
    event.preventDefault()
    event.stopImmediatePropagation()
    deleteSelectedEditorObject()
    return
  }
  if ((event.code !== 'Space' && event.key !== ' ') || event.repeat) return
  event.preventDefault()
  event.stopImmediatePropagation()
  void togglePlayback()
}

function undoEditor() {
  if (!history.canUndo) return
  history.undo()
  flashStatus('已撤销')
}

function redoEditor() {
  if (!history.canRedo) return
  history.redo()
  flashStatus('已重做')
}

function deleteSelectedEditorObject() {
  const selection = editorSelection.value
  if (!unit.value || !selection || selection.type === 'guide') return
  if (selection.type === 'h') {
    clearSelectedHToken()
    return
  }
  if (selection.type === 'midi-p') {
    setSelectedMidiRest()
    return
  }
  const before = objectTree.snapshotTree()
  const result = selection.type === 'segment'
    ? objectTree.deleteSynthesisSegment(unit.value.id, selection.id)
    : objectTree.deleteSynthesisKana(unit.value.id, selection.id)
  if (!result.ok) {
    flashStatus(result.reason ?? '对象删除失败')
    return
  }
  history.push({
    description: selection.type === 'segment' ? '删除 Segment' : '删除 Kana',
    patches: [], inversePatches: [],
    objectTree: { kind: 'snapshot', before, after: objectTree.snapshotTree() },
  })
  editorSelection.value = { type: 'guide' }
  flashStatus(selection.type === 'segment' ? 'Segment 已删除；其他轨保持不变' : 'Kana 已删除；其他轨保持不变')
}

function isEditableTarget(target: EventTarget | null) {
  const element = target instanceof HTMLElement ? target : null
  return Boolean(element?.closest('input, textarea, select, button, [contenteditable="true"]'))
}

function openSegmentMenu(event: MouseEvent, segmentId: string) {
  event.preventDefault()
  event.stopPropagation()
  segmentMenu.value = { show: false, x: event.clientX, y: event.clientY, segmentId, mode: 'object', startFrame: 0, endFrameExclusive: 1 }
  nextTick(() => { segmentMenu.value.show = true })
}

function openEmptySegmentMenu(event: MouseEvent) {
  event.preventDefault()
  event.stopPropagation()
  const startFrame = frameFromPointer(event)
  if ((synthesis.value?.segmentTrack.items ?? []).some(segment => (
    startFrame >= segment.startFrame && startFrame < segment.speechEndFrameExclusive
  ))) {
    flashStatus('此 frame 已属于一个 Segment')
    return
  }
  const nextSegment = [...(synthesis.value?.segmentTrack.items ?? [])]
    .filter(segment => segment.startFrame > startFrame)
    .sort((left, right) => left.startFrame - right.startFrame)[0]
  const endFrameExclusive = nextSegment?.startFrame ?? frameCount.value
  if (endFrameExclusive <= startFrame) {
    flashStatus('此处没有可用的 Segment frame')
    return
  }
  segmentMenu.value = {
    show: false,
    x: event.clientX,
    y: event.clientY,
    segmentId: '',
    mode: 'empty',
    startFrame,
    endFrameExclusive,
  }
  nextTick(() => { segmentMenu.value.show = true })
}

function selectSegment(segmentId: string) {
  editorSelection.value = { type: 'segment', id: segmentId }
}

function lyricSegmentStatus(segment: SynthesisSegmentObject) {
  if (!unit.value) return ''
  const session = objectTree.tree.lyricProofreading?.sessions[props.objectId]
  if (!session) return ''
  const reference = objectTree.tree.lyricProofreading?.references.find(item => item.id === session.referenceId)
  return lyricStatus(unit.value, segment, session, reference)
}

function lyricAnchor() {
  return timelineScrollRef.value?.querySelector('.segment-object.selected')?.getBoundingClientRect()
}

async function selectLyricSegment(segmentId: string) {
  selectSegment(segmentId)
  await nextTick()
  const element = timelineScrollRef.value?.querySelector('.segment-object.selected')
  element?.scrollIntoView({ block: 'nearest', inline: 'nearest' })
}

async function auditionLyricRange(startFrame: number, endFrame: number) {
  stopPlayback()
  auditionSource.value = 'guide'
  await nextTick()
  const audio = audioElement.value
  if (!audio || !guideUrl.value) { flashStatus('Guide 音频尚未就绪'); return }
  audio.currentTime = frameToAudioTime(startFrame)
  playheadFrame.value = startFrame
  lyricAuditionEnd.value = frameToAudioTime(endFrame)
  try {
    syncAudioPlaybackRate()
    await audio.play()
    playing.value = true
    tickPlayback()
  } catch { lyricAuditionEnd.value = null; flashStatus('Guide 试听失败') }
}

function selectKana(kanaUnitId: string) {
  editorSelection.value = { type: 'kana', id: kanaUnitId }
}

function segmentOwnedEnd(segmentId: string): number {
  const items = [...(synthesis.value?.segmentTrack.items ?? [])].sort((left, right) => left.startFrame - right.startFrame)
  const index = items.findIndex(item => item.id === segmentId)
  return index < 0 ? frameCount.value : items[index + 1]?.startFrame ?? frameCount.value
}

function segmentAtFrame(frame: number) {
  return [...(synthesis.value?.segmentTrack.items ?? [])]
    .sort((left, right) => left.startFrame - right.startFrame)
    .find(segment => frame >= segment.startFrame && frame < segmentOwnedEnd(segment.id)) ?? null
}

function kanaAtFrame(frame: number) {
  return synthesis.value?.kanaTrack.units.find(kana => (
    frame >= kana.startFrame && frame < kana.endFrameExclusive
  )) ?? null
}

function midiFrameOrigin(frame: number): string {
  return (synthesis.value?.midiPTokenTrack.manualFrames ?? []).includes(frame)
    ? 'user'
    : synthesis.value?.midiPTokenTrack.origin ?? 'empty'
}

function clearSelectedHToken() {
  const frame = selectedHFrame.value
  if (frame == null || !selectedHEvent.value) return
  hPicker.value = { show: false, frame }
  chooseHToken(null)
}

function fillPulsesAfterFrame(frame: number) {
  if (!unit.value) return
  const before = objectTree.snapshotTree()
  const result = objectTree.fillSynthesisPulsesAfterFrame(unit.value.id, frame)
  if (!result.ok) {
    flashStatus(result.reason ?? 'PUL 填充失败')
    return
  }
  if (!result.affectedFrames) {
    flashStatus('后方紧邻其他 H Token，没有可填充的 PUL frame')
    return
  }
  history.push({
    description: `PUL 刷 · frame ${frame}`,
    patches: [], inversePatches: [],
    objectTree: { kind: 'snapshot', before, after: objectTree.snapshotTree() },
  })
  flashStatus(`已填充 ${result.affectedFrames} 个 PUL frame`)
}

function clearPulsesAfterFrame(frame: number) {
  if (!unit.value) return
  const before = objectTree.snapshotTree()
  const result = objectTree.clearSynthesisPulsesAfterFrame(unit.value.id, frame)
  if (!result.ok) {
    flashStatus(result.reason ?? 'PUL 清除失败')
    return
  }
  if (!result.affectedFrames) {
    flashStatus('后方没有连续 PUL frame')
    return
  }
  history.push({
    description: `清除连续 PUL · frame ${frame}`,
    patches: [], inversePatches: [],
    objectTree: { kind: 'snapshot', before, after: objectTree.snapshotTree() },
  })
  flashStatus(`已清除 ${result.affectedFrames} 个连续 PUL frame`)
}

function alignSelectedSegment(target: SegmentAlignmentTarget) {
  if (!selectedSegmentId.value) {
    flashStatus('请先点击一个 Segment，再执行对齐')
    return
  }
  chooseSegmentMenuFor(selectedSegmentId.value, target)
}

function clearSegmentKanaRange(segment: SynthesisSegmentObject, endFrameExclusive: number) {
  if (!unit.value) return
  const before = objectTree.snapshotTree()
  const result = objectTree.replaceSynthesisKanaTrackRange(
    unit.value.id,
    segment.startFrame,
    endFrameExclusive,
    [],
    [],
    endFrameExclusive,
    'clear Segment Kana range',
  )
  if (!result.ok) {
    flashStatus(result.reason ?? 'Kana 清空失败')
    return
  }
  history.push({
    description: `清空 Segment Kana · frame ${segment.startFrame}..${endFrameExclusive - 1}`,
    patches: [], inversePatches: [],
    objectTree: { kind: 'snapshot', before, after: objectTree.snapshotTree() },
  })
  flashStatus(`已清空 Segment Kana · frame ${segment.startFrame}..${endFrameExclusive - 1}`)
}

function clearSegmentHTokenRange(segment: SynthesisSegmentObject, endFrameExclusive: number) {
  if (!unit.value) return
  const before = objectTree.snapshotTree()
  const result = objectTree.replaceSynthesisHTokenTrackRange(
    unit.value.id,
    segment.startFrame,
    endFrameExclusive,
    [],
    undefined,
    undefined,
    'clear Segment H range',
    'segment',
    [],
    'user',
  )
  if (!result.ok) {
    flashStatus(result.reason ?? 'H Token 清空失败')
    return
  }
  history.push({
    description: `清空 Segment H Token · frame ${segment.startFrame}..${endFrameExclusive - 1}`,
    patches: [], inversePatches: [],
    objectTree: { kind: 'snapshot', before, after: objectTree.snapshotTree() },
  })
  flashStatus(`已清空 Segment H Token · frame ${segment.startFrame}..${endFrameExclusive - 1}`)
}

function chooseSegmentMenuFor(segmentId: string, target: SegmentAlignmentTarget) {
  segmentMenu.value.segmentId = segmentId
  chooseSegmentMenu(target)
}

function chooseSegmentMenu(target: string) {
  segmentMenu.value.show = false
  if (target === 'create') {
    openCreateSegmentEditor(segmentMenu.value.startFrame, segmentMenu.value.endFrameExclusive)
    return
  }
  if (target === 'retranscribe-text') {
    void retranscribeSegmentText(segmentMenu.value.segmentId)
    return
  }
  const synthesisUnit = synthesis.value
  if (!synthesisUnit) return
  const items = [...synthesisUnit.segmentTrack.items].sort((left, right) => left.startFrame - right.startFrame)
  const index = items.findIndex(item => item.id === segmentMenu.value.segmentId)
  if (index < 0) return
  const segment = items[index]
  const startFrame = segment.startFrame
  const kanaEndFrameExclusive = segment.speechEndFrameExclusive
  const hEndFrameExclusive = items[index + 1]?.startFrame ?? frameCount.value
  if (target === 'current-kana-h') {
    requestSegmentKanaAlignment(segment, hEndFrameExclusive)
    return
  }
  if (target === 'clear-kana') {
    clearSegmentKanaRange(segment, kanaEndFrameExclusive)
    return
  }
  if (target === 'clear-h') {
    clearSegmentHTokenRange(segment, hEndFrameExclusive)
    return
  }
  if (target === 'pul-h') {
    requestSegmentPulGeneration(segment, hEndFrameExclusive)
    return
  }
  if (target === 'midi-local') {
    openLocalMidiExtraction(segment.id)
    return
  }
  if (target !== 'kana' && target !== 'h') {
    flashStatus(`未知的 Segment 操作：${target}`)
    return
  }
  const textTarget = target
  const endFrameExclusive = textTarget === 'kana'
    ? kanaEndFrameExclusive
    : hEndFrameExclusive
  const affected = textTarget === 'kana'
    ? synthesisUnit.kanaTrack.units.filter(item => item.startFrame < endFrameExclusive && startFrame < item.endFrameExclusive)
    : synthesisUnit.hTokenTrack.events.filter(item => item.frame >= startFrame && item.frame < endFrameExclusive)
  const manualCount = affected.filter(item => item.origin === 'user').length
  if (manualCount > 0) {
    alignmentConfirm.value = {
      show: true,
      segmentId: segment.id,
      target: textTarget,
      startFrame,
      endFrameExclusive,
      objectCount: affected.length,
      manualCount,
    }
    return
  }
  void executeSegmentAlignment(segment.id, textTarget)
}

function requestSegmentPulGeneration(segment: SynthesisSegmentObject, endFrameExclusive: number) {
  const affected = synthesis.value?.hTokenTrack.events.filter(event => (
    event.frame >= segment.startFrame && event.frame < endFrameExclusive
  )) ?? []
  const manualCount = affected.filter(event => event.origin === 'user').length
  if (manualCount > 0) {
    alignmentConfirm.value = {
      show: true,
      segmentId: segment.id,
      target: 'pul',
      startFrame: segment.startFrame,
      endFrameExclusive,
      objectCount: affected.length,
      manualCount,
    }
    return
  }
  generateSegmentPulHTokens(segment, endFrameExclusive)
}

function generateSegmentPulHTokens(segment: SynthesisSegmentObject, endFrameExclusive: number) {
  if (!unit.value) return
  let mapped
  try {
    mapped = kanaToHTokens(segment.kana)
  } catch (error: any) {
    flashStatus(error?.message || '当前 Segment Kana 无法生成 H Token')
    return
  }
  const rangeWidth = endFrameExclusive - segment.startFrame
  if (mapped.length + 1 > rangeWidth) {
    flashStatus(`当前 Segment H 范围不足：需要 ${mapped.length + 1} 帧，当前只有 ${rangeWidth} 帧`)
    return
  }

  const sourceRef = {
    unitId: unit.value.id,
    track: 'segment' as const,
    revision: synthesis.value?.segmentTrack.revision ?? 0,
    guideSHA256: synthesis.value?.guide.audioSHA256,
  }
  const sepFrame = endFrameExclusive - 1
  const events: SynthesisHTokenEvent[] = []
  for (let offset = 0; offset < rangeWidth; offset++) {
    const frame = segment.startFrame + offset
    const mappedToken = mapped[offset]
    const isSep = frame === sepFrame
    const tokenId = isSep ? 365 : mappedToken?.tokenId ?? 366
    const symbol = isSep ? '<SEP>' : mappedToken?.symbol ?? '<PUL>'
    events.push({
      id: `h:pul:${segment.id}:${frame}`,
      frame,
      tokenId,
      symbol,
      origin: 'segment-align',
      generatedFrom: sourceRef,
    })
  }
  const before = objectTree.snapshotTree()
  const result = objectTree.replaceSynthesisHTokenTrackRange(
    unit.value.id,
    segment.startFrame,
    endFrameExclusive,
    events,
    undefined,
    undefined,
    'Segment -> H by PUL',
    'segment',
    [{
      phraseId: segment.id,
      startFrame: segment.startFrame,
      endFrameExclusive,
      placementMode: 'pul',
      fallbackReason: null,
    }],
    'alignment',
  )
  if (!result.ok) {
    flashStatus(result.reason ?? '按 PUL 生成 H Token 失败')
    return
  }
  history.push({
    description: `按 PUL 生成 Segment H Token · frame ${segment.startFrame}..${endFrameExclusive - 1}`,
    patches: [], inversePatches: [],
    objectTree: { kind: 'snapshot', before, after: objectTree.snapshotTree() },
  })
  flashStatus(`已按 PUL 生成 H Token · 覆盖 frame ${segment.startFrame}..${endFrameExclusive - 1}`)
}

async function confirmSegmentAlignment() {
  const confirmation = { ...alignmentConfirm.value }
  alignmentConfirm.value.show = false
  if (confirmation.target === 'current-kana-h') {
    await executeSegmentKanaAlignment(confirmation.segmentId)
  } else if (confirmation.target === 'pul') {
    const segment = synthesis.value?.segmentTrack.items.find(item => item.id === confirmation.segmentId)
    if (segment) generateSegmentPulHTokens(segment, confirmation.endFrameExclusive)
  } else {
    await executeSegmentAlignment(confirmation.segmentId, confirmation.target)
  }
}

function requestSegmentKanaAlignment(segment: SynthesisSegmentObject, endFrameExclusive: number) {
  const synthesisUnit = synthesis.value
  if (!synthesisUnit) return
  try {
    getKanaPhraseForSegment(synthesisUnit.kanaTrack, frameCount.value, {
      segmentStartFrame: segment.startFrame,
      segmentSpeechEndFrameExclusive: segment.speechEndFrameExclusive,
      segmentControlEndFrameExclusive: endFrameExclusive,
    })
  } catch (error: any) {
    showBlockingError(error?.message || '当前 Segment 的 Kana 分句无效', '无法按当前 Kana 对齐 H Token')
    return
  }
  const affected = synthesisUnit.hTokenTrack.events.filter(event => (
    event.frame >= segment.startFrame && event.frame < endFrameExclusive
  )) ?? []
  const manualCount = affected.filter(event => event.origin === 'user').length
  if (manualCount > 0) {
    alignmentConfirm.value = {
      show: true,
      segmentId: segment.id,
      target: 'current-kana-h',
      startFrame: segment.startFrame,
      endFrameExclusive,
      objectCount: affected.length,
      manualCount,
    }
    return
  }
  void executeSegmentKanaAlignment(segment.id)
}

async function executeSegmentKanaAlignment(segmentId: string) {
  const ok = await ensureAnalysisCapacity([{ modelId: 'SOFA Japanese' }], 'sofa', {
    segmentId,
    target: 'current-kana-h',
  })
  if (!ok) return
  const result = await analysis.alignSegmentFromKana(props.objectId, segmentId)
  if (result.ok) flashStatus(analysisJob.value.message)
  else showBlockingError(result.reason ?? '按当前 Kana 对齐 H Token 失败', 'H Token 对齐失败')
}

async function executeSegmentAlignment(segmentId: string, target: SegmentTextControlTarget) {
  const ok = await ensureAnalysisCapacity([{ modelId: 'SOFA Japanese' }], 'sofa', { segmentId, target })
  if (!ok) return
  const result = await analysis.alignSegmentTextControl(props.objectId, segmentId, target)
  if (result.ok) flashStatus(analysisJob.value.message)
  else showBlockingError(result.reason ?? 'Text Control 对齐失败', 'Text Control 对齐失败')
}

function openKanaMenu(event: MouseEvent, kanaUnitId: string) {
  event.preventDefault()
  event.stopPropagation()
  kanaMenu.value = { show: false, x: event.clientX, y: event.clientY, kanaUnitId }
  nextTick(() => { kanaMenu.value.show = true })
}

function chooseKanaMenu(key: string) {
  kanaMenu.value.show = false
  if (key === 'map-h') {
    mapKanaToHTokens(kanaMenu.value.kanaUnitId)
    return
  }
  requestKanaAlignment(kanaMenu.value.kanaUnitId)
}

function mapKanaToHTokens(kanaUnitId: string) {
  if (!unit.value) return
  const kana = synthesis.value?.kanaTrack.units.find(item => item.id === kanaUnitId)
  if (!kana) {
    flashStatus('KanaUnit 不存在')
    return
  }
  let mapped
  try {
    mapped = kanaToHTokens(kana.kana)
  } catch (error: any) {
    flashStatus(error?.message || 'Kana 无法映射至 H token')
    return
  }
  if (mapped.length === 0) {
    flashStatus('当前 Kana 为空，无法映射至 H token')
    return
  }
  const width = kana.endFrameExclusive - kana.startFrame
  if (mapped.length > width) {
    flashStatus(`Kana 宽度不足：需要 ${mapped.length} 帧，当前只有 ${width} 帧`)
    return
  }
  const before = objectTree.snapshotTree()
  const events: SynthesisHTokenEvent[] = mapped.map((token, offset) => ({
    id: `h:direct:${crypto.randomUUID()}`,
    frame: kana.startFrame + offset,
    tokenId: token.tokenId,
    symbol: token.symbol,
    origin: 'user',
  }))
  const result = objectTree.replaceSynthesisHTokenTrackRange(
    unit.value.id,
    kana.startFrame,
    kana.endFrameExclusive,
    events,
    undefined,
    undefined,
    'Kana -> H 直接映射',
    'kana',
    undefined,
    'user',
  )
  if (!result.ok) {
    flashStatus(result.reason ?? 'Kana 映射 H token 失败')
    return
  }
  history.push({
    description: 'Kana 映射至 H Token', patches: [], inversePatches: [],
    objectTree: { kind: 'snapshot', before, after: objectTree.snapshotTree() },
  })
  flashStatus(`已映射 ${mapped.length} 个 H token；仅覆盖当前 Kana frame 范围`)
}

function alignSelectedKana() {
  if (!selectedKanaUnitId.value) {
    flashStatus('请先点击一个 Kana，再执行对齐')
    return
  }
  requestKanaAlignment(selectedKanaUnitId.value)
}

function requestKanaAlignment(kanaUnitId: string) {
  const synthesisUnit = synthesis.value
  if (!synthesisUnit) return
  try {
    const range = getKanaControlRange(synthesisUnit.kanaTrack, kanaUnitId, frameCount.value)
    const affected = synthesisUnit.hTokenTrack.events.filter(event => (
      event.frame >= range.startFrame && event.frame < range.endFrameExclusive
    ))
    const manualCount = affected.filter(event => event.origin === 'user').length
    if (manualCount > 0) {
      kanaAlignmentConfirm.value = {
        show: true,
        kanaUnitId,
        kana: range.unit.kana,
        startFrame: range.startFrame,
        endFrameExclusive: range.endFrameExclusive,
        objectCount: affected.length,
        manualCount,
      }
      return
    }
    void executeKanaAlignment(kanaUnitId)
  } catch (error: any) {
    showBlockingError(error?.message || 'Kana control range 无效', '无法对齐 Kana H Token')
  }
}

async function confirmKanaAlignment() {
  const kanaUnitId = kanaAlignmentConfirm.value.kanaUnitId
  kanaAlignmentConfirm.value.show = false
  await executeKanaAlignment(kanaUnitId)
}

async function executeKanaAlignment(kanaUnitId: string) {
  const ok = await ensureAnalysisCapacity([{ modelId: 'SOFA Japanese' }], 'sofa', { kanaUnitId })
  if (!ok) return
  const result = await analysis.alignKanaTextControl(props.objectId, kanaUnitId)
  if (result.ok) flashStatus(analysisJob.value.message)
  else showBlockingError(result.reason ?? 'Kana → H 对齐失败', 'Kana → H 对齐失败')
}

function beginHTokenDrag(event: PointerEvent, eventId: string, sourceFrame: number) {
  if (event.button !== 0) return
  event.preventDefault()
  event.stopPropagation()
  hDrag.value = { eventId, sourceFrame, targetFrame: sourceFrame, startX: event.clientX }
  window.addEventListener('pointermove', updateHTokenDrag)
  window.addEventListener('pointerup', finishHTokenDrag, { once: true })
  window.addEventListener('pointercancel', cancelHTokenDrag, { once: true })
}

function updateHTokenDrag(event: PointerEvent) {
  const drag = hDrag.value
  if (!drag) return
  const delta = Math.round((event.clientX - drag.startX) / pxPerFrame.value)
  drag.targetFrame = Math.max(0, Math.min(frameCount.value - 1, drag.sourceFrame + delta))
}

function finishHTokenDrag() {
  const drag = hDrag.value
  clearHTokenDragListeners()
  if (!drag || !unit.value || drag.targetFrame === drag.sourceFrame) return
  const before = objectTree.snapshotTree()
  const result = objectTree.moveSynthesisHToken(unit.value.id, drag.eventId, drag.targetFrame)
  if (!result.ok) {
    flashStatus(result.reason ?? 'H Token 移动失败')
    return
  }
  history.push({
    description: `移动 H Token · ${drag.sourceFrame} → ${drag.targetFrame}`,
    patches: [],
    inversePatches: [],
    objectTree: { kind: 'snapshot', before, after: objectTree.snapshotTree() },
  })
  flashStatus(`H Token 已移动到 frame ${drag.targetFrame}`)
}

function cancelHTokenDrag() {
  clearHTokenDragListeners()
}

function clearHTokenDragListeners() {
  window.removeEventListener('pointermove', updateHTokenDrag)
  window.removeEventListener('pointerup', finishHTokenDrag)
  window.removeEventListener('pointercancel', cancelHTokenDrag)
  hDrag.value = null
}

function hEventStyle(eventId: string, frame: number) {
  const drag = hDrag.value
  const target = drag?.eventId === eventId ? drag.targetFrame : frame
  return {
    left: `${frameToDisplayX(target)}px`,
    width: `${Math.max(2, pxPerFrame.value - 1)}px`,
  }
}

function flashStatus(message: string) {
  statusNotice.value = message
  window.clearTimeout(noticeTimer)
  noticeTimer = window.setTimeout(() => {
    if (statusNotice.value === message) statusNotice.value = ''
  }, 2400)
}

function showBlockingError(message: string, title = '操作失败') {
  window.clearTimeout(noticeTimer)
  statusNotice.value = ''
  blockingError.value = { show: true, title, message }
}

function openSegmentEditor(segmentId: string) {
  const segment = synthesis.value?.segmentTrack.items.find(item => item.id === segmentId)
  if (!segment) return
  segmentEditor.value = {
    show: true,
    mode: 'edit',
    id: segment.id,
    text: segment.text,
    kana: segment.kana,
    romaji: segment.romaji,
    startFrame: segment.startFrame,
    speechEndFrameExclusive: segment.speechEndFrameExclusive,
  }
}

function openCreateSegmentEditor(startFrame: number, endFrameExclusive: number) {
  segmentEditor.value = {
    show: true,
    mode: 'create',
    id: '',
    text: '',
    kana: '',
    romaji: '',
    startFrame,
    speechEndFrameExclusive: endFrameExclusive,
  }
}

function updateSegmentEditorKana(value: string) {
  segmentEditor.value.kana = value
  segmentEditor.value.romaji = kanaToRomaji(value)
}

function updateSegmentEditorRomaji(value: string) {
  segmentEditor.value.romaji = value
  segmentEditor.value.kana = romajiToKana(value)
}

function saveSegmentEditor() {
  if (!unit.value) return
  const before = objectTree.snapshotTree()
  const edit = segmentEditor.value
  const result = edit.mode === 'create'
    ? objectTree.createSynthesisSegment(unit.value.id, {
      id: `segment:user:${crypto.randomUUID()}`,
      text: edit.text,
      kana: edit.kana,
      romaji: edit.romaji,
      startFrame: edit.startFrame,
      speechEndFrameExclusive: edit.speechEndFrameExclusive,
      origin: 'user',
    })
    : objectTree.updateSynthesisSegment(unit.value.id, edit.id, {
      text: edit.text,
      kana: edit.kana,
      romaji: edit.romaji,
      startFrame: edit.startFrame,
      speechEndFrameExclusive: edit.speechEndFrameExclusive,
    }, 'edit Segment content and range')
  if (!result.ok) {
    flashStatus(result.reason ?? 'Segment 修改失败')
    return
  }
  history.push({
    description: edit.mode === 'create' ? '新建 Segment' : '编辑 Segment', patches: [], inversePatches: [],
    objectTree: { kind: 'snapshot', before, after: objectTree.snapshotTree() },
  })
  segmentEditor.value.show = false
  flashStatus(edit.mode === 'create' ? 'Segment 已创建；Kana/H/MIDI-P 保持不变' : 'Segment 已更新；Kana/H/MIDI-P 保持不变')
}

function beginSegmentBoundaryDrag(event: PointerEvent, segmentId: string, edge: 'start' | 'end') {
  if (event.button !== 0) return
  event.preventDefault()
  event.stopPropagation()
  const items = [...(synthesis.value?.segmentTrack.items ?? [])].sort((left, right) => left.startFrame - right.startFrame)
  const index = items.findIndex(item => item.id === segmentId)
  if (index < 0) return
  const segment = items[index]
  segmentDrag.value = {
    segmentId,
    edge,
    startX: event.clientX,
    originalStart: segment.startFrame,
    originalEnd: segment.speechEndFrameExclusive,
    previewStart: segment.startFrame,
    previewEnd: segment.speechEndFrameExclusive,
    minStart: items[index - 1]?.speechEndFrameExclusive ?? 0,
    maxEnd: items[index + 1]?.startFrame ?? frameCount.value,
  }
  window.addEventListener('pointermove', updateSegmentBoundaryDrag)
  window.addEventListener('pointerup', finishSegmentBoundaryDrag, { once: true })
  window.addEventListener('pointercancel', cancelSegmentBoundaryDrag, { once: true })
}

function updateSegmentBoundaryDrag(event: PointerEvent) {
  const drag = segmentDrag.value
  if (!drag) return
  const delta = Math.round((event.clientX - drag.startX) / pxPerFrame.value)
  if (drag.edge === 'start') {
    drag.previewStart = Math.max(drag.minStart, Math.min(drag.originalEnd - 1, drag.originalStart + delta))
  } else {
    drag.previewEnd = Math.max(drag.originalStart + 1, Math.min(drag.maxEnd, drag.originalEnd + delta))
  }
}

function finishSegmentBoundaryDrag() {
  const drag = segmentDrag.value
  clearSegmentDragListeners()
  if (!drag || !unit.value) return
  if (drag.previewStart === drag.originalStart && drag.previewEnd === drag.originalEnd) return
  const before = objectTree.snapshotTree()
  const result = objectTree.updateSynthesisSegment(unit.value.id, drag.segmentId, {
    startFrame: drag.previewStart,
    speechEndFrameExclusive: drag.previewEnd,
  }, `drag Segment ${drag.edge} boundary`)
  if (!result.ok) {
    flashStatus(result.reason ?? 'Segment 边界修改失败')
    return
  }
  history.push({
    description: '拖动 Segment 边界', patches: [], inversePatches: [],
    objectTree: { kind: 'snapshot', before, after: objectTree.snapshotTree() },
  })
  flashStatus('Segment 边界已更新；其他轨保持不变')
}

function cancelSegmentBoundaryDrag() {
  clearSegmentDragListeners()
}

function clearSegmentDragListeners() {
  window.removeEventListener('pointermove', updateSegmentBoundaryDrag)
  window.removeEventListener('pointerup', finishSegmentBoundaryDrag)
  window.removeEventListener('pointercancel', cancelSegmentBoundaryDrag)
  segmentDrag.value = null
}

function segmentStart(segmentId: string, fallback: number) {
  return segmentDrag.value?.segmentId === segmentId ? segmentDrag.value.previewStart : fallback
}

function segmentEnd(segmentId: string, fallback: number) {
  return segmentDrag.value?.segmentId === segmentId ? segmentDrag.value.previewEnd : fallback
}

function openKanaEditor(kanaUnitId: string) {
  const kana = synthesis.value?.kanaTrack.units.find(item => item.id === kanaUnitId)
  if (!kana) return
  kanaEditor.value = { show: true, id: kana.id, kana: kana.kana, romaji: kana.romaji }
}

function updateKanaEditorKana(value: string) {
  kanaEditor.value.kana = value
  kanaEditor.value.romaji = kanaToRomaji(value)
}

function updateKanaEditorRomaji(value: string) {
  kanaEditor.value.romaji = value
  kanaEditor.value.kana = romajiToKana(value)
}

function saveKanaEditor() {
  if (!unit.value) return
  const before = objectTree.snapshotTree()
  const result = objectTree.updateSynthesisKana(unit.value.id, kanaEditor.value.id, {
    kana: kanaEditor.value.kana,
    romaji: kanaEditor.value.romaji,
  })
  if (!result.ok) {
    flashStatus(result.reason ?? 'Kana 修改失败')
    return
  }
  history.push({
    description: '编辑 Kana', patches: [], inversePatches: [],
    objectTree: { kind: 'snapshot', before, after: objectTree.snapshotTree() },
  })
  kanaEditor.value.show = false
  flashStatus('Kana 已更新；Segment/H/MIDI-P 保持不变')
}

function beginKanaObjectDrag(event: PointerEvent, kanaUnitId: string) {
  if (event.button !== 0) return
  const kana = synthesis.value?.kanaTrack.units.find(item => item.id === kanaUnitId)
  if (!kana) return
  event.preventDefault()
  event.stopPropagation()
  selectKana(kanaUnitId)
  kanaObjectDrag.value = {
    unitId: kanaUnitId,
    startX: event.clientX,
    originalStartFrame: kana.startFrame,
    widthFrames: kana.endFrameExclusive - kana.startFrame,
    previewStartFrame: kana.startFrame,
  }
  window.addEventListener('pointermove', updateKanaObjectDrag)
  window.addEventListener('pointerup', finishKanaObjectDrag, { once: true })
  window.addEventListener('pointercancel', cancelKanaObjectDrag, { once: true })
}

function updateKanaObjectDrag(event: PointerEvent) {
  const drag = kanaObjectDrag.value
  if (!drag) return
  const delta = Math.round((event.clientX - drag.startX) / pxPerFrame.value)
  drag.previewStartFrame = Math.max(0, Math.min(
    frameCount.value - drag.widthFrames,
    drag.originalStartFrame + delta,
  ))
}

function finishKanaObjectDrag() {
  const drag = kanaObjectDrag.value
  clearKanaObjectDragListeners()
  if (!drag || !unit.value || drag.previewStartFrame === drag.originalStartFrame) return
  const before = objectTree.snapshotTree()
  const result = objectTree.moveSynthesisKanaUnit(unit.value.id, drag.unitId, drag.previewStartFrame)
  if (!result.ok) {
    showBlockingError(result.reason ?? 'Kana 整体移动失败', '无法移动 Kana')
    return
  }
  history.push({
    description: '整体拖动 Kana', patches: [], inversePatches: [],
    objectTree: { kind: 'snapshot', before, after: objectTree.snapshotTree() },
  })
  flashStatus(`Kana 已整体移动到 frame ${drag.previewStartFrame}`)
}

function cancelKanaObjectDrag() {
  clearKanaObjectDragListeners()
}

function clearKanaObjectDragListeners() {
  window.removeEventListener('pointermove', updateKanaObjectDrag)
  window.removeEventListener('pointerup', finishKanaObjectDrag)
  window.removeEventListener('pointercancel', cancelKanaObjectDrag)
  kanaObjectDrag.value = null
}

function beginKanaSegDrag(event: PointerEvent, boundaryId: string) {
  if (event.button !== 0) return
  const boundary = synthesis.value?.kanaTrack.boundaries.find(item => item.id === boundaryId)
  if (!boundary) return
  event.preventDefault()
  event.stopPropagation()
  kanaSegDrag.value = {
    boundaryId,
    startX: event.clientX,
    originalFrame: boundary.frame,
    previewFrame: boundary.frame,
  }
  window.addEventListener('pointermove', updateKanaSegDrag)
  window.addEventListener('pointerup', finishKanaSegDrag, { once: true })
  window.addEventListener('pointercancel', cancelKanaSegDrag, { once: true })
}

function updateKanaSegDrag(event: PointerEvent) {
  const drag = kanaSegDrag.value
  if (!drag) return
  const delta = Math.round((event.clientX - drag.startX) / pxPerFrame.value)
  drag.previewFrame = Math.max(0, Math.min(frameCount.value - 1, drag.originalFrame + delta))
}

function finishKanaSegDrag() {
  const drag = kanaSegDrag.value
  clearKanaSegDragListeners()
  if (!drag || !unit.value || drag.previewFrame === drag.originalFrame) return
  const before = objectTree.snapshotTree()
  const result = objectTree.moveSynthesisKanaSegmentBoundary(unit.value.id, drag.boundaryId, drag.previewFrame)
  if (!result.ok) {
    showBlockingError(result.reason ?? 'Kana SEG 移动失败', '无法移动 Kana SEG')
    return
  }
  history.push({
    description: '拖动 Kana SEG', patches: [], inversePatches: [],
    objectTree: { kind: 'snapshot', before, after: objectTree.snapshotTree() },
  })
  flashStatus(`Kana SEG 已移动到 frame ${drag.previewFrame}`)
}

function cancelKanaSegDrag() {
  clearKanaSegDragListeners()
}

function clearKanaSegDragListeners() {
  window.removeEventListener('pointermove', updateKanaSegDrag)
  window.removeEventListener('pointerup', finishKanaSegDrag)
  window.removeEventListener('pointercancel', cancelKanaSegDrag)
  kanaSegDrag.value = null
}

function beginKanaBoundaryDrag(event: PointerEvent, kanaUnitId: string, edge: 'start' | 'end') {
  if (event.button !== 0) return
  event.preventDefault()
  event.stopPropagation()
  const units = [...(synthesis.value?.kanaTrack.units ?? [])].sort((left, right) => left.startFrame - right.startFrame)
  const index = units.findIndex(item => item.id === kanaUnitId)
  if (index < 0) return
  const current = units[index]
  kanaDrag.value = {
    unitId: kanaUnitId,
    edge,
    startX: event.clientX,
    originalFrame: edge === 'start' ? current.startFrame : current.endFrameExclusive,
    previewFrame: edge === 'start' ? current.startFrame : current.endFrameExclusive,
    minFrame: edge === 'start' ? 0 : current.startFrame + 1,
    maxFrame: edge === 'start' ? current.endFrameExclusive - 1 : frameCount.value,
  }
  window.addEventListener('pointermove', updateKanaBoundaryDrag)
  window.addEventListener('pointerup', finishKanaBoundaryDrag, { once: true })
  window.addEventListener('pointercancel', cancelKanaBoundaryDrag, { once: true })
}

function updateKanaBoundaryDrag(event: PointerEvent) {
  const drag = kanaDrag.value
  if (!drag) return
  const delta = Math.round((event.clientX - drag.startX) / pxPerFrame.value)
  drag.previewFrame = Math.max(drag.minFrame, Math.min(drag.maxFrame, drag.originalFrame + delta))
}

function finishKanaBoundaryDrag() {
  const drag = kanaDrag.value
  clearKanaDragListeners()
  clearMidiDragListeners()
  stopScheduledMidiNodes()
  if (midiAudioContext) void midiAudioContext.close()
  if (!drag || !unit.value || drag.previewFrame === drag.originalFrame) return
  const before = objectTree.snapshotTree()
  const result = objectTree.moveSynthesisKanaBoundary(unit.value.id, drag.unitId, drag.edge, drag.previewFrame)
  if (!result.ok) {
    flashStatus(result.reason ?? 'Kana 边界修改失败')
    return
  }
  history.push({
    description: '拖动 Kana 边界', patches: [], inversePatches: [],
    objectTree: { kind: 'snapshot', before, after: objectTree.snapshotTree() },
  })
  flashStatus(`Kana 边界已移动到 frame ${drag.previewFrame}；其他轨保持不变`)
}

function cancelKanaBoundaryDrag() {
  clearKanaDragListeners()
}

function clearKanaDragListeners() {
  window.removeEventListener('pointermove', updateKanaBoundaryDrag)
  window.removeEventListener('pointerup', finishKanaBoundaryDrag)
  window.removeEventListener('pointercancel', cancelKanaBoundaryDrag)
  kanaDrag.value = null
}

function kanaStart(kanaUnitId: string, fallback: number) {
  const objectDrag = kanaObjectDrag.value
  if (objectDrag?.unitId === kanaUnitId) return objectDrag.previewStartFrame
  const drag = kanaDrag.value
  if (!drag) return fallback
  return drag.unitId === kanaUnitId && drag.edge === 'start' ? drag.previewFrame : fallback
}

function kanaEnd(kanaUnitId: string, fallback: number) {
  const objectDrag = kanaObjectDrag.value
  if (objectDrag?.unitId === kanaUnitId) return objectDrag.previewStartFrame + objectDrag.widthFrames
  const drag = kanaDrag.value
  if (!drag) return fallback
  return drag.unitId === kanaUnitId && drag.edge === 'end' ? drag.previewFrame : fallback
}

function kanaSegFrame(boundaryId: string, fallback: number) {
  const drag = kanaSegDrag.value
  return drag?.boundaryId === boundaryId ? drag.previewFrame : fallback
}

function formatTime(seconds: number) {
  if (!Number.isFinite(seconds)) return '0:00.000'
  const minutes = Math.floor(seconds / 60)
  return `${minutes}:${(seconds % 60).toFixed(3).padStart(6, '0')}`
}

function hTokenLabel(tokenId: number, symbol?: string) {
  if (tokenId === 365) return 'SEP'
  if (tokenId === 366) return 'PUL'
  return symbol || String(tokenId)
}

function showHTokenTooltip(event: MouseEvent, tokenId: number, frame: number) {
  hoveredHTokenId.value = tokenId
  hTokenTooltip.value = {
    show: true,
    x: Math.min(event.clientX + 14, window.innerWidth - 300),
    y: Math.min(event.clientY + 14, window.innerHeight - 170),
    frame,
  }
}

function hideHTokenTooltip() {
  hoveredHTokenId.value = null
  hTokenTooltip.value.show = false
}

onBeforeUnmount(() => {
  unbindEditorKeyboard()
  clearHTokenDragListeners()
  clearSegmentDragListeners()
  clearKanaDragListeners()
  clearKanaObjectDragListeners()
  clearKanaSegDragListeners()
  window.clearTimeout(noticeTimer)
  if (guideUrl.value) URL.revokeObjectURL(guideUrl.value)
  if (referenceGuideUrl.value) URL.revokeObjectURL(referenceGuideUrl.value)
  if (takeUrl.value) URL.revokeObjectURL(takeUrl.value)
})
</script>

<template>
  <main v-if="unit && synthesis" class="synthesis-editor" tabindex="0">
    <header class="editor-toolbar">
      <div class="transport">
        <NButton quaternary circle :title="playing ? '暂停' : '播放'" @click="togglePlayback">
          <template #icon><NIcon><Pause v-if="playing" /><Play v-else /></NIcon></template>
        </NButton>
        <NButton quaternary circle title="停止" @click="stopPlayback">
          <template #icon><NIcon><Stop /></NIcon></template>
        </NButton>
        <span class="time-readout">{{ formatTime(frameToAudioTime(playheadFrame)) }} / {{ durationLabel }}</span>
      </div>
      <NRadioGroup v-model:value="auditionSource" size="small">
        <NRadioButton value="guide">Guide</NRadioButton>
        <NRadioButton value="midi-p" :disabled="!midiReady">MIDI-P</NRadioButton>
        <NRadioButton value="take" :disabled="!activeTakeBlob">Take</NRadioButton>
      </NRadioGroup>
      <div class="zoom-control">
        <span>Frame</span>
        <NSlider v-model:value="pxPerFrame" :min="6" :max="24" :step="1" :tooltip="false" />
        <span>{{ pxPerFrame }}px</span>
      </div>
      <div class="speed-control">
        <span>速度</span>
        <NSlider v-model:value="playbackRate" :min="0.1" :max="1.5" :step="0.1" :tooltip="false" />
        <span>{{ playbackRate.toFixed(1) }}x</span>
      </div>
      <div class="toolbar-spacer" />
      <LyricProofreader
        :unit-id="objectId" :selected-id="selectedSegmentId" :busy="analysisBusy"
        :playing="playing" :anchor="lyricAnchor"
        @select="selectLyricSegment" @audition="auditionLyricRange" @stop="stopPlayback"
        @align="(id, target) => chooseSegmentMenuFor(id, target)"
      />
    </header>

    <div v-if="takePreparation.running || takeGeneration.running || analysisJob.running || capacityPreparing" class="analysis-progress-top">
      <div class="analysis-progress-track">
        <div
          class="analysis-progress-bar top"
          :style="{ width: `${takePreparation.running ? takePreparation.progress : takeGeneration.running ? takeGeneration.progress : analysisJob.running ? analysisProgress : 4}%` }"
        />
      </div>
      <span>{{ takePreparation.running ? `${Math.round(takePreparation.progress)}% · ${takePreparation.message}` : takeGeneration.running ? `${Math.round(takeGeneration.progress)}% · ${takeGeneration.message}` : analysisJob.running ? `${analysisProgress}% · ${analysisJob.message}` : capacityPreparing?.message }}</span>
    </div>

    <section
      class="reference-strip"
      :class="{ active: referenceDropActive, empty: !synthesis.reference }"
      @dragover="handleReferenceDragOver"
      @dragleave.self="referenceDropActive = false"
      @drop="handleReferenceDrop"
    >
      <div class="reference-heading">
        <NIcon><LinkOutline /></NIcon>
        <span>A 区参考</span>
        <small>完整 Guide · 跟随最新</small>
      </div>
      <template v-if="referenceUnit">
        <NDropdown trigger="click" :options="referenceMenuOptions" @select="chooseReferenceUnit">
          <button type="button" class="reference-main" title="更换 A 区参考">
            <strong>{{ referenceUnit.name }}</strong>
            <span>
              {{ formatTime(referenceUnit.synthesisUnit.guide.duration) }} · unit r{{ referenceUnit.synthesisUnit.unitRevision }} · H r{{ referenceUnit.synthesisUnit.hTokenTrack.revision }}
            </span>
          </button>
        </NDropdown>
        <span class="reference-state" :class="{ warning: referenceStatus.warning }">{{ referenceStatus.label }}</span>
        <NButton quaternary circle size="small" :disabled="!referenceGuideUrl" :title="referencePlaying ? '暂停 A 区完整 Guide' : '试听 A 区完整 Guide'" @click="toggleReferenceGuide">
          <template #icon><NIcon><Pause v-if="referencePlaying" /><Play v-else /></NIcon></template>
        </NButton>
        <NButton quaternary circle size="small" title="打开参考合成单元" @click="openReferenceUnit">
          <template #icon><NIcon><OpenOutline /></NIcon></template>
        </NButton>
        <NButton quaternary circle size="small" title="解除 A 区参考" @click="unbindReferenceUnit">
          <template #icon><NIcon><UnlinkOutline /></NIcon></template>
        </NButton>
      </template>
      <template v-else-if="synthesis.reference">
        <div class="reference-main invalid">
          <strong>引用对象不存在</strong>
          <span>{{ synthesis.reference.unitId }}</span>
        </div>
        <span class="reference-state warning">{{ referenceStatus.label }}</span>
        <NButton quaternary circle size="small" title="解除失效引用" @click="unbindReferenceUnit">
          <template #icon><NIcon><UnlinkOutline /></NIcon></template>
        </NButton>
      </template>
      <template v-else>
        <span class="reference-empty-state">未绑定</span>
        <NDropdown trigger="click" :options="referenceMenuOptions" @select="chooseReferenceUnit">
          <NButton size="small" secondary :disabled="referenceMenuOptions.length === 0">
            <template #icon><NIcon><LinkOutline /></NIcon></template>
            选择合成单元
          </NButton>
        </NDropdown>
      </template>
      <NPopover v-model:show="samplingMenuOpen" trigger="click" placement="bottom-end" class="sampling-popover">
        <template #trigger>
          <NButton size="small" secondary :disabled="takePreparation.running || takeGeneration.running" :title="`高级采样控制 · ${samplingSummary}`">
            <template #icon><NIcon><OptionsOutline /></NIcon></template>
            {{ samplingSummary }}
          </NButton>
        </template>
        <div class="sampling-panel">
          <header><strong>高级采样控制</strong><span>设置只影响之后生成的新 Take</span></header>
          <label class="sampling-mode"><span>引导模式</span>
            <NRadioGroup v-model:value="guidanceMode" size="small">
              <NRadioButton value="unified">统一 CFG</NRadioButton>
              <NRadioButton value="three-way" :disabled="!unitModelMeta.supportsThreeWayCfg">三路 CFG</NRadioButton>
            </NRadioGroup>
          </label>
          <div v-if="guidanceMode === 'unified'" class="sampling-fields">
            <label><span>统一 CFG</span><small>同时加强 A 区音色、Text/H 和 MIDI-P。当前兼容模式。</small><NInputNumber v-model:value="unifiedCfg" :min="0" :max="10" :step="0.1" /></label>
          </div>
          <div v-else class="sampling-fields three-way-fields">
            <label><span>A 区音色 CFG</span><small>加强对参考音频音色、唱法和声学特征的遵循。</small><NInputNumber v-model:value="audioCfg" :min="0" :max="10" :step="0.1" /></label>
            <label><span>Text / H CFG</span><small>加强对 H token、歌词和发音时序的遵循。</small><NInputNumber v-model:value="textCfg" :min="0" :max="10" :step="0.1" /></label>
            <label><span>MIDI-P CFG</span><small>加强对音高和音符边界的遵循。</small><NInputNumber v-model:value="midiCfg" :min="0" :max="10" :step="0.1" /></label>
            <p>三路均为同一数值时，与该数值的统一 CFG 等价。三路模式顺序执行四个条件分支，预计约为统一 CFG 的 2 倍耗时。</p>
          </div>
          <div class="sampling-fields sampling-common">
            <label><span>采样步数</span><small>默认 32；步数越高通常越慢。</small><NInputNumber v-model:value="samplingSteps" :min="1" :max="256" :step="1" /></label>
            <label><span>随机 Seed</span><small>相同材料和参数下复现同一结果。</small><NInputNumber v-model:value="samplingSeed" :min="0" :max="4294967295" :step="1" /></label>
          </div>
          <div class="sampling-training">训练条件 dropout：A 30% · Text 15% · MIDI 30%</div>
        </div>
      </NPopover>
      <NButton
        circle
        size="small"
        type="primary"
        :loading="takePreparation.running || takeGeneration.running"
        :disabled="takePreparation.running || takeGeneration.running"
        :title="takePrerequisiteMessage || '生成 V5-P Take'"
        @click="generateTake"
      >
        <template #icon><NIcon><ColorWandOutline /></NIcon></template>
      </NButton>
      <span v-if="takePrerequisiteMessage" class="take-prerequisite-hint">{{ takePrerequisiteMessage }}</span>
    </section>

    <section class="unit-summary">
      <div class="unit-identity">
        <strong>{{ unit.name }}</strong>
        <span>r{{ synthesis.unitRevision }}</span>
      </div>
      <div class="unit-model-picker" title="当前合成单元使用的 V5-P 模型">
        <NSelect
          v-model:value="unitModel"
          :options="modelOptions"
          size="small"
          :disabled="takePreparation.running || takeGeneration.running"
        />
      </div>
      <span>{{ frameCount }} frames</span>
      <span>{{ synthesis.guide.sampleCount.toLocaleString() }} samples</span>
      <span
        v-if="synthesis.frameContract.trailingSampleCount"
        class="warning"
        :title="`尾部 ${synthesis.frameContract.trailingSampleCount} samples 不进入 VAE frame`"
      >
        尾部 {{ synthesis.frameContract.trailingSampleCount }} samples
      </span>
      <span v-if="takePreparation.running" class="status-notice">{{ Math.round(takePreparation.progress) }}% · {{ takePreparation.message }}</span>
      <span v-else-if="takeGeneration.running" class="status-notice">{{ Math.round(takeGeneration.progress) }}% · {{ takeGeneration.message }}</span>
      <span v-else-if="analysisJob.running" class="status-notice">{{ Math.round(analysisJob.progress) }}% · {{ analysisJob.message }}</span>
      <span v-else-if="statusNotice" class="status-notice">{{ statusNotice }}</span>
      <span
        v-else-if="hoveredHEntry"
        class="token-readout"
        :title="`${hoveredHEntry.chineseName}：${hoveredHEntry.explanation}`"
      >
        {{ hoveredHEntry.chineseName }} · {{ hoveredHEntry.token }} · ID {{ hoveredHEntry.id }} · {{ hoveredHEntry.v5p40kSeen ? 'V5-P 训练见过' : 'V5-P 未见' }}
      </span>
      <span v-else class="hash">Guide {{ synthesis.guide.audioSHA256.slice(0, 10) }}</span>
    </section>

    <section v-if="synthesis.takes.length" class="take-strip">
      <div class="take-heading">
        <span>Takes</span>
        <small>{{ synthesis.takes.length }}</small>
      </div>
      <div ref="takeListRef" class="take-list">
        <template v-for="take in synthesis.takes" :key="take.id">
          <input
            v-if="editingTakeId === take.id"
            v-model="takeNameDraft"
            class="take-name-input"
            type="text"
            aria-label="Take 名称"
            @keydown.enter.prevent="commitTakeRename"
            @keydown.esc.prevent="cancelTakeRename"
            @blur="commitTakeRename"
          >
          <button
            v-else
            type="button"
            class="take-item"
            :class="{ active: take.id === synthesis.activeTakeId, failed: take.status === 'failed' }"
            :aria-disabled="take.status !== 'ready'"
            :title="take.error || `${take.name} · target r${take.targetUnitRevision} · reference r${take.referenceUnitRevision} · ${takeSamplingLabel(take)}`"
            @click="take.status === 'ready' && selectTake(take.id)"
            @dblclick.stop="beginTakeRename(take)"
            @keydown.f2.prevent="beginTakeRename(take)"
          >
            <strong>{{ take.name }}</strong>
            <span>{{ take.status === 'ready' ? formatTime(take.duration ?? 0) : take.status }}</span>
          </button>
        </template>
      </div>
      <NButton
        quaternary
        circle
        size="small"
        :disabled="!activeTakeBlob"
        :title="playing && auditionSource === 'take' ? '暂停当前 Take' : '试听当前 Take'"
        @click="auditionSource = 'take'; togglePlayback()"
      >
        <template #icon><NIcon><Pause v-if="playing && auditionSource === 'take'" /><Play v-else /></NIcon></template>
      </NButton>
      <NButton quaternary circle size="small" :disabled="!activeTakeBlob" title="导出当前 Take 到正式音轨" @click="exportActiveTake">
        <template #icon><NIcon><DownloadOutline /></NIcon></template>
      </NButton>
    </section>

    <section class="editor-workspace">
    <section ref="timelineScrollRef" class="timeline-scroll" @wheel="handleTimelineWheel">
      <div class="timeline-content" :style="{ width: `${timelineWidth + 132}px`, '--grid-size': `${pxPerFrame}px` }">
        <div class="timeline-row ruler-row">
          <div class="track-label ruler-label">Frame / Time</div>
          <div class="track-space ruler" :style="{ width: `${timelineWidth}px` }" @click="seekFromPointer">
            <div
              v-for="frame in frameTicks"
              :key="frame"
              class="frame-tick"
              :class="{ major: frame % majorTickEvery === 0 }"
              :style="{ left: `${frameToDisplayX(frame)}px` }"
            >
              <span v-if="frame % majorTickEvery === 0">{{ frame }}</span>
            </div>
          </div>
        </div>

        <div class="group-band">Source</div>
        <div class="timeline-row guide-row">
          <div class="track-label">
            <span>Guide Audio</span>
            <small>owned</small>
          </div>
          <div
            class="track-space guide-space"
            :class="{ selected: editorSelection?.type === 'guide' }"
            :style="{ width: `${timelineWidth}px` }"
            @click="seekGuideFromPointer"
            @contextmenu="openGuideMenu"
          >
            <canvas ref="waveformCanvas" :style="{ width: `${timelineWidth}px` }" />
          </div>
        </div>

        <div class="group-band">Text</div>
        <div class="timeline-row segment-row">
          <div class="track-label control-label">
            <span>Segment</span>
            <small>r{{ synthesis.segmentTrack.revision }}</small>
            <div class="row-actions">
              <NButton size="tiny" secondary class="row-action" :loading="textAnalysisRunning" :disabled="analysisBusy && !textAnalysisRunning" @click.stop="transcribeSegmentTrack">
                <template #icon><NIcon><MicOutline /></NIcon></template>转录
              </NButton>
              <NButton size="tiny" secondary class="row-action" :disabled="analysisBusy" @click.stop="alignSelectedSegment('kana')">Kana</NButton>
              <NButton size="tiny" secondary class="row-action" :disabled="analysisBusy" title="按当前 Kana 文本与边界重新运行 SOFA 硬边界对齐" @click.stop="alignSelectedSegment('current-kana-h')">H</NButton>
            </div>
          </div>
          <div class="track-space grid-space" :style="{ width: `${timelineWidth}px` }" @click="seekFromPointer" @contextmenu="openEmptySegmentMenu">
            <div
              v-for="segment in synthesis.segmentTrack.items"
              :key="segment.id"
              class="segment-object"
              :style="{
                left: `${frameToDisplayX(segmentStart(segment.id, segment.startFrame))}px`,
                width: `${frameToDisplayX(segmentEnd(segment.id, segment.speechEndFrameExclusive) - segmentStart(segment.id, segment.startFrame))}px`,
              }"
              :class="{ selected: selectedSegmentId === segment.id }"
              :data-lyric-status="lyricSegmentStatus(segment) || undefined"
              @click.stop="selectSegment(segment.id)"
              @dblclick.stop="openSegmentEditor(segment.id)"
              @contextmenu="openSegmentMenu($event, segment.id)"
            >
              <button
                type="button"
                class="boundary-handle start"
                title="拖动句首 frame"
                @pointerdown="beginSegmentBoundaryDrag($event, segment.id, 'start')"
              />
              <strong>{{ segment.kana || segment.text }}</strong>
              <NIcon v-if="lyricSegmentStatus(segment) && lyricSegmentStatus(segment) !== '未检查'" class="lyric-status" :title="lyricSegmentStatus(segment)" :aria-label="lyricSegmentStatus(segment)">
                <CheckmarkCircleOutline v-if="lyricSegmentStatus(segment) === '已应用'" />
                <AlertCircleOutline v-else-if="['需复核', '发音控制待更新'].includes(lyricSegmentStatus(segment))" />
                <TimeOutline v-else />
              </NIcon>
              <span v-if="uiSettings.settings.showRomaji">{{ segment.romaji }}</span>
              <button
                type="button"
                class="segment-actions"
                title="Segment 操作"
                @click="openSegmentMenu($event, segment.id)"
              ><NIcon><EllipsisHorizontal /></NIcon></button>
              <button
                type="button"
                class="boundary-handle end"
                title="拖动句尾 frame"
                @pointerdown="beginSegmentBoundaryDrag($event, segment.id, 'end')"
              />
            </div>
          </div>
        </div>

        <div class="timeline-row kana-row">
          <div class="track-label">
            <span>Kana</span>
            <small>r{{ synthesis.kanaTrack.revision }}</small>
            <NButton size="tiny" secondary class="row-action kana-action" :disabled="analysisBusy" @click.stop="alignSelectedKana">H</NButton>
          </div>
          <div class="track-space grid-space" :style="{ width: `${timelineWidth}px` }" @click="seekFromPointer">
            <div
              v-for="kana in synthesis.kanaTrack.units"
              :key="kana.id"
              class="kana-object"
              :style="{
                left: `${frameToDisplayX(kanaStart(kana.id, kana.startFrame))}px`,
                width: `${frameToDisplayX(kanaEnd(kana.id, kana.endFrameExclusive) - kanaStart(kana.id, kana.startFrame))}px`,
              }"
              :class="{ selected: selectedKanaUnitId === kana.id }"
              @click.stop="selectKana(kana.id)"
              title="拖动主体整体移动；拖动左右边缘调整宽度；双击编辑"
              @pointerdown="beginKanaObjectDrag($event, kana.id)"
              @dblclick.stop="openKanaEditor(kana.id)"
              @contextmenu="openKanaMenu($event, kana.id)"
            >
              <strong>{{ kana.kana }}</strong><span v-if="uiSettings.settings.showRomaji">{{ kana.romaji }}</span>
              <button
                type="button"
                class="boundary-handle start kana-boundary"
                title="拖动 Kana 起始边界"
                @pointerdown="beginKanaBoundaryDrag($event, kana.id, 'start')"
              />
              <button
                type="button"
                class="boundary-handle end kana-boundary"
                title="拖动 Kana 结束边界"
                @pointerdown="beginKanaBoundaryDrag($event, kana.id, 'end')"
              />
            </div>
            <div
              v-for="boundary in synthesis.kanaTrack.boundaries"
              :key="boundary.id"
              class="kana-seg"
              :style="{
                left: `${frameToDisplayX(kanaSegFrame(boundary.id, boundary.frame))}px`,
                width: `${Math.max(2, frameToDisplayX(1))}px`,
              }"
              title="SEG · 固定 1 frame · 拖动调整分句位置"
              @pointerdown="beginKanaSegDrag($event, boundary.id)"
            >SEG</div>
            <span v-if="synthesis.kanaTrack.status === 'empty'" class="empty-track">尚未生成 Kana</span>
          </div>
        </div>

        <div class="timeline-row h-row">
          <div class="track-label">
            <span>H Token</span>
            <small>r{{ synthesis.hTokenTrack.revision }}</small>
          </div>
          <div
            class="track-space grid-space"
            :style="{ width: `${timelineWidth}px` }"
            @click="selectHFrameFromPointer"
            @contextmenu="openHTokenPicker"
          >
            <div
              v-if="selectedHFrame != null"
              class="h-selection"
              :style="{ left: `${frameToDisplayX(selectedHFrame)}px`, width: `${pxPerFrame}px` }"
            />
            <div
              v-for="event in synthesis.hTokenTrack.events"
              :key="event.id"
              class="h-event"
              :class="{ special: event.tokenId >= 365, dragging: hDrag?.eventId === event.id, selected: selectedHFrame === event.frame }"
              :style="hEventStyle(event.id, event.frame)"
              :title="`${hTokenLabel(event.tokenId, event.symbol)} · ID ${event.tokenId} · frame ${event.frame}`"
              @mouseenter="showHTokenTooltip($event, event.tokenId, event.frame)"
              @mouseleave="hideHTokenTooltip"
              @click.stop="selectHFrame(event.frame)"
              @pointerdown="beginHTokenDrag($event, event.id, event.frame)"
              @dblclick="openHTokenPicker($event, event.frame)"
              @contextmenu="openHTokenPicker($event, event.frame)"
            >{{ hTokenLabel(event.tokenId, event.symbol) }}</div>
            <span v-if="synthesis.hTokenTrack.status === 'empty'" class="empty-track">尚未生成 H Token</span>
          </div>
        </div>

        <div class="group-band">Melody</div>
        <div class="timeline-row midi-row">
          <div class="track-label control-label">
            <span>MIDI-P</span>
            <small>r{{ synthesis.midiPTokenTrack.revision }}</small>
            <NButton
              size="tiny"
              secondary
              class="row-action"
              :loading="midiAnalysisRunning"
              :disabled="analysisBusy && !midiAnalysisRunning"
              @click.stop="requestMidiPGeneration"
            >
              <template #icon><NIcon><MusicalNotesOutline /></NIcon></template>
              GAME
            </NButton>
          </div>
          <div
            class="track-space midi-space"
            :style="{ width: `${timelineWidth}px` }"
            @click="selectMidiFrameFromPointer"
            @contextmenu="openMidiEditor"
          >
            <div
              v-for="tick in midiPitchTicks"
              :key="tick.classId"
              class="midi-pitch-line"
              :class="{ semitone: tick.semitone, octave: tick.octave }"
              :style="{ top: midiPitchTop(tick.classId) }"
            >
              <span v-if="tick.label">{{ tick.label }}</span>
            </div>
            <template v-if="midiReady">
              <div
                v-for="(midiClass, frame) in synthesis.midiPTokenTrack.classes"
                :key="frame"
                class="midi-cell"
                :class="{
                  rest: midiClassAt(frame, midiClass) === 255,
                  pad: midiClassAt(frame, midiClass) === 256,
                  flow: isMidiFlowFrame(frame),
                  manual: synthesis.midiPTokenTrack.manualFrames?.includes(frame),
                  dragging: midiDrag && (midiDrag.sourceFrame === frame || midiDrag.targetFrame === frame),
                  selected: selectedMidiFrame === frame,
                }"
                :style="midiCellStyle(frame, midiClass)"
                :title="midiCellTitle(frame, midiClass)"
                @click.stop="clickMidiFrame(frame, midiClass)"
                @pointerdown="beginMidiClassDrag($event, frame, midiClass)"
                @contextmenu="openMidiEditor($event, frame)"
              />
            </template>
          </div>
        </div>

        <div class="playhead" :style="{ left: `${132 + frameToDisplayX(playheadFrame)}px` }" />
      </div>

      <aside
        v-if="hTokenTooltip.show && hoveredHEntry"
        class="h-token-tooltip"
        :style="{ left: `${hTokenTooltip.x}px`, top: `${hTokenTooltip.y}px` }"
      >
        <div class="h-token-tooltip-heading">
          <strong>{{ hoveredHEntry.chineseName }}</strong>
          <code>{{ hoveredHEntry.token }}</code>
        </div>
        <p>{{ hoveredHEntry.explanation }}</p>
        <small>frame {{ hTokenTooltip.frame }} · ID {{ hoveredHEntry.id }} · {{ hoveredHEntry.editorVisibility }}</small>
        <small :class="hoveredHEntry.v5p40kSeen ? 'seen' : 'unseen'">
          V5-P 40K：{{ hoveredHEntry.trainingEvidence }}
        </small>
      </aside>
    </section>

    <aside class="editor-inspector">
      <template v-if="editorSelection?.type === 'guide'">
        <header class="inspector-header"><strong>Guide Audio</strong><span>Source · owned</span></header>
        <dl class="inspector-properties">
          <dt>时长</dt><dd>{{ formatTime(synthesis.guide.duration) }}</dd>
          <dt>采样率</dt><dd>{{ synthesis.guide.sampleRate }} Hz</dd>
          <dt>模型帧</dt><dd>{{ frameCount }}</dd>
          <dt>有效 samples</dt><dd>{{ synthesis.frameContract.modelSampleCount.toLocaleString() }}</dd>
        </dl>
        <div class="inspector-commands">
          <NButton size="small" secondary :disabled="analysisBusy" @click="transcribeSegmentTrack">转录 Segment</NButton>
          <NButton size="small" secondary :disabled="analysisBusy" @click="requestMidiPGeneration">生成 MIDI-P</NButton>
        </div>
      </template>

      <template v-else-if="editorSelection?.type === 'segment' && selectedSegment">
        <header class="inspector-header"><strong>Segment</strong><span>{{ selectedSegment.origin }}</span></header>
        <dl class="inspector-properties">
          <dt>Kana</dt><dd>{{ selectedSegment.kana || '-' }}</dd>
          <template v-if="uiSettings.settings.showRomaji"><dt>Romaji</dt><dd>{{ selectedSegment.romaji || '-' }}</dd></template>
          <dt>原文</dt><dd>{{ selectedSegment.text || '-' }}</dd>
          <dt>发声范围</dt><dd>{{ selectedSegment.startFrame }}..{{ selectedSegment.speechEndFrameExclusive - 1 }}</dd>
          <dt>H 控制范围</dt><dd>{{ selectedSegment.startFrame }}..{{ segmentOwnedEnd(selectedSegment.id) - 1 }}</dd>
          <dt>SEP</dt><dd>frame {{ segmentOwnedEnd(selectedSegment.id) - 1 }}</dd>
        </dl>
        <div class="inspector-commands">
          <NButton size="small" secondary @click="openSegmentEditor(selectedSegment.id)">编辑</NButton>
          <NButton size="small" secondary :disabled="analysisBusy" @click="alignSelectedSegment('kana')">对齐 Kana</NButton>
          <NButton size="small" secondary :disabled="analysisBusy" title="按当前 Kana 文本与边界重新运行 SOFA 硬边界对齐" @click="alignSelectedSegment('current-kana-h')">按当前 Kana 对齐 H</NButton>
        </div>
      </template>

      <template v-else-if="editorSelection?.type === 'kana' && selectedKana">
        <header class="inspector-header"><strong>Kana</strong><span>{{ selectedKana.origin }}</span></header>
        <dl class="inspector-properties">
          <dt>Kana</dt><dd>{{ selectedKana.kana }}</dd>
          <template v-if="uiSettings.settings.showRomaji"><dt>Romaji</dt><dd>{{ selectedKana.romaji || '-' }}</dd></template>
          <dt>Frame 范围</dt><dd>{{ selectedKana.startFrame }}..{{ selectedKana.endFrameExclusive - 1 }}</dd>
          <dt>时长</dt><dd>{{ formatTime(frameToAudioTime(selectedKana.endFrameExclusive - selectedKana.startFrame)) }}</dd>
          <dt>直接映射 H</dt>
          <dd>{{ selectedKanaDirectHTokens.length ? `${selectedKanaDirectHTokens.map(item => item.symbol).join(' ')} · ${selectedKanaDirectHTokens.map(item => item.tokenId).join(', ')}` : (selectedKana.kana ? '无法直接映射' : '-') }}</dd>
        </dl>
        <div class="inspector-commands">
          <NButton size="small" secondary @click="openKanaEditor(selectedKana.id)">编辑</NButton>
          <NButton size="small" secondary :disabled="analysisBusy" @click="alignSelectedKana">对齐 H</NButton>
        </div>
      </template>

      <template v-else-if="editorSelection?.type === 'h'">
        <header class="inspector-header"><strong>H Token · {{ selectedHEntry?.token ?? '0' }}</strong><span>frame {{ selectedHFrame }}</span></header>
        <dl class="inspector-properties">
          <dt>中文</dt><dd>{{ selectedHEntry?.chineseName ?? '空 frame / filler' }}</dd>
          <dt>说明</dt><dd>{{ selectedHEntry?.explanation ?? '本 frame 没有显式 H token 事件。' }}</dd>
          <dt>Token / ID</dt><dd>{{ selectedHEntry ? `${selectedHEntry.token} · ${selectedHEntry.id}` : '0 · filler' }}</dd>
          <dt>训练</dt><dd :class="{ seen: selectedHEntry?.v5p40kSeen, unseen: selectedHEntry && !selectedHEntry.v5p40kSeen }">{{ selectedHEntry?.trainingEvidence ?? '-' }}</dd>
          <dt>来源</dt><dd>{{ selectedHEvent?.origin ?? 'filler' }}</dd>
          <dt>Segment</dt><dd>{{ segmentAtFrame(selectedHFrame ?? 0)?.text || '-' }}</dd>
          <dt>Kana</dt><dd>{{ kanaAtFrame(selectedHFrame ?? 0)?.kana || '-' }}</dd>
        </dl>
        <div class="inspector-commands">
          <NButton size="small" secondary @click="openHTokenPickerAtFrame(selectedHFrame ?? 0)">替换 Token</NButton>
          <NButton size="small" secondary :disabled="!selectedHEvent" @click="clearSelectedHToken">清为 0</NButton>
          <NButton size="small" secondary @click="fillPulsesAfterFrame(selectedHFrame ?? 0)">PUL 刷</NButton>
          <NButton size="small" secondary @click="clearPulsesAfterFrame(selectedHFrame ?? 0)">清后续 PUL</NButton>
        </div>
      </template>

      <template v-else-if="editorSelection?.type === 'midi-p'">
        <header class="inspector-header"><strong>MIDI-P</strong><span>frame {{ selectedMidiFrame }}</span></header>
        <dl class="inspector-properties">
          <dt>Class</dt><dd>{{ selectedMidiClass ?? '-' }}</dd>
          <dt>音高</dt><dd>{{ selectedMidiClass == null ? '-' : midiPitchName(selectedMidiClass) }}</dd>
          <dt>MIDI</dt><dd>{{ selectedMidiClass == null || selectedMidiClass >= 255 ? '-' : (selectedMidiClass / 2).toFixed(1) }}</dd>
          <dt>类型</dt><dd>{{ selectedMidiIsFlow ? `FLOW → head frame ${midiFlowHeadFrame(selectedMidiFrame ?? 0)}` : '实体音高 token' }}</dd>
          <dt>来源</dt><dd>{{ selectedMidiFrame == null ? '-' : midiFrameOrigin(selectedMidiFrame) }}</dd>
          <dt>Segment</dt><dd>{{ segmentAtFrame(selectedMidiFrame ?? 0)?.text || '-' }}</dd>
        </dl>
        <div class="inspector-commands">
          <NButton size="small" secondary @click="openMidiEditorAtFrame(selectedMidiFrame ?? 0)">替换</NButton>
          <NButton size="small" secondary :disabled="selectedMidiClass == null" @click="setSelectedMidiRest">REST</NButton>
        </div>
      </template>

      <footer class="inspector-revisions">
        S r{{ synthesis.segmentTrack.revision }} · K r{{ synthesis.kanaTrack.revision }} · H r{{ synthesis.hTokenTrack.revision }} · M r{{ synthesis.midiPTokenTrack.revision }}
      </footer>
    </aside>
    </section>

    <audio ref="audioElement" :src="guideUrl" preload="auto" @ended="stopPlayback" />
    <audio ref="takeAudioElement" :src="takeUrl" preload="auto" @ended="stopPlayback" />
    <audio ref="referenceAudioElement" :src="referenceGuideUrl" preload="metadata" @ended="referencePlaying = false" />
    <HTokenPicker
      v-model:show="hPicker.show"
      :frame="hPicker.frame"
      :current-token-id="pickerCurrentTokenId"
      @select="chooseHToken"
      @pul-fill="fillPulsesAfterFrame(hPicker.frame)"
      @pul-clear="clearPulsesAfterFrame(hPicker.frame)"
    />
    <NDropdown
      trigger="manual"
      placement="bottom-start"
      :show="segmentMenu.show"
      :x="segmentMenu.x"
      :y="segmentMenu.y"
      :options="segmentMenuOptions"
      @select="chooseSegmentMenu"
      @clickoutside="segmentMenu.show = false"
    />
    <NDropdown
      trigger="manual"
      placement="bottom-start"
      :show="guideMenu.show"
      :x="guideMenu.x"
      :y="guideMenu.y"
      :options="guideMenuOptions"
      @select="chooseGuideMenu"
      @clickoutside="guideMenu.show = false"
    />
    <NDropdown
      trigger="manual"
      placement="bottom-start"
      :show="kanaMenu.show"
      :x="kanaMenu.x"
      :y="kanaMenu.y"
      :options="kanaMenuOptions"
      @select="chooseKanaMenu"
      @clickoutside="kanaMenu.show = false"
    />
    <NModal v-model:show="midiGenerationConfirm.show" preset="card" title="覆盖手工 MIDI-P" class="alignment-confirm-modal">
      <div class="alignment-confirm-content">
        <div class="overwrite-range">frame 0..{{ frameCount - 1 }}</div>
        <div>当前 MIDI-P 有 {{ midiGenerationConfirm.manualCount }} 个经过手工修改的 frame。</div>
        <div>GAME 将覆盖完整 MIDI-P 轨；Segment、Kana、H 和 Guide 保持不变。</div>
        <div class="modal-actions">
          <NButton @click="midiGenerationConfirm.show = false">取消</NButton>
          <NButton type="warning" @click="confirmMidiPGeneration">强制覆盖</NButton>
        </div>
      </div>
    </NModal>
    <NModal v-model:show="midiMoveConfirm.show" preset="card" title="移动并覆盖手工 MIDI-P" class="alignment-confirm-modal">
      <div class="alignment-confirm-content">
        <div class="overwrite-range">frame {{ midiMoveConfirm.sourceFrame }} -> {{ midiMoveConfirm.targetFrame }}</div>
        <div>目标 frame 已经有手工修改：{{ midiClassLabel(midiMoveConfirm.targetClass) }}。</div>
        <div>确认后目标接收新音高，源 frame 写为 REST；其他 MIDI-P frame 和 Text 轨保持不变。</div>
        <div class="modal-actions">
          <NButton @click="midiMoveConfirm.show = false">取消</NButton>
          <NButton type="warning" @click="confirmMidiMove">强制移动</NButton>
        </div>
      </div>
    </NModal>
    <NModal v-model:show="alignmentConfirm.show" preset="card" title="覆盖手工 Text Control" class="alignment-confirm-modal">
      <div class="alignment-confirm-content">
        <div class="overwrite-range">frame {{ alignmentConfirm.startFrame }}..{{ alignmentConfirm.endFrameExclusive - 1 }}</div>
        <div>当前范围有 {{ alignmentConfirm.objectCount }} 个对象，其中 {{ alignmentConfirm.manualCount }} 个经过手工修改。</div>
        <div>本次只覆盖 {{ alignmentConfirm.target === 'kana' ? 'KanaTrack' : alignmentConfirm.target === 'pul' ? 'HTokenTrack（PUL）' : 'HTokenTrack' }}；其他轨保持不变。</div>
        <div class="modal-actions">
          <NButton @click="alignmentConfirm.show = false">取消</NButton>
          <NButton type="warning" @click="confirmSegmentAlignment">强制覆盖</NButton>
        </div>
      </div>
    </NModal>
    <NModal v-model:show="kanaAlignmentConfirm.show" preset="card" title="覆盖手工 H Token" class="alignment-confirm-modal">
      <div class="alignment-confirm-content">
        <div class="overwrite-range">Kana {{ kanaAlignmentConfirm.kana }} · frame {{ kanaAlignmentConfirm.startFrame }}..{{ kanaAlignmentConfirm.endFrameExclusive - 1 }}</div>
        <div>当前范围有 {{ kanaAlignmentConfirm.objectCount }} 个 H 事件，其中 {{ kanaAlignmentConfirm.manualCount }} 个经过手工修改。</div>
        <div>本次只覆盖这个 Kana control range 的 HTokenTrack；Segment、Kana、MIDI-P 和其他 H frame 保持不变。</div>
        <div class="modal-actions">
          <NButton @click="kanaAlignmentConfirm.show = false">取消</NButton>
          <NButton type="warning" @click="confirmKanaAlignment">强制覆盖</NButton>
        </div>
      </div>
    </NModal>
    <NModal v-model:show="segmentEditor.show" preset="card" :title="segmentEditor.mode === 'create' ? '新建 Segment' : '编辑 Segment'" class="segment-editor-modal">
      <div class="segment-form">
        <label><span>原文</span><NInput v-model:value="segmentEditor.text" type="textarea" :autosize="{ minRows: 2, maxRows: 4 }" /></label>
        <label><span>Kana</span><NInput :value="segmentEditor.kana" @update:value="updateSegmentEditorKana" /></label>
        <label v-if="uiSettings.settings.showRomaji"><span>Romaji</span><NInput :value="segmentEditor.romaji" @update:value="updateSegmentEditorRomaji" /></label>
        <div class="frame-fields">
          <label><span>Start frame</span><NInputNumber v-model:value="segmentEditor.startFrame" :min="0" :max="frameCount - 1" /></label>
          <label><span>End frame</span><NInputNumber v-model:value="segmentEditor.speechEndFrameExclusive" :min="segmentEditor.startFrame + 1" :max="frameCount" /></label>
        </div>
        <div class="modal-actions">
          <NButton @click="segmentEditor.show = false">取消</NButton>
          <NButton type="primary" @click="saveSegmentEditor">{{ segmentEditor.mode === 'create' ? '创建 Segment' : '保存 Segment' }}</NButton>
        </div>
      </div>
    </NModal>
    <NModal v-model:show="midiLocal.show" preset="card" title="重提取本句 MIDI-P" class="local-midi-modal">
      <div class="local-midi-content">
        <div class="alignment-confirm-content">
          <div class="overwrite-range">
            {{ localMidiRange ? `frame ${localMidiRange.startFrame}..${localMidiRange.endFrameExclusive - 1}` : '未选择 Segment' }}
          </div>
          <div>只生成候选，不会立即覆盖当前 MIDI-P。</div>
        </div>
        <label class="local-midi-field"><span>提取器</span>
          <NRadioGroup v-model:value="midiLocal.extractor" size="small">
            <NRadioButton value="game">GAME</NRadioButton>
            <NRadioButton value="some">SOME</NRadioButton>
            <NRadioButton value="compare">对比</NRadioButton>
          </NRadioGroup>
        </label>
        <div class="local-midi-grid">
          <label><span>GAME 边界阈值</span><small>越低越容易接受新的音符边界。</small><NInputNumber v-model:value="midiLocal.boundaryThreshold" :min="0.01" :max="0.99" :step="0.05" /></label>
          <label><span>GAME 边界半径</span><small>检查边界附近多少帧；越大越不容易出现相邻边界。</small><NInputNumber v-model:value="midiLocal.boundaryRadius" :min="1" :max="12" /></label>
          <label><span>GAME presence 阈值</span><small>判断有声还是 REST；越低越不容易判成 REST。</small><NInputNumber v-model:value="midiLocal.presenceThreshold" :min="0.01" :max="0.99" :step="0.05" /></label>
          <label><span>GAME 采样步数</span><small>模型迭代次数；越高通常越慢，结果可能更稳定。</small><NSelect v-model:value="midiLocal.nsteps" :options="[{ label: '4 · 训练默认', value: 4 }, { label: '8', value: 8 }, { label: '16', value: 16 }]" /></label>
          <label><span>GAME 随机 Seed</span><small>相同音频和参数下复现结果；留空使用稳定默认值。</small><NInputNumber v-model:value="midiLocal.seed" :min="0" :max="4294967295" placeholder="自动" /></label>
          <label><span>SOME 边界偏置</span><small>整体调整切分敏感度；越高越容易产生音符边界。</small><NInputNumber v-model:value="midiLocal.boundaryBias" :min="-4" :max="4" :step="0.25" /></label>
          <label><span>SOME REST 阈值</span><small>模型的有声置信度低于此值会判为 REST；越高越容易判成 REST。</small><NInputNumber v-model:value="midiLocal.restThreshold" :min="0.01" :max="0.99" :step="0.05" /></label>
          <label><span>SOME 最短音符（frame）</span><small>短于此长度的音符会并入前一个音符；20 frame 约 1 秒。</small><NInputNumber v-model:value="midiLocal.minNoteFrames" :min="1" :max="20" /></label>
          <label><span>前后文（frame）</span><small>额外读取句子两侧的音频，只帮助判断边界，不会覆盖句外 MIDI-P。</small><NInputNumber v-model:value="midiLocal.contextFrames" :min="0" :max="30" /></label>
        </div>
        <div v-if="midiLocal.game || midiLocal.some" class="local-midi-candidates">
          <div class="candidate-help">
            <strong>候选预览</strong>
            <span>点击试听按钮会从本句起点播放，到本句末尾自动停止；候选不会自动写入当前 MIDI-P。</span>
          </div>
          <div class="candidate-tabs">
            <NButton size="small" :type="midiLocal.audition === 'current' && playing ? 'primary' : 'default'" @click="auditionLocalMidiCandidate('current')">
              <template #icon><NIcon><Play /></NIcon></template>试听当前
            </NButton>
            <NButton v-if="midiLocal.game" size="small" :type="midiLocal.audition === 'game' && playing ? 'primary' : 'default'" @click="auditionLocalMidiCandidate('game')">
              <template #icon><NIcon><Play /></NIcon></template>试听 GAME
            </NButton>
            <NButton v-if="midiLocal.some" size="small" :type="midiLocal.audition === 'some' && playing ? 'primary' : 'default'" @click="auditionLocalMidiCandidate('some')">
              <template #icon><NIcon><Play /></NIcon></template>试听 SOME
            </NButton>
            <NButton size="small" secondary :disabled="!playing" @click="stopLocalMidiAudition">
              <template #icon><NIcon><Stop /></NIcon></template>停止试听
            </NButton>
          </div>
          <div class="candidate-summary">
            <span>GAME {{ midiLocal.game ? `${midiLocal.game.classes.filter(value => value < 255).length} voiced frames` : '未生成' }}</span>
            <span>SOME {{ midiLocal.some ? `${midiLocal.some.classes.filter(value => value < 255).length} voiced frames` : '未生成' }}</span>
          </div>
          <div class="modal-actions">
            <NButton v-if="midiLocal.game" @click="applyLocalMidiCandidate('game')">应用 GAME 到本句</NButton>
            <NButton v-if="midiLocal.some" type="primary" @click="applyLocalMidiCandidate('some')">应用 SOME 到本句</NButton>
          </div>
        </div>
        <div v-if="midiLocal.running" class="local-midi-progress">
          <div class="analysis-progress-track"><div class="analysis-progress-bar" :style="{ width: `${midiLocal.progress}%` }" /></div>
          <span>{{ Math.round(midiLocal.progress) }}% · {{ midiLocal.message }}</span>
        </div>
        <div v-else-if="midiLocal.message" class="local-midi-message">{{ midiLocal.message }}</div>
        <div class="modal-actions">
          <NButton @click="midiLocal.show = false">关闭</NButton>
          <NButton type="primary" :loading="midiLocal.running" @click="runSelectedLocalMidiExtraction">重新提取</NButton>
        </div>
      </div>
    </NModal>
    <NModal v-model:show="kanaEditor.show" preset="card" title="编辑 Kana" class="kana-editor-modal">
      <div class="segment-form">
        <label><span>Kana / Mora</span><NInput :value="kanaEditor.kana" @update:value="updateKanaEditorKana" /></label>
        <label v-if="uiSettings.settings.showRomaji"><span>Romaji</span><NInput :value="kanaEditor.romaji" @update:value="updateKanaEditorRomaji" /></label>
        <div class="modal-actions">
          <NButton @click="kanaEditor.show = false">取消</NButton>
          <NButton type="primary" @click="saveKanaEditor">保存 Kana</NButton>
        </div>
      </div>
    </NModal>
    <NModal v-model:show="midiEditor.show" preset="card" title="替换 MIDI-P" class="midi-editor-modal">
      <div class="midi-editor-form">
        <div class="midi-editor-readout">
          <span>frame {{ midiEditor.frame }}</span>
          <strong>{{ midiEditorLabel }}</strong>
        </div>
        <NInputNumber
          :value="midiEditor.midiClass"
          :min="0"
          :max="255"
          :step="1"
          :disabled="midiEditor.asFlow"
          @update:value="setMidiEditorClass"
        />
        <div class="midi-stepper">
          <NButton circle secondary title="降低 0.5 半音" @click="adjustMidiEditor(-1)">
            <template #icon><NIcon><Remove /></NIcon></template>
          </NButton>
          <NButton circle secondary title="升高 0.5 半音" @click="adjustMidiEditor(1)">
            <template #icon><NIcon><Add /></NIcon></template>
          </NButton>
          <NButton
            secondary
            :type="midiEditor.asFlow ? 'primary' : 'default'"
            :title="midiEditor.asFlow ? '取消 FLOW，保留当前音高' : '继承前一个 MIDI-P token 的音高；只存在于编辑器'"
            @click="setMidiEditorFlow"
          >FLOW</NButton>
          <NButton secondary @click="setMidiEditorRest">REST</NButton>
        </div>
        <div class="modal-actions">
          <NButton @click="midiEditor.show = false">取消</NButton>
          <NButton type="primary" @click="saveMidiEditor">强制替换</NButton>
        </div>
      </div>
    </NModal>
    <NModal :show="capacityDialog !== null" preset="card" title="显存容量检查" class="capacity-modal" @update:show="closeCapacityDialog">
      <div v-if="capacityDialog" class="capacity-content">
        <div class="capacity-summary">
          <span>需要约 {{ (capacityDialog.requiredMiB / 1024).toFixed(1) }} GB</span>
          <span>当前可用 {{ (capacityDialog.freeMiB / 1024).toFixed(1) }} GB</span>
          <span>估算来自 {{ capacityDialog.estimate.sampleSeconds }}s / {{ capacityDialog.estimate.steps ?? 1 }}步标定</span>
          <span v-if="capacityDialog.estimate.guidanceMode === 'three-way'">三路 CFG 顺序执行四个条件分支，预计约 {{ capacityDialog.estimate.estimatedTimeFactor ?? 2 }}× 耗时</span>
        </div>
        <div v-if="capacityDialog.insufficient" class="capacity-insufficient">您的显存实在不足。</div>
        <div v-else-if="capacityDialog.evictions.length > 0" class="capacity-evictions">
          共需释放以下模型：{{ capacityDialog.evictions.map(item => item.modelId).join('、') }}
        </div>
        <div v-else class="capacity-evictions">没有可删除的其他常驻模型。</div>
        <div class="modal-actions">
          <NButton v-if="!capacityDialog.insufficient" @click="closeCapacityDialog">取消运行</NButton>
          <NButton v-if="!capacityDialog.insufficient" type="warning" @click="evictFromCapacityDialog">删除最久未使用</NButton>
          <NButton type="error" ghost @click="forceRunFromCapacityDialog">强制运行</NButton>
          <NButton v-if="capacityDialog.insufficient" @click="closeCapacityDialog">放弃运行</NButton>
        </div>
      </div>
    </NModal>
    <NModal v-model:show="blockingError.show" preset="card" :title="blockingError.title" class="blocking-error-modal">
      <div class="blocking-error-content">
        <div class="blocking-error-message">{{ blockingError.message }}</div>
        <div class="modal-actions">
          <NButton type="primary" @click="blockingError.show = false">知道了</NButton>
        </div>
      </div>
    </NModal>
  </main>
  <div v-else class="missing-unit">合成单元不存在或已被删除</div>
</template>

<style scoped>
.synthesis-editor {
  --synth-surface: color-mix(in srgb, var(--app-surface) var(--center-opacity-percent), transparent);
  --synth-panel: color-mix(in srgb, var(--app-panel) var(--center-opacity-percent), transparent);
  --synth-floating: color-mix(in srgb, var(--app-elevated) var(--floating-opacity-percent), transparent);
  --synth-grid-line: color-mix(in srgb, var(--app-border) 72%, transparent);
  --synth-grid-major: color-mix(in srgb, var(--app-muted) 52%, transparent);
  flex: 1;
  min-width: 0;
  min-height: 0;
  display: flex;
  flex-direction: column;
  background: var(--synth-surface);
  color: var(--app-text);
  backdrop-filter: var(--center-backdrop-filter);
  letter-spacing: 0;
  container-type: inline-size;
}

.editor-toolbar {
  flex: 0 0 44px;
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 0 12px;
  border-bottom: 1px solid var(--app-border);
  background: var(--synth-panel);
}

.transport,
.zoom-control,
.unit-summary,
.unit-identity {
  display: flex;
  align-items: center;
}

.transport { gap: 2px; }
.time-readout { min-width: 126px; margin-left: 6px; color: var(--app-muted); font: 11px ui-monospace, SFMono-Regular, Consolas, monospace; }
.zoom-control { width: 190px; gap: 8px; color: var(--app-muted); font-size: 11px; }
.zoom-control :deep(.n-slider) { flex: 1; }
.speed-control { width: 156px; display: flex; align-items: center; gap: 8px; color: var(--app-muted); font-size: 11px; }
.speed-control :deep(.n-slider) { flex: 1; }
.toolbar-spacer { flex: 1; }

.reference-strip {
  flex: 0 0 46px;
  display: flex;
  align-items: center;
  gap: 8px;
  min-width: 0;
  padding: 0 12px;
  border-bottom: 1px solid var(--app-border);
  background: var(--synth-panel);
  transition: background-color 120ms ease, box-shadow 120ms ease;
}
.reference-strip.active {
  background: color-mix(in srgb, var(--app-selected) var(--center-opacity-percent), transparent);
  box-shadow: inset 0 0 0 1px var(--app-accent);
}
.reference-heading {
  flex: 0 0 170px;
  display: grid;
  grid-template-columns: 18px auto;
  align-items: center;
  column-gap: 7px;
  color: var(--app-text);
  font-size: 11px;
}
.reference-heading small {
  grid-column: 2;
  color: var(--app-muted);
  font-size: 9px;
}
.reference-main {
  width: clamp(240px, 34vw, 460px);
  min-width: 0;
  display: grid;
  gap: 2px;
  padding: 3px 7px;
  border: 0;
  border-left: 2px solid var(--app-accent);
  background: transparent;
  color: var(--app-text);
  text-align: left;
  cursor: pointer;
}
.reference-main:hover { background: var(--app-hover); }
.reference-main.invalid { border-left-color: #d28b68; cursor: default; }
.reference-main strong,
.reference-main span {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.reference-main strong { font-size: 11px; }
.reference-main span { color: var(--app-muted); font: 9px ui-monospace, SFMono-Regular, Consolas, monospace; }
.reference-state {
  margin-left: auto;
  color: var(--app-accent);
  font-size: 10px;
  white-space: nowrap;
}
.reference-empty-state {
  flex: 1;
  color: var(--app-muted);
  font-size: 10px;
}
:global(.sampling-popover.n-popover) { padding: 0; border-radius: 6px; background: var(--app-elevated); }
.sampling-panel { width: 430px; display: grid; gap: 12px; padding: 14px; color: var(--app-text); font-size: 11px; }
.sampling-panel header { display: grid; gap: 2px; }
.sampling-panel header strong { color: var(--app-text); font-size: 12px; }
.sampling-panel header span { color: var(--app-muted); font-size: 10px; }
.sampling-mode { display: grid; gap: 6px; color: var(--app-muted); }
.sampling-fields { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 10px; }
.sampling-fields label { display: grid; gap: 5px; align-content: start; color: var(--app-text); }
.sampling-fields label small { min-height: 30px; color: var(--app-muted); font-size: 10px; line-height: 1.45; }
.sampling-fields.three-way-fields { grid-template-columns: repeat(3, minmax(0, 1fr)); }
.sampling-fields.three-way-fields p { grid-column: 1 / -1; margin: 0; color: var(--app-warning); font-size: 10px; line-height: 1.5; }
.sampling-common { padding-top: 10px; border-top: 1px solid var(--app-border); }
.sampling-training { padding: 7px 8px; border-left: 2px solid var(--app-accent); background: var(--app-surface); color: var(--app-muted); font: 10px ui-monospace, SFMono-Regular, Consolas, monospace; }
.unit-model-picker {
  flex: 0 0 148px;
  min-width: 0;
}
.unit-model-picker :deep(.n-select) { width: 100%; }

.unit-summary {
  flex: 0 0 34px;
  gap: 18px;
  padding: 0 14px;
  border-bottom: 1px solid var(--app-border);
  background: var(--synth-panel);
  color: var(--app-muted);
  font-size: 11px;
  overflow: hidden;
  white-space: nowrap;
}

.unit-summary > span { flex: 0 0 auto; }
.unit-identity { flex: 1 1 260px; min-width: 120px; gap: 8px; color: var(--app-text); overflow: hidden; }
.unit-identity strong { font-size: 12px; }
.unit-identity strong { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.unit-identity span { color: var(--app-accent); }
.warning { color: var(--app-warning); }
.hash { margin-left: auto; font-family: ui-monospace, SFMono-Regular, Consolas, monospace; }
.status-notice,
.token-readout { min-width: 0; margin-left: auto; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.status-notice { color: var(--app-accent); }
.token-readout { color: #c7b7dc; }

.take-strip {
  flex: 0 0 42px;
  display: flex;
  align-items: center;
  gap: 6px;
  min-width: 0;
  padding: 0 10px 0 14px;
  border-bottom: 1px solid var(--app-border);
  background: var(--synth-panel);
}
.take-heading {
  flex: 0 0 92px;
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  color: var(--app-text);
  font-size: 10px;
  font-weight: 700;
  text-transform: uppercase;
}
.take-heading small { color: var(--app-muted); font-size: 9px; }
.take-prerequisite-hint {
  flex: 0 1 auto;
  min-width: 0;
  max-width: 260px;
  overflow: hidden;
  color: var(--app-warning);
  font-size: 10px;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.take-list {
  flex: 1;
  min-width: 0;
  display: flex;
  gap: 4px;
  overflow-x: auto;
  scrollbar-width: thin;
  scrollbar-color: var(--app-border) transparent;
}
.take-list::-webkit-scrollbar { height: 5px; }
.take-list::-webkit-scrollbar-track { background: transparent; }
.take-list::-webkit-scrollbar-thumb { border-radius: 3px; background: var(--app-border); }
.take-list::-webkit-scrollbar-thumb:hover { background: var(--app-muted); }
.take-item {
  flex: 0 0 108px;
  height: 28px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 6px;
  padding: 0 7px;
  border: 1px solid var(--app-border);
  border-radius: 3px;
  background: var(--synth-panel);
  color: var(--app-text);
  cursor: pointer;
}
.take-item strong { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 10px; }
.take-item span { color: var(--app-muted); font: 9px ui-monospace, SFMono-Regular, Consolas, monospace; }
.take-item.active { border-color: var(--app-accent); background: var(--app-selected); color: var(--app-text); }
.take-item.failed { border-color: #805467; color: #d9a7b8; }
.take-item[aria-disabled="true"] { cursor: text; opacity: 0.75; }
.take-name-input {
  flex: 0 0 108px;
  box-sizing: border-box;
  width: 108px;
  height: 28px;
  min-width: 0;
  padding: 0 7px;
  border: 1px solid var(--app-accent);
  border-radius: 3px;
  outline: none;
  background: var(--synth-panel);
  color: var(--app-text);
  font: inherit;
  font-size: 10px;
}

.editor-workspace {
  flex: 1;
  min-height: 0;
  min-width: 0;
  display: flex;
}
.timeline-scroll {
  flex: 1 1 auto;
  min-height: 0;
  min-width: 0;
  overflow: auto;
  overscroll-behavior: contain;
  background: var(--synth-surface);
  scrollbar-gutter: stable;
}
.editor-inspector {
  flex: 0 0 292px;
  min-width: 0;
  display: flex;
  flex-direction: column;
  overflow: auto;
  border-left: 1px solid var(--app-border);
  background: var(--synth-panel);
}
.inspector-header {
  display: grid;
  gap: 3px;
  padding: 14px 14px 12px;
  border-bottom: 1px solid var(--app-border);
}
.inspector-header strong { color: var(--app-text); font-size: 13px; }
.inspector-header span { color: var(--app-muted); font: 10px ui-monospace, SFMono-Regular, Consolas, monospace; }
.inspector-properties {
  display: grid;
  grid-template-columns: 76px minmax(0, 1fr);
  gap: 9px 10px;
  margin: 0;
  padding: 14px;
  font-size: 11px;
}
.inspector-properties dt { color: var(--app-muted); }
.inspector-properties dd { min-width: 0; margin: 0; color: var(--app-text); overflow-wrap: anywhere; line-height: 1.45; }
.inspector-properties dd.seen { color: var(--app-success); }
.inspector-properties dd.unseen { color: var(--app-warning); }
.inspector-commands { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 6px; padding: 0 14px 14px; }
.inspector-commands :deep(.n-button) { min-width: 0; }
.inspector-revisions { margin-top: auto; padding: 10px 14px; border-top: 1px solid var(--app-border); color: var(--app-muted); font: 9px ui-monospace, SFMono-Regular, Consolas, monospace; }

.timeline-content { min-height: 100%; position: relative; }
.timeline-row { display: grid; grid-template-columns: 132px auto; position: relative; border-bottom: 1px solid var(--app-border); }
.track-label {
  position: sticky;
  left: 0;
  z-index: 8;
  padding: 0 10px;
  background: var(--synth-panel);
  border-right: 1px solid var(--app-border);
  display: flex;
  align-items: center;
  justify-content: space-between;
  font-size: 11px;
  color: var(--app-text);
}
.control-label {
  display: grid;
  grid-template-columns: 1fr auto;
  grid-template-rows: auto auto;
  align-content: center;
  gap: 3px 8px;
}
.control-label span,
.control-label small {
  grid-column: 1;
}
.control-label .row-action {
  grid-column: 2;
  grid-row: 1 / span 2;
  align-self: center;
  justify-self: end;
  min-width: 52px;
}
.row-actions {
  grid-column: 2;
  grid-row: 1 / span 2;
  display: flex;
  flex-direction: column;
  align-items: stretch;
  gap: 2px;
}
.row-actions .row-action { min-width: 48px; }
.kana-action { grid-column: 2; grid-row: 1 / span 2; min-width: 28px; }
.track-label small { color: var(--app-muted); font-size: 9px; }
.track-space { grid-column: 2; position: relative; overflow: hidden; }
.grid-space,
.midi-space {
  background-color: var(--synth-surface);
  background-image: repeating-linear-gradient(90deg, var(--synth-grid-line) 0, var(--synth-grid-line) 1px, transparent 1px, transparent var(--grid-size, 14px));
  background-size: var(--grid-size, 14px) 100%;
  background-repeat: repeat-x;
}

.ruler-row { height: 30px; position: sticky; top: 0; z-index: 12; }
.ruler-label { background: var(--synth-panel); color: var(--app-muted); }
.ruler { background: var(--synth-panel); cursor: pointer; }
.frame-tick { position: absolute; top: 17px; bottom: 0; border-left: 1px solid var(--synth-grid-line); }
.frame-tick.major { top: 10px; border-left-color: var(--synth-grid-major); }
.frame-tick span { position: absolute; top: -9px; left: 3px; color: var(--app-muted); font: 9px ui-monospace, SFMono-Regular, Consolas, monospace; }

.group-band {
  position: sticky;
  left: 0;
  z-index: 9;
  width: 132px;
  height: 22px;
  box-sizing: border-box;
  padding: 4px 10px;
  border-right: 1px solid var(--app-border);
  border-bottom: 1px solid var(--app-border);
  background: var(--synth-surface);
  color: var(--app-accent);
  font-size: 9px;
  font-weight: 700;
  text-transform: uppercase;
}

.guide-row { height: 72px; }
.guide-space { cursor: pointer; background: var(--synth-panel); }
.guide-space.selected { box-shadow: inset 0 0 0 1px #f0c45c; }
.guide-space canvas { height: 72px; display: block; }
.segment-row { height: 60px; }
.kana-row { height: 52px; }
.h-row { height: 52px; }
.midi-row { height: 660px; }

.segment-object,
.kana-object {
  position: absolute;
  top: 9px;
  bottom: 9px;
  min-width: 2px;
  overflow: hidden;
  border: 1px solid #4b83a6;
  border-radius: 3px;
  background: #1d3545;
  color: #eef6fb;
  padding: 4px 6px;
  box-sizing: border-box;
  white-space: nowrap;
}
.segment-object strong,
.segment-object span { display: block; overflow: hidden; text-overflow: ellipsis; }
.segment-object strong { font-size: 11px; }
.segment-object span { color: #9ab0bf; font-size: 9px; }
.segment-object .lyric-status { position: absolute; bottom: 3px; right: 8px; font-size: 12px; color: #a0dfc3; }
.segment-object[data-lyric-status] > span { padding-right: 14px; }
.segment-object[data-lyric-status="需复核"],
.segment-object[data-lyric-status="发音控制待更新"] { border-bottom-color: #d6a94d; }
.segment-object[data-lyric-status="已应用"] { border-bottom-color: #62bca0; }
.segment-actions {
  position: absolute;
  top: 3px;
  right: 8px;
  width: 22px;
  height: 22px;
  display: grid;
  place-items: center;
  padding: 0;
  border: 0;
  background: rgba(14, 26, 35, 0.72);
  color: #b8c7d2;
  cursor: pointer;
}
.segment-actions:hover { background: #31556b; color: #fff; }
.segment-object.selected,
.kana-object.selected { border-color: #f0c45c; box-shadow: 0 0 0 1px rgba(240, 196, 92, 0.35); }
.boundary-handle { position: absolute; top: 0; bottom: 0; width: 7px; padding: 0; border: 0; background: transparent; cursor: ew-resize; }
.boundary-handle.start { left: 0; border-left: 2px solid #79b3d5; }
.boundary-handle.end { right: 0; border-right: 2px solid #79b3d5; }
.boundary-handle:hover { background: rgba(121, 179, 213, 0.2); }
.kana-boundary { border-right-color: #c3a2eb; }
.kana-boundary.start { border-right: 0; border-left: 2px solid #c3a2eb; }
.kana-object { top: 8px; bottom: 8px; display: flex; gap: 5px; align-items: center; border-color: #8f72b8; background: #322746; color: #f3ebfb; cursor: grab; }
.kana-object:active { cursor: grabbing; }
.kana-object strong { font-size: 12px; }
.kana-object span { color: #b8a9cc; font-size: 9px; }
.kana-seg {
  position: absolute;
  top: 8px;
  bottom: 8px;
  z-index: 4;
  min-width: 2px;
  overflow: hidden;
  border: 1px solid #d2a85b;
  background: #51401f;
  color: #f4d88e;
  font-size: 8px;
  line-height: 34px;
  text-align: center;
  cursor: grab;
  user-select: none;
}
.kana-seg:active { cursor: grabbing; }

.h-event {
  position: absolute;
  top: 13px;
  min-width: 0;
  height: 24px;
  padding: 0 2px;
  box-sizing: border-box;
  border: 1px solid #d0778f;
  border-radius: 3px;
  background: #482634;
  color: #ffd3de;
  font: 10px/22px ui-monospace, SFMono-Regular, Consolas, monospace;
  text-align: center;
  overflow: hidden;
  text-overflow: clip;
  white-space: nowrap;
}
.h-selection { position: absolute; top: 0; bottom: 0; z-index: 1; border: 1px solid rgba(240, 196, 92, 0.8); background: rgba(240, 196, 92, 0.13); pointer-events: none; }
.h-event { z-index: 2; }
.h-event.selected { border-color: #f0c45c; box-shadow: 0 0 0 1px rgba(240, 196, 92, 0.4); }
.h-event.special { border-color: #d2a85b; background: #45391f; color: #f4d48c; }
.h-event.dragging { z-index: 5; border-color: var(--app-accent); background: color-mix(in srgb, var(--app-accent) 24%, var(--app-panel)); cursor: grabbing; }
.h-token-tooltip {
  position: fixed;
  z-index: 30;
  width: 276px;
  padding: 10px 12px;
  border: 1px solid var(--app-border);
  border-radius: 4px;
  background: var(--synth-floating);
  backdrop-filter: var(--center-backdrop-filter);
  box-shadow: 0 8px 24px rgba(0, 0, 0, 0.38);
  pointer-events: none;
}
.h-token-tooltip-heading { display: flex; align-items: baseline; justify-content: space-between; gap: 10px; }
.h-token-tooltip-heading strong { color: var(--app-text); font-size: 12px; }
.h-token-tooltip-heading code { color: var(--app-accent); font: 15px ui-monospace, SFMono-Regular, Consolas, monospace; }
.h-token-tooltip p { margin: 7px 0; color: var(--app-text); font-size: 11px; line-height: 1.5; }
.h-token-tooltip small { display: block; margin-top: 3px; color: var(--app-muted); font: 10px ui-monospace, SFMono-Regular, Consolas, monospace; }
.h-token-tooltip .seen { color: var(--app-success); }
.h-token-tooltip .unseen { color: var(--app-warning); }

.midi-cell { position: absolute; box-sizing: border-box; border-right: 1px solid #11161b; background: #4a91ad; cursor: move; }
.midi-cell.flow { background: #9a6fab; cursor: context-menu; }
.midi-cell.rest { background: #4c5662; cursor: context-menu; }
.midi-cell.pad { background: #8e5665; cursor: not-allowed; }
.midi-cell.manual { outline: 1px solid #f0c45c; outline-offset: -1px; }
.midi-cell.dragging { z-index: 5; background: var(--app-accent); }
.midi-cell.selected { outline: 1px solid #f0c45c; outline-offset: -1px; box-shadow: inset 0 0 0 1px rgba(240, 196, 92, 0.45); }
.midi-pitch-line {
  position: absolute;
  left: 0;
  right: 0;
  height: 1px;
  border-top: 1px solid color-mix(in srgb, var(--app-border) 42%, transparent);
  pointer-events: none;
  z-index: 1;
}
.midi-pitch-line.semitone { border-top-color: color-mix(in srgb, var(--app-border) 68%, transparent); }
.midi-pitch-line.octave { border-top-color: color-mix(in srgb, var(--app-muted) 72%, transparent); }
.midi-pitch-line span {
  position: absolute;
  left: 5px;
  top: -11px;
  padding: 1px 3px;
  border-radius: 2px;
  background: var(--synth-floating);
  color: var(--app-text);
  font: 10px ui-monospace, SFMono-Regular, Consolas, monospace;
}
.midi-cell { z-index: 2; }

.empty-track { position: absolute; left: 12px; top: 50%; transform: translateY(-50%); color: var(--app-muted); font-size: 10px; }
.analysis-progress {
  position: absolute;
  left: 12px;
  right: 12px;
  bottom: 6px;
  display: grid;
  gap: 4px;
  pointer-events: none;
}
.analysis-progress-track {
  height: 4px;
  border-radius: 999px;
  background: var(--app-border);
  overflow: hidden;
}
.analysis-progress-bar {
  height: 100%;
  background: linear-gradient(90deg, var(--app-accent), var(--app-success));
  transition: width 0.14s ease;
}
.analysis-progress-bar.midi {
  background: linear-gradient(90deg, #79c0ff, #f0c45c);
}
.analysis-progress-top {
  flex: 0 0 34px;
  display: flex;
  align-items: center;
  gap: 10px;
  min-width: 0;
  padding: 0 14px;
  border-bottom: 1px solid var(--app-border);
  background: var(--synth-panel);
}
.analysis-progress-top .analysis-progress-track {
  flex: 1;
  height: 8px;
  background: var(--app-border);
}
.analysis-progress-top .analysis-progress-bar {
  background: linear-gradient(90deg, #79c0ff, #f0c45c);
}
.analysis-progress-top span {
  flex: 0 0 auto;
  max-width: 56vw;
  color: #f0d48c;
  font-size: 11px;
  font-weight: 600;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.analysis-progress span {
  color: var(--app-muted);
  font-size: 9px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.playhead { position: absolute; top: 0; bottom: 0; width: 1px; z-index: 7; background: #f0c45c; pointer-events: none; }
audio { display: none; }
.missing-unit { flex: 1; display: grid; place-items: center; color: var(--app-muted); background: var(--synth-surface); }

:global(.segment-editor-modal.n-card) { width: min(560px, calc(100vw - 48px)); border-radius: 6px; background: var(--app-elevated); }
:global(.kana-editor-modal.n-card) { width: 420px; border-radius: 6px; background: var(--app-elevated); }
:global(.midi-editor-modal.n-card) { width: 400px; border-radius: 6px; background: var(--app-elevated); }
:global(.capacity-modal.n-card) { width: min(460px, calc(100vw - 48px)); border-radius: 6px; background: var(--app-elevated); }
:global(.capacity-modal .n-card__content) { padding: 14px; }
:global(.local-midi-modal.n-card) { width: min(620px, calc(100vw - 48px)); border-radius: 6px; background: var(--app-elevated); }
.midi-editor-form { display: grid; gap: 14px; }
.midi-editor-readout { display: flex; justify-content: space-between; align-items: baseline; color: var(--app-muted); font-size: 11px; }
.midi-editor-readout strong { color: var(--app-text); font: 13px ui-monospace, SFMono-Regular, Consolas, monospace; }
.midi-stepper { display: flex; gap: 8px; align-items: center; }
:global(.alignment-confirm-modal.n-card) { width: 440px; border-radius: 6px; background: var(--app-elevated); }
.alignment-confirm-content { display: grid; gap: 10px; color: var(--app-text); font-size: 12px; }
.overwrite-range { color: var(--app-warning); font: 12px ui-monospace, SFMono-Regular, Consolas, monospace; }
.segment-form { display: grid; gap: 12px; }
.segment-form label { display: grid; gap: 5px; color: var(--app-muted); font-size: 11px; }
.frame-fields { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; }
.modal-actions { display: flex; justify-content: flex-end; gap: 8px; padding-top: 4px; }
.capacity-content { display: grid; gap: 12px; color: var(--app-text); font-size: 12px; }
.capacity-summary { display: grid; grid-template-columns: 1fr; gap: 8px; }
.capacity-summary span { padding: 8px; border: 1px solid color-mix(in srgb, var(--app-border) 70%, transparent); border-radius: 4px; }
.capacity-insufficient { color: var(--app-danger); }
.capacity-evictions { color: var(--app-warning); overflow-wrap: anywhere; }
.blocking-error-content { display: grid; gap: 16px; color: var(--app-text); }
.blocking-error-message {
  padding: 12px;
  border-left: 3px solid #e06c75;
  background: color-mix(in srgb, #e06c75 10%, transparent);
  color: var(--app-danger);
  line-height: 1.6;
  white-space: pre-wrap;
  overflow-wrap: anywhere;
}
:global(.blocking-error-modal.n-card) { width: min(520px, calc(100vw - 48px)); }
.local-midi-content { display: grid; gap: 14px; color: var(--app-text); font-size: 12px; }
.local-midi-field { display: grid; gap: 6px; color: var(--app-muted); font-size: 11px; }
.local-midi-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 10px; }
.local-midi-grid label { display: grid; gap: 5px; align-content: start; color: var(--app-muted); font-size: 11px; }
.local-midi-grid label small { min-height: 30px; color: var(--app-muted); font-size: 10px; line-height: 1.45; }
.local-midi-candidates { display: grid; gap: 9px; padding: 10px; border: 1px solid var(--app-border); border-radius: 4px; background: var(--app-surface); }
.candidate-tabs { display: flex; gap: 6px; }
.candidate-help { display: grid; gap: 3px; color: var(--app-text); font-size: 11px; line-height: 1.5; }
.candidate-help strong { color: var(--app-text); font-size: 12px; }
.candidate-summary { display: flex; gap: 14px; color: var(--app-muted); font: 10px ui-monospace, SFMono-Regular, Consolas, monospace; }
.local-midi-progress { display: grid; gap: 5px; }
.local-midi-progress span,
.local-midi-message { color: var(--app-warning); font-size: 11px; }

@container (max-width: 760px) {
  .unit-summary { gap: 12px; }
  .hash { display: none; }
  .zoom-control,
  .speed-control { display: none; }
  .reference-heading { flex-basis: 94px; }
  .reference-heading small,
  .reference-state { display: none; }
  .reference-main { flex: 1; width: auto; min-width: 72px; }
}

@container (max-width: 620px) {
  .warning { display: none; }
  .time-readout { min-width: 92px; }
}
</style>
