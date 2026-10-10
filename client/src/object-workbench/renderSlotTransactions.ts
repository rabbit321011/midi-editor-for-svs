import type { ProjectObjectTree } from './types'
import { buildNodeIndex } from './objectTree'
import { makeRenderInputRef, validateRenderSlot, type RenderInputRef, type RenderSlotId } from './renderInputs'

export interface RenderSlotTargets {
  svc: { condAudio: RenderInputRef | null; sourceAudio: RenderInputRef | null }
  svs: { timbreAudio: RenderInputRef | null; melody: RenderInputRef | null; refText: RenderInputRef | null; targetText: RenderInputRef | null }
  whisper: { audio: RenderInputRef | null }
  msst: { audio: RenderInputRef | null }
  db: { inputId: string | null }
}

export function resolveRenderSlotNode(tree: ProjectObjectTree, slotId: RenderSlotId, id: string):
  { ok: true; input: RenderInputRef } | { ok: false; reason: string } {
  const node = buildNodeIndex(tree.root).nodes[id]
  if (!node) return { ok: false, reason: '原对象不存在' }
  const acceptsAudio = ['svc.condAudio', 'svs.timbreAudio', 'whisper.audio', 'msst.audio', 'db.audio'].includes(slotId)
  if (node.kind !== 'trackObject' && node.kind !== 'group'
    && !(acceptsAudio && node.kind === 'audio') && !(slotId === 'db.audio' && node.kind === 'synthesisUnit')) {
    return { ok: false, reason: slotId === 'db.audio' ? 'DB 只接受 AudioObject/TrackObject/GroupObject/SYN'
      : acceptsAudio ? '该槽位只接受 AudioObject/TrackObject/GroupObject' : '槽位只接受 TrackObject 或 GroupObject' }
  }
  const kind = node.kind === 'synthesisUnit' ? 'synthesisUnit' : node.kind === 'audio' ? 'audioObject' : node.kind === 'group' ? 'group' : 'trackObject'
  const input = makeRenderInputRef(tree, kind, id)
  const validation = validateRenderSlot(tree, slotId, input)
  return validation.ok ? { ok: true, input } : { ok: false, reason: validation.reason || '槽位不可用' }
}

export function writeRenderSlotInput(targets: RenderSlotTargets, slotId: RenderSlotId, input: RenderInputRef | null) {
  if (slotId === 'svc.condAudio') targets.svc.condAudio = input
  if (slotId === 'svc.sourceAudio') targets.svc.sourceAudio = input
  if (slotId === 'svs.timbreAudio') targets.svs.timbreAudio = input
  if (slotId === 'svs.melody') targets.svs.melody = input
  if (slotId === 'svs.refText') targets.svs.refText = input
  if (slotId === 'svs.targetText') targets.svs.targetText = input
  if (slotId === 'whisper.audio') targets.whisper.audio = input
  if (slotId === 'msst.audio') targets.msst.audio = input
  if (slotId === 'db.audio') targets.db.inputId = input?.id ?? null
}

// UI and store actions share the same transaction, including older live Pinia instances.
export function bindRenderSlotNode(tree: ProjectObjectTree, targets: RenderSlotTargets, slotId: RenderSlotId, id: string) {
  const result = resolveRenderSlotNode(tree, slotId, id)
  if (result.ok) writeRenderSlotInput(targets, slotId, result.input)
  return result
}
