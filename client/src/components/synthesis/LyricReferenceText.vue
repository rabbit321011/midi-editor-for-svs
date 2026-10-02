<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { referenceLyricLines, referenceRomajiParts, type LyricRange, type LyricReference } from '@/object-workbench/lyricProofreading'

const props = defineProps<{ reference: LyricReference; showRomaji: boolean; highlight?: LyricRange }>()
const emit = defineEmits<{ select: [range: LyricRange | null] }>()
const root = ref<HTMLElement | null>(null)
const lines = computed(() => referenceLyricLines(props.reference))
const selectedRange = ref<LyricRange | null>(null)
const romanLines = computed(() => lines.value.map(line => referenceRomajiParts(props.reference, line, selectedRange.value ?? props.highlight)))
watch(() => [props.reference.id, props.reference.version, props.highlight?.start, props.highlight?.end], () => { selectedRange.value = null })

function parts(line: { start: number; end: number; text: string }) {
  const start = Math.max(0, Math.min(line.text.length, (props.highlight?.start ?? line.end) - line.start))
  const end = Math.max(start, Math.min(line.text.length, (props.highlight?.end ?? line.end) - line.start))
  return [line.text.slice(0, start), line.text.slice(start, end), line.text.slice(end)]
}

function sourceSelection(): LyricRange | null {
  const selection = window.getSelection()
  if (!root.value || !selection?.rangeCount || selection.isCollapsed) return null
  const range = selection.getRangeAt(0)
  if (!root.value.contains(range.startContainer) || !root.value.contains(range.endContainer)) return null
  let start: number | undefined
  let end = 0
  // Only original-text spans contribute offsets; ruby/romaji is display-only.
  for (const element of root.value.querySelectorAll<HTMLElement>('[data-source-start]')) {
    if (!range.intersectsNode(element)) continue
    const base = Number(element.dataset.sourceStart)
    const clipped = range.cloneRange()
    if (!element.contains(range.startContainer)) clipped.setStart(element, 0)
    if (!element.contains(range.endContainer)) clipped.setEnd(element, element.childNodes.length)
    const prefix = document.createRange()
    prefix.selectNodeContents(element)
    prefix.setEnd(clipped.startContainer, clipped.startOffset)
    const localStart = prefix.toString().length
    const length = clipped.toString().length
    if (!length) continue
    start ??= base + localStart
    end = base + localStart + length
  }
  return start !== undefined && end > start ? { start, end } : null
}

function captureSelection() {
  selectedRange.value = sourceSelection()
  emit('select', selectedRange.value)
}
function copy(event: ClipboardEvent) {
  const range = sourceSelection()
  if (!range || !event.clipboardData) return
  event.preventDefault()
  event.clipboardData.setData('text/plain', props.reference.text.slice(range.start, range.end))
}
function selectAll(event: KeyboardEvent) {
  if (!(event.ctrlKey || event.metaKey) || event.key.toLowerCase() !== 'a' || !root.value) return
  event.preventDefault()
  const range = document.createRange()
  range.selectNodeContents(root.value)
  window.getSelection()?.removeAllRanges()
  window.getSelection()?.addRange(range)
  captureSelection()
}
function reveal(range: LyricRange, focus = false) {
  if (!root.value) return
  const line = [...root.value.querySelectorAll<HTMLElement>('[data-source-start]')]
    .find(element => Number(element.dataset.sourceEnd) > range.start)
  if (focus) root.value.focus({ preventScroll: true })
  if (line) {
    const containerRect = root.value.getBoundingClientRect()
    root.value.scrollTop += line.getBoundingClientRect().top - containerRect.top - 24
  }
}
defineExpose({ reveal })
</script>

<template>
  <div ref="root" class="lyric-reference" role="region" aria-label="参考全文" tabindex="0" @mouseup="captureSelection" @keyup="captureSelection" @keydown="selectAll" @copy="copy" @touchend="captureSelection">
    <div v-for="(line, lineIndex) in lines" :key="line.start" class="reference-line">
      <span class="reference-source" :data-source-start="line.start" :data-source-end="line.end"><span>{{ parts(line)[0] }}</span><mark v-if="parts(line)[1]">{{ parts(line)[1] }}</mark><span>{{ parts(line)[2] }}</span></span>
      <span v-if="showRomaji && line.text.trim()" class="reference-romaji" aria-label="参考罗马音"><template v-if="romanLines[lineIndex].length"><template v-for="(part, index) in romanLines[lineIndex]" :key="index"><mark v-if="part.highlighted">{{ part.text }}</mark><span v-else>{{ part.text }}</span></template></template><template v-else>读音待生成</template></span>
    </div>
  </div>
</template>

<style scoped>
.lyric-reference { box-sizing: border-box; position: relative; width: 100%; height: 190px; min-height: 120px; max-height: 55vh; resize: vertical; overflow: auto; border: 1px solid var(--app-border); border-radius: 3px; padding: 8px 10px; background: var(--app-surface, #18181c); color: inherit; line-height: 24px; scrollbar-width: thin; }
.lyric-reference:focus-visible { outline: 1px solid var(--app-accent); }
.reference-line { margin-bottom: 7px; }
.reference-source { display: block; min-height: 24px; white-space: pre-wrap; overflow-wrap: anywhere; user-select: text; }
.reference-romaji { display: block; line-height: 1.5; font-size: 11px; color: var(--app-muted); white-space: pre-wrap; overflow-wrap: anywhere; user-select: none; }
mark { color: inherit; background: #318b7055; border-bottom: 1px solid #62bca0; }
</style>
