<script setup lang="ts">
import { NButton, NTag } from 'naive-ui'
defineProps<{
  title: string
  input: { displayName: string; kind: string } | null
  disabled?: boolean
  error?: string
}>()
const emit = defineEmits<{ pick: []; clear: []; drop: [event: DragEvent] }>()
function allowDrop(event: DragEvent) {
  event.preventDefault()
  if (event.dataTransfer) event.dataTransfer.dropEffect = 'copy'
}
</script>

<template>
  <div class="slot-row" @dragover="allowDrop" @drop.prevent="emit('drop', $event)">
    <div class="slot-title">{{ title }}</div>
    <n-tag size="small" :bordered="false" :title="input?.displayName">{{ input ? `${input.kind}: ${input.displayName}` : '未选择' }}</n-tag>
    <div class="slot-actions">
      <n-button size="tiny" :disabled="disabled" @click="emit('pick')">放入</n-button>
      <n-button size="tiny" :disabled="!input || disabled" @click="emit('clear')">清空</n-button>
    </div>
    <div v-if="input && error" class="slot-error">{{ error }}</div>
  </div>
</template>

<style scoped>
.slot-row { display: grid; grid-template-columns: minmax(0, 1fr) auto; gap: 6px; align-items: center; border: 1px solid transparent; border-radius: 4px; padding: 4px; }
.slot-row:hover { border-color: var(--app-border); }
.slot-row :deep(.n-tag) { min-width: 0; max-width: 100%; overflow: hidden; }
.slot-row :deep(.n-tag__content) { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.slot-title { grid-column: 1 / -1; font-size: 11px; color: var(--app-muted); }
.slot-actions { display: flex; gap: 4px; }
.slot-error { grid-column: 1 / -1; font-size: 11px; color: var(--app-warning); }
</style>
