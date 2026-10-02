<script setup lang="ts">
import { computed, nextTick, onActivated, onBeforeUnmount, onDeactivated, onMounted, ref, watch } from 'vue'
import { NButton, NIcon, NInput, NModal, NSelect } from 'naive-ui'
import { BookOutline, CheckmarkOutline, ChevronBack, ChevronForward, CloseOutline, ExpandOutline, ListOutline, PlayOutline, SearchOutline } from '@vicons/ionicons5'
import { useObjectTreeStore } from '@/stores/objectTree'
import { useHistoryStore } from '@/stores/history'
import { useUiSettingsStore } from '@/stores/uiSettings'
import { kanaToRomaji } from '@/utils/kanaRomaji'
import LyricReferenceText from './LyricReferenceText.vue'
import type { SynthesisSegmentObject } from '@/object-workbench'
import {
  absoluteSegmentRange, applyLyricDrafts, confirmedLyricRanges, confirmLyricPosition, draftIsCurrent, findLyricCandidates, getUnitInstances,
  lyricStatus, readingForRange, segmentFingerprint,
  type LyricCandidate, type LyricDraft, type LyricRange, type LyricReference, type ReadingToken,
} from '@/object-workbench/lyricProofreading'

const props = defineProps<{
  unitId: string
  selectedId: string
  busy: boolean
  playing: boolean
  anchor: () => DOMRect | undefined
}>()
const emit = defineEmits<{
  select: [id: string]
  audition: [startFrame: number, endFrame: number]
  stop: []
  align: [id: string, target: 'kana' | 'h']
}>()
const tree = useObjectTreeStore()
const history = useHistoryStore()
const uiSettings = useUiSettingsStore()
const active = ref(false)
const visible = ref(true)
const setupOpen = ref(false)
const reviewOpen = ref(false)
const expanded = ref(false)
const narrow = ref(false)
const panel = ref<HTMLElement | null>(null)
const position = ref({ left: '12px', top: '80px' })
const referenceId = ref<string | null>(null)
const name = ref('参考歌词')
const referenceText = ref('')
const editingReferenceId = ref<string | null>(null)
const readingBusy = ref(false)
const message = ref('')
const search = ref('')
const searchQuery = ref('')
let searchTimer: ReturnType<typeof setTimeout> | undefined
let readingGeneration = 0
const contextAudio = ref(false)
const chosenRange = ref<LyricRange | null>(null)
const referenceArea = ref<InstanceType<typeof LyricReferenceText> | null>(null)
const entryButton = ref<HTMLElement | null>(null)
let referenceGeneration = 0
let resizeObserver: ResizeObserver | undefined
let compactHeight = 390

const unit = computed(() => { const node = tree.node(props.unitId); return node?.kind === 'synthesisUnit' ? node : null })
const items = computed(() => [...(unit.value?.synthesisUnit.segmentTrack.items ?? [])].sort((a, b) => a.startFrame - b.startFrame))
const data = computed(() => tree.tree.lyricProofreading)
const session = computed(() => data.value?.sessions[props.unitId])
const reference = computed(() => data.value?.references.find(item => item.id === session.value?.referenceId))
const current = computed(() => items.value.find(item => item.id === props.selectedId))
const draft = computed(() => session.value?.drafts[props.selectedId])
const instances = computed(() => getUnitInstances(tree.tree, props.unitId))
const instance = computed(() => instances.value.find(item => item.id === session.value?.instanceId))
const actual = computed(() => unit.value && current.value ? absoluteSegmentRange(unit.value, current.value, instance.value) : null)
const result = computed(() => active.value && unit.value && current.value && reference.value && session.value
  ? findLyricCandidates(tree.tree, unit.value, current.value, reference.value, session.value, searchQuery.value || undefined)
  : { candidates: [], conflict: false })
const progress = computed(() => items.value.filter(item => ['已确认待应用', '已应用', '发音控制待更新'].includes(status(item))).length)
const ready = computed(() => items.value.filter(item => session.value?.drafts[item.id]?.status === 'confirmed'
  && unit.value && draftIsCurrent(unit.value, item, session.value.drafts[item.id], reference.value)))
const neighbors = computed(() => { const index = items.value.findIndex(item => item.id === props.selectedId); return items.value.slice(Math.max(0, index - 1), index + 2) })
const fullDialog = computed(() => expanded.value || narrow.value)
const selectedSnippet = computed(() => {
  const range = draft.value?.ranges[0]
  if (!reference.value || !range) return null
  return { before: reference.value.text.slice(Math.max(0, range.start - 30), range.start), selected: reference.value.text.slice(range.start, range.end), after: reference.value.text.slice(range.end, range.end + 30) }
})
const instanceOptions = computed(() => [{ label: '仅本 SYN 相对时间', value: '' }, ...instances.value.map(item => ({ label: `${item.name} · ${item.trackObject.timelineStart.toFixed(2)}s`, value: item.id }))])

function status(segment: SynthesisSegmentObject) {
  return unit.value ? lyricStatus(unit.value, segment, session.value, reference.value) : '未检查'
}
function saveHistory(description: string, before: ReturnType<typeof tree.snapshotTree>) {
  history.push({ description, patches: [], inversePatches: [], objectTree: { kind: 'snapshot', before, after: tree.snapshotTree() } })
}
function openSetup() {
  referenceId.value = session.value?.referenceId ?? null
  editingReferenceId.value = null
  name.value = '参考歌词'
  referenceText.value = ''
  setupOpen.value = true
  message.value = ''
}
function toggle() {
  if (active.value) { active.value = false; emit('stop'); return }
  active.value = true
  if (!reference.value) { openSetup(); return }
  emit('select', session.value?.currentSegmentId && items.value.some(item => item.id === session.value?.currentSegmentId)
    ? session.value.currentSegmentId : props.selectedId || items.value[0]?.id || '')
  void ensureDraft()
}
function editReference() {
  const refItem = data.value?.references.find(item => item.id === referenceId.value)
  if (!refItem) return
  editingReferenceId.value = refItem.id
  name.value = refItem.name
  referenceText.value = refItem.text
  referenceId.value = null
}
async function readings(text: string): Promise<ReadingToken[]> {
  const response = await fetch('/api/lyrics/reading', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ text }) })
  const payload = await response.json()
  if (!response.ok || !Array.isArray(payload.tokens)) throw new Error(payload.error || '读音转换失败，可手工填写')
  return payload.tokens
}
async function useReference() {
  if (readingBusy.value) return
  let selected = data.value?.references.find(item => item.id === referenceId.value)
  if (!selected && !referenceText.value.trim()) { message.value = '请粘贴参考歌词或选择已有歌词'; return }
  let tokens: ReadingToken[] = []
  const text = referenceText.value
  const referenceName = name.value.trim() || '参考歌词'
  const generation = ++referenceGeneration
  const sourceTree = tree.tree
  const editedId = editingReferenceId.value
  const editedVersion = data.value?.references.find(item => item.id === editedId)?.version
  if (!selected) {
    readingBusy.value = true
    try { tokens = await readings(text) }
    catch (error: any) { message.value = `${error.message}；参考已保留，读音可手工填写` }
    finally { readingBusy.value = false }
  }
  if (generation !== referenceGeneration || tree.tree !== sourceTree || !visible.value || !unit.value) return
  if (editedId && data.value?.references.find(item => item.id === editedId)?.version !== editedVersion) {
    message.value = '参考歌词已在其他位置更新，请重新打开后编辑'
    return
  }
  const before = tree.snapshotTree()
  const state = tree.tree.lyricProofreading ??= { references: [], sessions: {} }
  if (!selected) {
    const previous = state.references.find(item => item.id === editingReferenceId.value)
    selected = { id: previous?.id ?? crypto.randomUUID(), name: referenceName, text, tokens, version: (previous?.version ?? 0) + 1 }
    if (previous) state.references.splice(state.references.indexOf(previous), 1, selected)
    else state.references.push(selected)
  }
  const previousSession = state.sessions[props.unitId]
  if (previousSession?.referenceId !== selected.id) {
    state.sessions[props.unitId] = { referenceId: selected.id, currentSegmentId: props.selectedId || items.value[0]?.id || '', instanceId: instances.value.length === 1 ? instances.value[0].id : null, drafts: {} }
  }
  saveHistory('设置校对参考歌词', before)
  setupOpen.value = false
  active.value = true
  emit('select', session.value?.currentSegmentId || items.value[0]?.id || '')
  await nextTick()
  await ensureDraft()
}
function createDraft(segment: SynthesisSegmentObject): LyricDraft {
  return { source: segmentFingerprint(unit.value!, segment), text: segment.text, kana: segment.kana, ranges: [],
    readingText: segment.text,
    status: 'draft', referenceVersion: reference.value!.version, instanceId: session.value?.instanceId ?? null,
    control: session.value?.drafts[segment.id]?.control }
}
async function ensureDraft() {
  if (!active.value || !current.value || !session.value || !reference.value || !unit.value) return
  session.value.currentSegmentId = current.value.id
  if (!draft.value) session.value.drafts[current.value.id] = createDraft(current.value)
  await nextTick()
  reposition()
}
function rebase() {
  if (!current.value || !session.value) return
  session.value.drafts[current.value.id] = createDraft(current.value)
  message.value = ''
}
function updateDraft(key: 'text' | 'kana', value: string) {
  if (!draft.value) return
  draft.value[key] = value
  if (key === 'kana') draft.value.readingText = draft.value.text
  draft.value.status = 'draft'
  readingGeneration++
}
function choose(candidate: LyricCandidate) {
  if (!draft.value) return
  draft.value.text = candidate.text.replace(/\s+/g, '')
  draft.value.kana = candidate.kana.replace(/\s+/g, '')
  draft.value.readingText = draft.value.text
  draft.value.ranges = [{ start: candidate.start, end: candidate.end }]
  draft.value.instanceId = session.value?.instanceId ?? null
  draft.value.status = 'draft'
  readingGeneration++
  message.value = ''
}
async function regenerateReading() {
  if (!draft.value || readingBusy.value) return
  const target = draft.value
  const text = target.text
  const generation = ++readingGeneration
  readingBusy.value = true
  try {
    const tokens = await readings(text)
    if (draft.value === target && target.text === text && generation === readingGeneration) updateDraft('kana', tokens.map(token => token.kana).join(''))
  } catch (error: any) { message.value = error.message }
  finally { readingBusy.value = false }
}
function clearPosition() { if (draft.value) { draft.value.ranges = []; draft.value.status = 'draft' } }
function navigate(direction: number, revisitSkipped = true) {
  const index = items.value.findIndex(item => item.id === props.selectedId)
  for (let offset = 1; offset <= items.value.length; offset++) {
    const item = items.value[(index + direction * offset + items.value.length * 2) % items.value.length]
    if (item && !['已确认待应用', '已应用', '发音控制待更新', '已跳过'].includes(status(item))) {
      emit('stop'); emit('select', item.id); return
    }
  }
  const skipped = items.value.filter(item => status(item) === '已跳过')
  if (revisitSkipped && skipped.length) { emit('stop'); emit('select', skipped[0].id); return }
  message.value = skipped.length ? `本轮已结束，另有 ${skipped.length} 段已跳过，可通过待处理导航返回` : '本 SYN 已检查完，可查看并应用修改'
}
function confirm(skip = false) {
  if (!draft.value || !current.value || !unit.value) return
  if (!draftIsCurrent(unit.value, current.value, draft.value, reference.value)) { message.value = '源数据已变更，请先重新校对'; return }
  if (!skip && (!draft.value.text.trim() || !draft.value.kana.trim() || (draft.value.readingText !== undefined && draft.value.readingText !== draft.value.text))) { message.value = '请确认原文和读音'; return }
  const before = tree.snapshotTree()
  draft.value.status = skip ? 'skipped' : 'confirmed'
  if (!skip) confirmLyricPosition(draft.value, session.value?.instanceId ?? null)
  saveHistory(skip ? '跳过歌词校对' : '确认歌词校对草稿', before)
  navigate(1, false)
}
function apply() {
  if (props.busy) return
  const before = tree.snapshotTree()
  try {
    const count = applyLyricDrafts(tree.tree, props.unitId, ready.value.map(item => item.id))
    saveHistory('应用歌词校对', before)
    message.value = `已应用 ${count} 段`
    reviewOpen.value = false
  } catch (error: any) { tree.restoreTree(before); message.value = error.message }
}
function play() {
  if (!current.value || !unit.value) return
  if (props.playing) { emit('stop'); return }
  const margin = contextAudio.value ? Math.round(unit.value.synthesisUnit.frameContract.frameRate) : 0
  emit('audition', Math.max(0, current.value.startFrame - margin), Math.min(unit.value.synthesisUnit.frameContract.frameCount, current.value.speechEndFrameExclusive + margin))
}
function useRange() {
  if (!chosenRange.value || !reference.value) return
  choose({ ...chosenRange.value, text: reference.value.text.slice(chosenRange.value.start, chosenRange.value.end), kana: readingForRange(reference.value, chosenRange.value), score: 1, reason: '手工选择' })
}
function showExpanded() {
  expanded.value = true
  scrollReference(true)
}
function scrollReference(focus = false) {
  nextTick(() => {
    const range = draft.value?.ranges[0] ?? result.value.candidates[0]
    if (range) referenceArea.value?.reveal(range, focus)
  })
}
async function regenerateReferenceReading() {
  if (!reference.value || readingBusy.value) return
  const target = reference.value
  const version = target.version
  readingBusy.value = true
  try {
    const tokens = await readings(target.text)
    if (reference.value === target && target.version === version) target.tokens = tokens
  } catch (error: any) { message.value = error.message }
  finally { readingBusy.value = false }
}
function setInstance(id: string) {
  if (!session.value) return
  session.value.instanceId = id || null
  for (const entry of Object.values(session.value.drafts)) {
    const ranges = confirmedLyricRanges(entry, id || null)
    entry.ranges = ranges.map(range => ({ ...range }))
    entry.instanceId = id || null
  }
}
function reposition() {
  if (!active.value || !visible.value) return
  const anchor = props.anchor()
  const width = Math.min(420, window.innerWidth - 24)
  if (panel.value && !fullDialog.value) compactHeight = panel.value.offsetHeight
  const height = Math.min(compactHeight, window.innerHeight - 24)
  const below = anchor ? window.innerHeight - anchor.bottom - 12 : 0
  const above = anchor ? anchor.top - 12 : 0
  narrow.value = window.innerWidth < 640 || !anchor || Math.max(below, above) < height
  position.value = { left: `${Math.max(12, Math.min(anchor?.left ?? 12, window.innerWidth - width - 12))}px`,
    top: `${below >= height ? anchor!.bottom + 8 : Math.max(12, (anchor?.top ?? height + 12) - height - 8)}px` }
}
function onKey(event: KeyboardEvent) {
  if (!active.value || !visible.value) return
  const inside = event.target instanceof HTMLElement && !!event.target.closest('[data-lyric-proofreader]')
  if (inside && (event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 's') {
    event.preventDefault()
    ;(window as any).__saveProject?.()
    return
  }
  if (!active.value || setupOpen.value || reviewOpen.value) return
  if (event.key === 'Escape') {
    if (expanded.value && !narrow.value) expanded.value = false
    else { active.value = false; entryButton.value?.querySelector('button')?.focus() }
    emit('stop')
  }
  if (event.key === 'Tab' && fullDialog.value && panel.value) {
    const elements = Array.from(panel.value.querySelectorAll<HTMLElement>('button:not([disabled]), input:not([disabled]), textarea, [tabindex="0"]')).filter(element => element.offsetParent !== null)
    const first = elements[0], last = elements[elements.length - 1]
    if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus() }
    else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus() }
  }
}
watch(() => props.selectedId, () => { message.value = ''; search.value = ''; searchQuery.value = ''; chosenRange.value = null; readingGeneration++; void ensureDraft(); if (fullDialog.value) scrollReference() })
watch(() => reference.value?.version, () => { chosenRange.value = null })
watch(() => draft.value?.ranges, () => { if (fullDialog.value) scrollReference() }, { deep: true })
watch(search, value => { clearTimeout(searchTimer); searchTimer = setTimeout(() => { searchQuery.value = value }, 180) })
watch(panel, element => { resizeObserver?.disconnect(); if (element) { resizeObserver = new ResizeObserver(reposition); resizeObserver.observe(element) } })
watch(active, value => { if (value) void ensureDraft() })
onMounted(() => { window.addEventListener('resize', reposition); window.addEventListener('scroll', reposition, true); window.addEventListener('keydown', onKey) })
onActivated(() => { visible.value = true; void nextTick(reposition) })
onDeactivated(() => { visible.value = false; setupOpen.value = false; reviewOpen.value = false; readingGeneration++; referenceGeneration++; emit('stop') })
onBeforeUnmount(() => { window.removeEventListener('resize', reposition); window.removeEventListener('scroll', reposition, true); window.removeEventListener('keydown', onKey); clearTimeout(searchTimer); resizeObserver?.disconnect(); readingGeneration++; referenceGeneration++ })
</script>

<template>
  <div ref="entryButton" class="lyric-tools" data-lyric-proofreader>
    <NButton quaternary circle size="small" :type="active ? 'primary' : 'default'" title="歌词辅助校对" aria-label="歌词辅助校对" :disabled="!items.length" @click="toggle"><template #icon><NIcon><BookOutline /></NIcon></template></NButton>
    <template v-if="active">
      <span class="lyric-progress">{{ progress }}/{{ items.length }}</span>
      <NButton quaternary circle size="small" title="上一个待处理" aria-label="上一个待处理" @click="navigate(-1)"><template #icon><NIcon><ChevronBack /></NIcon></template></NButton>
      <NButton quaternary circle size="small" title="下一个待处理" aria-label="下一个待处理" @click="navigate(1)"><template #icon><NIcon><ChevronForward /></NIcon></template></NButton>
      <NButton quaternary circle size="small" title="查看修改" aria-label="查看修改" @click="reviewOpen = true"><template #icon><NIcon><ListOutline /></NIcon></template></NButton>
    </template>
  </div>

  <NModal v-model:show="setupOpen" preset="card" title="参考歌词" :mask-closable="!readingBusy" :closable="!readingBusy" class="lyric-modal" style="width: min(620px, calc(100vw - 24px)); max-height: calc(100vh - 24px); overflow: auto" @keydown.stop="onKey">
    <div class="lyric-form" data-lyric-proofreader>
      <label>工程参考<NSelect v-model:value="referenceId" clearable placeholder="新建参考歌词" :disabled="readingBusy" :options="data?.references.map(item => ({ label: item.name, value: item.id })) ?? []" /></label>
      <NButton v-if="referenceId" size="small" @click="editReference">编辑参考文本</NButton>
      <template v-else>
        <label>名称<NInput v-model:value="name" :disabled="readingBusy" /></label>
        <label>歌词<NInput v-model:value="referenceText" type="textarea" :disabled="readingBusy" :maxlength="30000" :autosize="{ minRows: 8, maxRows: 16 }" placeholder="粘贴整首或一段歌词" /></label>
        <p v-if="editingReferenceId" class="lyric-warning">更新参考后，原有对应关系需要复核。</p>
      </template>
      <p v-if="session && referenceId && referenceId !== session.referenceId" class="lyric-warning">更换参考会重建当前 SYN 的校对草稿，可撤销。</p>
      <p v-if="message" role="status">{{ message }}</p>
      <NButton type="primary" :loading="readingBusy" @click="useReference">使用参考歌词</NButton>
    </div>
  </NModal>

  <Teleport to="body">
    <div v-if="active && visible && current && draft && reference && !setupOpen && !reviewOpen" data-lyric-proofreader>
      <div v-if="fullDialog" class="lyric-backdrop" @click="active = false; emit('stop')" />
      <section ref="panel" class="lyric-popup" :class="{ expanded: fullDialog }" :style="fullDialog ? {} : position" role="dialog" :aria-modal="fullDialog" aria-label="歌词校对" @keydown.stop="onKey">
        <header>
          <div class="lyric-heading"><strong>{{ unit?.name }}</strong><small>{{ actual ? `${actual[0].toFixed(2)}–${actual[1].toFixed(2)}s` : `${(current.startFrame / unit!.synthesisUnit.frameContract.frameRate).toFixed(2)}s · 相对时间` }} · {{ status(current) }}</small></div>
          <NButton quaternary circle size="small" title="更换参考歌词" aria-label="更换参考歌词" @click="openSetup"><template #icon><NIcon><BookOutline /></NIcon></template></NButton>
          <NButton quaternary circle size="small" title="查看校对修改" aria-label="查看校对修改" @click="reviewOpen = true"><template #icon><NIcon><ListOutline /></NIcon></template></NButton>
          <NButton quaternary circle size="small" :title="expanded ? '收起参考全文' : '参考歌词与其他候选'" :aria-label="expanded ? '收起参考全文' : '参考歌词与其他候选'" @click="expanded ? expanded = false : showExpanded()"><template #icon><NIcon><ExpandOutline /></NIcon></template></NButton>
          <NButton quaternary circle size="small" title="退出校对" aria-label="退出校对" @click="active = false; emit('stop')"><template #icon><NIcon><CloseOutline /></NIcon></template></NButton>
        </header>
        <div class="lyric-body">
          <p v-if="!draftIsCurrent(unit!, current, draft, reference)" class="lyric-warning">源数据或参考已变更。<button class="lyric-link" @click="rebase">重新校对这段</button></p>
          <p v-if="result.conflict" class="lyric-warning">相邻确认位置冲突，请检查重复段落。</p>
          <p class="lyric-original">当前：{{ current.text }}</p>
          <p v-if="selectedSnippet" class="lyric-context">{{ selectedSnippet.before }}<mark>{{ selectedSnippet.selected }}</mark>{{ selectedSnippet.after }}</p>
          <p v-else class="lyric-muted">参考位置未确定</p>
          <div class="lyric-form">
            <label>修正原文<NInput :value="draft.text" type="textarea" :input-props="{ 'aria-label': '修正原文' }" :autosize="{ minRows: 1, maxRows: 3 }" @update:value="updateDraft('text', $event)" /></label>
            <label>读音<NInput :value="draft.kana" :input-props="{ 'aria-label': '读音' }" @update:value="updateDraft('kana', $event)" /></label>
            <p v-if="uiSettings.settings.showRomaji" class="lyric-muted lyric-romaji">{{ kanaToRomaji(draft.kana) }}</p>
            <label v-if="draft.readingText !== undefined && draft.readingText !== draft.text" class="lyric-warning"><span>原文已变更，请重新生成或核对读音。</span><span><input type="checkbox" @change="draft.readingText = draft.text"> 保留当前读音，已核对</span></label>
            <div class="lyric-actions"><NButton size="tiny" :loading="readingBusy" @click="regenerateReading">生成读音候选</NButton><button class="lyric-link" @click="clearPosition">暂不确定位置</button></div>
          </div>
          <div v-if="!fullDialog" class="lyric-candidates">
            <button v-for="candidate in result.candidates.slice(0, 2)" :key="`${candidate.start}:${candidate.end}`" class="lyric-candidate" @click="choose(candidate)"><span><mark>{{ candidate.text }}</mark></span><span v-if="uiSettings.settings.showRomaji" class="candidate-romaji"><mark v-if="candidate.kana">{{ kanaToRomaji(candidate.kana) }}</mark><template v-else>读音待生成</template></span><small>{{ candidate.reason }} · 字符 {{ candidate.start + 1 }}</small></button>
            <button class="lyric-link" @click="showExpanded">{{ result.candidates.length ? '其他候选 / 选择参考范围' : '未找到可靠候选，手工定位' }}</button>
          </div>
          <template v-if="fullDialog">
            <div class="lyric-section">
              <label>时间线位置<NSelect :value="session?.instanceId ?? ''" :options="instanceOptions" @update:value="setInstance" /></label>
              <div class="lyric-actions"><strong>{{ reference.name }}</strong><button class="lyric-link" @click="openSetup">更换参考</button></div>
              <NInput v-model:value="search" placeholder="搜索听清的几个字" clearable><template #prefix><NIcon><SearchOutline /></NIcon></template></NInput>
              <div class="lyric-actions"><span>匹配位置 · {{ result.candidates.length }} 处</span><NButton v-if="uiSettings.settings.showRomaji && !reference.tokens.length" size="tiny" :loading="readingBusy" @click="regenerateReferenceReading">生成参考读音</NButton></div>
              <div class="lyric-candidates">
                <button v-for="candidate in result.candidates" :key="`${candidate.start}:${candidate.end}`" class="lyric-candidate" @click="choose(candidate)"><span>{{ reference.text.slice(Math.max(0, candidate.start - 14), candidate.start) }}<mark>{{ candidate.text }}</mark>{{ reference.text.slice(candidate.end, candidate.end + 14) }}</span><span v-if="uiSettings.settings.showRomaji" class="candidate-romaji"><mark v-if="candidate.kana">{{ kanaToRomaji(candidate.kana) }}</mark><template v-else>读音待生成</template></span><small>{{ candidate.reason }} · 字符 {{ candidate.start + 1 }}–{{ candidate.end }}</small></button>
              </div>
              <div class="reference-field"><span>参考全文</span><LyricReferenceText ref="referenceArea" :reference="reference" :show-romaji="uiSettings.settings.showRomaji" :highlight="draft.ranges[0] ?? result.candidates[0]" @select="chosenRange = $event" /></div>
              <NButton size="small" :disabled="!chosenRange" @click="useRange">用于当前片段</NButton>
            </div>
            <div class="lyric-section">
              <strong>相邻片段</strong>
              <div v-for="segment in neighbors" :key="segment.id" class="lyric-neighbor" :class="{ current: segment.id === current.id }">
                <button class="lyric-link" @click="emit('select', segment.id)">{{ (segment.startFrame / unit!.synthesisUnit.frameContract.frameRate).toFixed(2) }}s</button>
                <span>{{ session?.drafts[segment.id]?.text ?? segment.text }}</span>
                <NButton quaternary circle size="tiny" title="试听该片段" @click="emit('audition', segment.startFrame, segment.speechEndFrameExclusive)"><template #icon><NIcon><PlayOutline /></NIcon></template></NButton>
              </div>
              <NButton size="small" :disabled="!neighbors.length" @click="emit('audition', neighbors[0].startFrame, neighbors[neighbors.length - 1].speechEndFrameExclusive)">连同相邻片段试听</NButton>
            </div>
          </template>
          <div v-if="status(current) === '发音控制待更新'" class="lyric-section lyric-warning">
            <span>合成仍需更新 H 控制</span>
            <div class="lyric-actions"><NButton size="small" :disabled="busy" @click="active = false; emit('align', current.id, 'kana')">重对齐 Kana</NButton><NButton size="small" :disabled="busy" @click="active = false; emit('align', current.id, 'h')">按修正读音更新 H</NButton></div>
          </div>
          <p v-if="message" role="status">{{ message }}</p>
        </div>
        <footer>
          <NButton quaternary circle title="试听当前片段" aria-label="试听当前片段" @click="play"><template #icon><NIcon><PlayOutline /></NIcon></template></NButton>
          <label class="lyric-checkbox"><input v-model="contextAudio" type="checkbox">前后文</label>
          <NButton size="small" @click="confirm(true)">跳过</NButton>
          <NButton size="small" type="primary" :disabled="busy || !draftIsCurrent(unit!, current, draft, reference)" @click="confirm()"><template #icon><NIcon><CheckmarkOutline /></NIcon></template>确认并继续</NButton>
        </footer>
      </section>
    </div>
  </Teleport>

  <NModal v-model:show="reviewOpen" preset="card" title="校对修改" class="lyric-modal" style="width: min(720px, calc(100vw - 24px)); max-height: calc(100vh - 24px); overflow: auto" @keydown.stop="onKey">
    <div class="lyric-form" data-lyric-proofreader>
      <p>{{ unit?.name }} · {{ ready.length }} 段待应用<span v-if="instances.length > 1"> · {{ instances.length }} 个时间线实例共享源歌词</span></p>
      <div class="lyric-review">
        <div v-for="segment in items.filter(item => session?.drafts[item.id])" :key="segment.id" class="lyric-review-row">
          <button class="lyric-link" @click="reviewOpen = false; active = true; emit('select', segment.id)">{{ (segment.startFrame / unit!.synthesisUnit.frameContract.frameRate).toFixed(2) }}s · {{ status(segment) }}</button>
          <del v-if="segment.text !== session!.drafts[segment.id].text">{{ segment.text }}</del>
          <span>{{ session!.drafts[segment.id].text }}</span>
          <small>{{ session!.drafts[segment.id].kana }}</small>
          <small v-if="uiSettings.settings.showRomaji">{{ kanaToRomaji(session!.drafts[segment.id].kana) }}</small>
        </div>
      </div>
      <p v-if="message" role="status">{{ message }}</p>
      <div class="lyric-actions"><NButton @click="reviewOpen = false; openSetup()">参考歌词</NButton><NButton type="primary" :disabled="!ready.length || busy" @click="apply">应用已确认文字</NButton></div>
    </div>
  </NModal>
</template>

<style scoped>
.lyric-tools { display: flex; align-items: center; flex: 0 0 auto; gap: 2px; }
.lyric-progress { font: 11px ui-monospace, monospace; color: var(--app-muted); white-space: nowrap; }
.lyric-popup { position: fixed; z-index: 2100; width: min(420px, calc(100vw - 24px)); max-height: calc(100vh - 24px); display: flex; flex-direction: column; background: var(--app-panel, #242428); color: var(--app-text, #eee); border: 1px solid var(--app-border, #555); border-radius: 6px; box-shadow: 0 8px 32px #0005; font-size: 12px; letter-spacing: 0; }
.lyric-popup.expanded { left: 50%; top: 50%; transform: translate(-50%, -50%); width: min(700px, calc(100vw - 24px)); }
.lyric-popup header, .lyric-popup footer { display: flex; align-items: center; gap: 8px; padding: 10px 12px; flex: 0 0 auto; }
.lyric-popup header { border-bottom: 1px solid var(--app-border); }
.lyric-popup footer { border-top: 1px solid var(--app-border); flex-wrap: wrap; }
.lyric-heading { min-width: 0; flex: 1; }
.lyric-heading strong, .lyric-heading small { display: block; overflow-wrap: anywhere; }
.lyric-heading small { color: var(--app-muted); margin-top: 3px; }
.lyric-body { overflow: auto; min-height: 0; padding: 10px 12px; scrollbar-width: thin; }
.lyric-backdrop { position: fixed; inset: 0; background: #0005; z-index: 2099; }
.lyric-form { display: grid; gap: 10px; min-width: 0; }
.lyric-form label, .lyric-section > label { display: grid; gap: 5px; }
.lyric-actions { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; justify-content: space-between; }
.lyric-link { border: 0; background: transparent; padding: 3px 0; color: var(--app-accent, #6fcbba); cursor: pointer; font: inherit; text-align: left; }
.lyric-muted, .lyric-original, small { color: var(--app-muted, #aaa); }
.lyric-warning { color: #d6a94d; }
.lyric-context { white-space: pre-wrap; overflow-wrap: anywhere; max-height: 90px; overflow: auto; line-height: 1.6; }
mark { color: inherit; background: #318b7055; border-bottom: 1px solid #62bca0; }
.lyric-candidates { display: grid; gap: 0; max-height: 180px; overflow: auto; margin: 8px 0; scrollbar-width: thin; }
.lyric-candidate { padding: 7px 3px; border: 0; border-bottom: 1px solid var(--app-border); background: transparent; color: inherit; text-align: left; font: inherit; cursor: pointer; overflow-wrap: anywhere; }
.lyric-candidate:hover { background: #8882; }
.lyric-candidate span, .lyric-candidate small { display: block; }
.lyric-candidate small { margin-top: 3px; }
.candidate-romaji { color: var(--app-muted); font-size: 11px; line-height: 1.5; margin: 4px 0; }
.reference-field { display: grid; gap: 5px; }
.lyric-section { border-top: 1px solid var(--app-border); padding-top: 12px; margin-top: 12px; display: grid; gap: 8px; }
.lyric-neighbor { display: flex; align-items: center; gap: 10px; padding: 4px; }
.lyric-neighbor.current { background: #8882; }
.lyric-neighbor span { min-width: 0; flex: 1; overflow-wrap: anywhere; }
.lyric-checkbox { display: flex; align-items: center; gap: 4px; margin-right: auto; white-space: nowrap; }
.lyric-review { max-height: 55vh; overflow: auto; scrollbar-width: thin; }
.lyric-review-row { display: grid; gap: 4px; padding: 10px 0; border-bottom: 1px solid var(--app-border); overflow-wrap: anywhere; }
.lyric-review-row del { color: var(--app-muted); }
.lyric-popup p { margin: 6px 0 10px; overflow-wrap: anywhere; }
</style>
