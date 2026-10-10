<script setup lang="ts">
import type { Directive } from 'vue'
import { NButton, NDropdown, NIcon, NSlider } from 'naive-ui'
import { CloseOutline, OpenOutline, Pause, Play, UnlinkOutline } from '@vicons/ionicons5'

defineProps<{
  references: Array<{ id: string; name: string; cfg: number; status: string; warning: boolean; playable: boolean }>
  options: Array<{ label: string; key: string; disabled?: boolean }>
  busy: boolean
  playingId: string | null
}>()
const emit = defineEmits<{
  select: [index: number, id: string]
  cfg: [id: string, value: number]
  remove: [id: string]
  play: [index: number]
  open: [id: string]
  unbind: [id: string]
}>()
const vSliderLabel: Directive<HTMLElement, string> = {
  mounted: (element, binding) => element.querySelector('[role="slider"]')?.setAttribute('aria-label', binding.value),
  updated: (element, binding) => element.querySelector('[role="slider"]')?.setAttribute('aria-label', binding.value),
}
function scrollReferences(event: WheelEvent) {
  const element = event.currentTarget as HTMLElement
  if (event.ctrlKey || element.scrollWidth <= element.clientWidth) return
  event.preventDefault()
  element.scrollLeft += (event.deltaX || event.deltaY) * (event.deltaMode === 1 ? 20 : 1)
}
</script>

<template>
  <div class="reference-bars" :style="{ '--reference-count': Math.max(1, references.length) }" @wheel="scrollReferences">
    <article v-for="(reference, index) in references" :key="reference.id" class="reference-bar">
      <div class="reference-bar-top">
        <NDropdown trigger="click" :options="options" :disabled="busy" @select="emit('select', index, String($event))">
          <button type="button" class="reference-name" :title="reference.name" :disabled="busy">{{ reference.name }}</button>
        </NDropdown>
        <span class="reference-status" :class="{ warning: reference.warning }" :title="reference.status">{{ reference.status }}</span>
        <NButton quaternary circle size="tiny" :disabled="!reference.playable" :title="playingId === reference.id ? '暂停参考' : '试听参考'" @click="emit('play', index)">
          <template #icon><NIcon><Pause v-if="playingId === reference.id" /><Play v-else /></NIcon></template>
        </NButton>
        <NButton quaternary circle size="tiny" :title="`打开 ${reference.name}`" @click="emit('open', reference.id)">
          <template #icon><NIcon><OpenOutline /></NIcon></template>
        </NButton>
        <NButton quaternary circle size="tiny" title="解除参考绑定" :disabled="busy" @click="emit('unbind', reference.id)">
          <template #icon><NIcon><UnlinkOutline /></NIcon></template>
        </NButton>
        <NButton quaternary circle size="tiny" :title="`移除 ${reference.name}`" :disabled="busy" @click="emit('remove', reference.id)">
          <template #icon><NIcon><CloseOutline /></NIcon></template>
        </NButton>
      </div>
      <div class="reference-cfg">
        <NSlider :value="reference.cfg" :min="-1" :max="10" :step="0.1" :disabled="busy"
          v-slider-label="`A${index + 1} CFG`" @update:value="emit('cfg', reference.id, $event)" />
        <span :title="`CFG ${reference.cfg.toFixed(1)} · 系数 ${(1 + reference.cfg).toFixed(1)}`">{{ reference.cfg.toFixed(1) }}</span>
      </div>
    </article>
    <div v-if="!references.length" class="reference-empty"><slot /></div>
  </div>
</template>

<style scoped>
.reference-bars { flex: 1; min-width: 0; display: grid; grid-auto-flow: column; grid-auto-columns: max(210px, calc((100% - (var(--reference-count) - 1) * 6px) / var(--reference-count))); gap: 6px; overflow-x: auto; overflow-y: hidden; scrollbar-width: thin; scrollbar-color: var(--app-border) transparent; padding-bottom: 3px; }
.reference-bars:has(.reference-bar:only-child) { grid-auto-columns: minmax(0, 1fr); }
.reference-bars::-webkit-scrollbar { height: 5px; }
.reference-bars::-webkit-scrollbar-track { background: transparent; }
.reference-bars::-webkit-scrollbar-thumb { border-radius: 3px; background: var(--app-border); }
.reference-bars::-webkit-scrollbar-thumb:hover { background: var(--app-muted); }
.reference-bar { min-width: 0; height: 35px; display: grid; grid-template-rows: 20px 15px; border-left: 2px solid var(--app-accent); padding: 0 3px 0 5px; container-type: inline-size; }
.reference-empty { display: flex; gap: 6px; align-items: center; min-width: 0; }
.reference-bar-top { display: flex; gap: 2px; align-items: center; min-width: 0; }
.reference-name { flex: 1; min-width: 0; padding: 0; border: 0; background: transparent; text-align: left; color: var(--app-text); font: inherit; font-size: 11px; font-weight: 600; overflow: hidden; white-space: nowrap; text-overflow: ellipsis; }
.reference-name:hover { color: var(--app-accent); }
.reference-status { flex: 0 1 auto; font-size: 9px; color: var(--app-accent); overflow: hidden; white-space: nowrap; text-overflow: ellipsis; }
.reference-status.warning { color: var(--app-warning); }
.reference-cfg { display: flex; min-width: 0; align-items: center; gap: 7px; padding-right: 3px; }
.reference-cfg :deep(.n-slider) { flex: 1; min-width: 0; }
.reference-cfg > span { flex: 0 0 28px; text-align: right; font: 9px ui-monospace, monospace; color: var(--app-muted); }
@container (max-width: 260px) { .reference-status { flex: 0 0 5px; width: 5px; height: 5px; border-radius: 50%; font-size: 0; background: var(--app-accent); } .reference-status.warning { background: var(--app-warning); } .reference-bar-top :deep(.n-button) { width: 18px; height: 18px; } }
</style>
