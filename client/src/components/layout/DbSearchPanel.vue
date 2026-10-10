<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { NButton, NCheckbox, NModal } from 'naive-ui'
import DbSearchPlot from './DbSearchPlot.vue'
import { useDbSearchStore } from '@/stores/dbSearch'
import { useObjectTreeStore } from '@/stores/objectTree'
import { useObjectTreeUiStore } from '@/stores/objectTreeUi'
import { useTracksStore } from '@/stores/tracks'
import { useProjectStore } from '@/stores/project'
import { useHistoryStore } from '@/stores/history'
import { TOP_LEVEL_IDS } from '@/object-workbench'
import { resolveDbSearchAudio } from '@/composables/dbSearchInput'
import type { DbPoint } from '@/utils/dbSearchGeometry'

const db = useDbSearchStore()
const tree = useObjectTreeStore()
const ui = useObjectTreeUiStore()
const tracks = useTracksStore()
const project = useProjectStore()
const history = useHistoryStore()
const chart = ref<InstanceType<typeof DbSearchPlot> | null>(null)
const expandedChart = ref<InstanceType<typeof DbSearchPlot> | null>(null)
const expanded = ref(false)
const importing = ref(false)
const input = computed(() => db.inputId ? tree.node(db.inputId) : undefined)
const selected = computed(() => db.points.find(point => point.id === db.selectedId))
const queryPlaying = ref(false)
let audio: HTMLAudioElement | null = null
let audioUrl: string | null = null
let playbackGeneration = 0
let requestGeneration = 0
let abort: AbortController | null = null
function resetView() { chart.value?.resetView(); expandedChart.value?.resetView() }
function stopAudio() {
  playbackGeneration++
  queryPlaying.value = false
  audio?.pause()
  audio = null
  if (audioUrl) URL.revokeObjectURL(audioUrl)
  audioUrl = null
}
function resetInputResults() {
  stopAudio()
  db.points = []
  db.selectedId = null
  db.message = ''
  resetView()
}
async function search() {
  const node = input.value
  if (!node || db.searching) return
  stopAudio()
  db.points = []
  db.selectedId = null
  db.searching = true
  db.message = '提取向量并检索…'
  const generation = ++requestGeneration
  abort = new AbortController()
  try {
    const blob = await resolveDbSearchAudio({ node, nodes: tree.index.nodes, tree: tree.tree, sourceBlobs: tracks.sourceBlobs, segments: tracks.segmentsMap, tracks: tracks.tracks })
    if (generation !== requestGeneration) return
    const result = await db.responseJson(await fetch('/api/db/search', { method: 'POST', headers: { 'Content-Type': 'audio/wav' }, body: blob, signal: abort.signal }))
    if (generation !== requestGeneration) return
    db.points = result.points
    resetView()
    db.message = `${db.points.length} 个结果`
  } catch (error: any) {
    if (generation === requestGeneration) db.message = error.message || '检索失败'
  } finally { if (generation === requestGeneration) db.searching = false }
}
async function fetchAudio(point: DbPoint) {
  const response = await fetch(`/api/db/audio/${encodeURIComponent(point.id)}`)
  if (!response.ok) {
    const error = await response.json()
    throw new Error(error.error || '读取句段失败')
  }
  return response.blob()
}
async function select(point: DbPoint) {
  stopAudio()
  db.selectedId = point.id
  const generation = playbackGeneration
  try {
    const blob = await fetchAudio(point)
    if (generation !== playbackGeneration) return
    await playPreview(blob, generation)
  } catch (error: any) {
    if (generation === playbackGeneration) { stopAudio(); db.message = error.message }
  }
}
async function playPreview(blob: Blob, generation: number) {
  if (generation !== playbackGeneration) return
  audioUrl = URL.createObjectURL(blob)
  const player = new Audio(audioUrl)
  audio = player
  player.onended = () => { if (audio === player) stopAudio() }
  await player.play()
}
async function previewQuery() {
  if (queryPlaying.value) { stopAudio(); return }
  const node = input.value
  if (!node) return
  stopAudio()
  db.selectedId = null
  queryPlaying.value = true
  const generation = playbackGeneration
  try {
    const blob = await resolveDbSearchAudio({
      node, nodes: tree.index.nodes, tree: tree.tree,
      sourceBlobs: tracks.sourceBlobs, segments: tracks.segmentsMap, tracks: tracks.tracks,
    })
    await playPreview(blob, generation)
  } catch (error: any) {
    if (generation === playbackGeneration) { stopAudio(); db.message = error.message || '输入音频试听失败' }
  }
}
async function importSelected() {
  const point = selected.value
  if (!point || importing.value) return
  importing.value = true
  const projectId = project.id
  const loadTick = project.loadTick
  try {
    const blob = await fetchAudio(point)
    if (project.id !== projectId || project.loadTick !== loadTick) return
    const before = tree.snapshotTree()
    const workspace = tree.node(TOP_LEVEL_IDS.workspace)
    if (workspace?.kind !== 'folder') throw new Error('Workspace 不存在')
    let folder = workspace.children.find(node => node.kind === 'folder' && node.name === 'DBsearch')
    if (!folder) {
      const created = tree.createFolder(workspace.id, 'DBsearch')
      if (!created.ok || !created.id) throw new Error(created.reason || '创建 DBsearch 失败')
      folder = tree.node(created.id)
    }
    if (!folder) throw new Error('DBsearch 不存在')
    const fileName = `${point.name}_db_${point.id.slice(0, 8)}.wav`.replace(/[\\/:*?"<>|]/g, '_')
    const result = await tree.importFilesToFolder(folder.id, [new File([blob], fileName, { type: 'audio/wav' })])
    if (!result.ok) { tree.restoreTree(before); throw new Error(result.reason) }
    const imported = tree.node(result.ids![0])
    const asset = imported?.kind === 'audio' ? tree.tree.assets[imported.audio.assetId] : null
    history.push({
      description: '导入 DB 检索句段', patches: [], inversePatches: [],
      objectTree: { kind: 'snapshot', before, after: tree.snapshotTree(), blobChanges: asset?.blobKey ? [{ key: asset.blobKey, before: null, after: tracks.sourceBlobs.get(asset.blobKey)! }] : [] },
    })
    ui.expanded.L1.add(workspace.id)
    ui.expanded.L1.add(folder.id)
    ui.selectById(result.ids![0])
    project.bumpRedraw()
    db.message = `已添加：${fileName}`
  } catch (error: any) { db.message = error.message || '导入失败' }
  finally { importing.value = false }
}
function resetProject() {
  expanded.value = false
  abort?.abort()
  requestGeneration++
  db.searching = false
  db.inputId = null
  db.selectedId = null
  db.points = []
  db.message = ''
  stopAudio()
  resetView()
}
watch(() => project.loadTick, resetProject)
watch(() => db.inputId, resetInputResults)
watch(input, node => { if (!node && db.inputId) resetProject() })
onMounted(() => db.loadSettings())
onBeforeUnmount(() => { abort?.abort(); requestGeneration++; db.searching = false; stopAudio() })
</script>

<template>
  <div class="db-panel">
    <slot name="input" />
    <n-checkbox v-model:checked="db.strict" size="small">严格距离检索</n-checkbox>
    <n-button size="small" block type="primary" :disabled="!input || db.searching" :loading="db.searching" @click="search">检索</n-button>
    <DbSearchPlot ref="chart" :points="db.points" :strict="db.strict" :selected-id="db.selectedId"
      :query-name="input?.name || ''" :query-enabled="!!input" :query-playing="queryPlaying"
      expandable @query="previewQuery" @select="select" @import="importSelected" @expand="expanded = true" />
    <div v-if="selected" class="selected-result">
      <div class="result-name" :title="selected.name">{{ selected.name }}</div>
      <div class="result-text">{{ selected.text }}</div>
      <div class="result-meta">#{{ selected.rank }} · {{ selected.distance.toFixed(5) }} · {{ selected.duration.toFixed(2) }}s{{ selected.short ? ' · 短句' : '' }}</div>
    </div>
    <div class="db-message" role="status">{{ db.message }}</div>
    <NModal v-model:show="expanded" preset="card" title="DB" class="db-expanded-modal"
      :style="{ width: 'min(720px, calc(100vw - 32px), calc(100dvh - 210px))' }"
      @after-enter="expandedChart?.focus()" @after-leave="chart?.focus()">
      <div class="expanded-head">
        <span :title="input?.name">{{ input?.name || '—' }}</span>
        <n-checkbox v-model:checked="db.strict" size="small">严格距离检索</n-checkbox>
      </div>
      <DbSearchPlot ref="expandedChart" :points="db.points" :strict="db.strict" :selected-id="db.selectedId"
        :query-name="input?.name || ''" :query-enabled="!!input" :query-playing="queryPlaying"
        label="DB 大图坐标图" @query="previewQuery" @select="select" @import="importSelected" />
      <div class="expanded-result">
        <template v-if="selected">
          <div class="result-name" :title="selected.name">{{ selected.name }}</div>
          <div class="result-text">{{ selected.text }}</div>
          <div class="result-meta">#{{ selected.rank }} · {{ selected.distance.toFixed(5) }} · {{ selected.duration.toFixed(2) }}s</div>
        </template>
        <div class="db-message" role="status">{{ db.message }}</div>
      </div>
    </NModal>
  </div>
</template>

<style scoped>
.db-panel { flex: 1; min-height: 0; overflow-y: auto; display: flex; flex-direction: column; gap: 10px; padding: 10px; }
.selected-result { min-width: 0; font-size: 11px; }
.result-name { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.result-text { overflow-wrap: anywhere; max-height: 60px; overflow-y: auto; margin: 5px 0; }
.result-meta, .db-message { color: var(--app-muted); font-size: 10px; overflow-wrap: anywhere; }
.db-message { max-height: 90px; overflow-y: auto; }
.expanded-head { display: flex; align-items: center; justify-content: space-between; gap: 12px; margin-bottom: 10px; }
.expanded-head > span { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 12px; }
.expanded-head :deep(.n-checkbox) { flex-shrink: 0; }
.expanded-result { margin-top: 10px; min-width: 0; font-size: 12px; }
.expanded-result .result-text { max-height: 36px; }
.expanded-result .db-message { max-height: 28px; }
</style>
