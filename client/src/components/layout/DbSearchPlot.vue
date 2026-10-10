<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { ExpandOutline, RefreshOutline } from '@vicons/ionicons5'
import { dbPointPosition, type DbPoint } from '@/utils/dbSearchGeometry'

const props = defineProps<{
  points: DbPoint[]
  strict: boolean
  selectedId: string | null
  queryName: string
  queryEnabled?: boolean
  queryPlaying?: boolean
  expandable?: boolean
  label?: string
}>()
const emit = defineEmits<{
  select: [point: DbPoint]
  import: []
  expand: []
  query: []
}>()
const chart = ref<HTMLElement | null>(null)
const dimensions = ref({ width: 200, height: 200 })
const zoom = ref(1)
const pan = ref({ x: 0, y: 0 })
const positions = computed(() => props.points.map(point => ({ point, ...dbPointPosition(point, props.strict) })))
const extent = computed(() => Math.max(0.001, ...positions.value.map(point => Math.max(Math.abs(point.x), Math.abs(point.y)))))
const scale = computed(() => (Math.min(dimensions.value.width, dimensions.value.height) / 2 - 22) / extent.value * zoom.value)
const origin = computed(() => ({ x: dimensions.value.width / 2 + pan.value.x, y: dimensions.value.height / 2 + pan.value.y }))
let observer: ResizeObserver | null = null
let drag: { id: number; x: number; y: number; panX: number; panY: number } | null = null
function resetView() { zoom.value = 1; pan.value = { x: 0, y: 0 } }
function focus() { chart.value?.focus() }
function select(point: DbPoint) { focus(); emit('select', point) }
function selectQuery() {
  if (!props.queryEnabled) return
  focus()
  emit('query')
}
function wheel(event: WheelEvent) {
  event.preventDefault()
  const box = chart.value!.getBoundingClientRect()
  const x = event.clientX - box.left - chart.value!.clientLeft - dimensions.value.width / 2
  const y = event.clientY - box.top - chart.value!.clientTop - dimensions.value.height / 2
  const next = Math.min(10000, Math.max(0.2, zoom.value * Math.exp(-event.deltaY * 0.002)))
  const ratio = next / zoom.value
  pan.value = { x: x - (x - pan.value.x) * ratio, y: y - (y - pan.value.y) * ratio }
  zoom.value = next
}
function pointerDown(event: PointerEvent) {
  if (event.button !== 1) return
  event.preventDefault()
  chart.value?.setPointerCapture(event.pointerId)
  drag = { id: event.pointerId, x: event.clientX, y: event.clientY, panX: pan.value.x, panY: pan.value.y }
}
function pointerMove(event: PointerEvent) {
  if (drag?.id !== event.pointerId) return
  pan.value = { x: drag.panX + event.clientX - drag.x, y: drag.panY + event.clientY - drag.y }
}
watch(() => props.strict, resetView)
watch(() => props.points, resetView)
onMounted(() => {
  observer = new ResizeObserver(entries => {
    const { width, height } = entries[0].contentRect
    dimensions.value = { width: Math.max(80, width), height: Math.max(80, height) }
  })
  if (chart.value) observer.observe(chart.value)
})
onBeforeUnmount(() => observer?.disconnect())
defineExpose({ focus, resetView })
</script>

<template>
  <div ref="chart" class="db-chart" tabindex="0" :aria-label="label || 'DB 检索坐标图'"
    @wheel="wheel" @pointerdown="pointerDown" @pointermove="pointerMove" @pointerup="drag = null"
    @pointercancel="drag = null" @auxclick.prevent @keydown.enter.stop.prevent="emit('import')">
    <svg :viewBox="`0 0 ${dimensions.width} ${dimensions.height}`" width="100%" height="100%">
      <g class="crosshair" :transform="`translate(${origin.x} ${origin.y})`">
        <line :x1="-origin.x" :x2="dimensions.width - origin.x" y1="0" y2="0" class="axis horizontal-axis" />
        <line x1="0" x2="0" :y1="-origin.y" :y2="dimensions.height - origin.y" class="axis vertical-axis" />
      </g>
      <g v-for="item in positions" :key="item.point.id" class="point" :class="{ selected: selectedId === item.point.id }" @click.stop="select(item.point)">
        <circle :cx="origin.x + item.x * scale" :cy="origin.y - item.y * scale" r="6" class="point-hit" />
        <circle :cx="origin.x + item.x * scale" :cy="origin.y - item.y * scale" :r="selectedId === item.point.id ? 4 : 2.5" />
        <title>{{ item.point.name }}&#10;{{ item.point.text }}&#10;距离 {{ item.point.distance.toFixed(5) }}</title>
      </g>
      <g class="query-origin" :class="{ enabled: queryEnabled, playing: queryPlaying }"
        :transform="`translate(${origin.x} ${origin.y})`" role="button"
        :tabindex="queryEnabled ? 0 : -1" :aria-label="queryPlaying ? '停止输入音频试听' : '试听输入音频'"
        :aria-disabled="!queryEnabled" @click.stop="selectQuery"
        @keydown.enter.stop.prevent="selectQuery" @keydown.space.stop.prevent="selectQuery">
        <circle cx="0" cy="0" r="11" class="query-hit" />
        <circle cx="0" cy="0" r="5" class="query" />
        <title>{{ queryName || '查询点' }}</title>
      </g>
    </svg>
    <div class="plot-tools">
      <button class="icon-button" title="重置视图" @click="resetView"><RefreshOutline /></button>
      <button v-if="expandable" class="icon-button" title="展开检索图" @click="emit('expand')"><ExpandOutline /></button>
    </div>
  </div>
</template>

<style scoped>
.db-chart { position: relative; width: 100%; aspect-ratio: 1; box-sizing: border-box; flex: 0 0 auto; overflow: hidden; border: 1px solid var(--app-border); outline: none; touch-action: none; }
.db-chart > svg { position: absolute; inset: 0; display: block; }
.db-chart:focus-visible { border-color: var(--app-accent); }
.axis { stroke: var(--app-border); stroke-width: 1; pointer-events: none; }
.query-origin.enabled { cursor: pointer; }
.query-hit { fill: transparent; }
.query { fill: var(--app-text); stroke: var(--app-panel); stroke-width: 1.5; }
.query-origin.playing .query, .query-origin.enabled:hover .query, .query-origin:focus-visible .query { fill: #e77945; }
.point { fill: var(--app-accent); cursor: pointer; }
.point.selected { fill: #e77945; }
.point-hit { fill: transparent; }
.plot-tools { position: absolute; right: 4px; top: 4px; display: flex; gap: 2px; background: var(--app-panel); }
.icon-button { display: inline-flex; align-items: center; justify-content: center; width: 22px; height: 22px; padding: 3px; border: 0; background: transparent; color: var(--app-muted); cursor: pointer; }
.icon-button:hover { background: var(--app-hover); color: var(--app-text); }
.icon-button svg { width: 16px; height: 16px; }
</style>
