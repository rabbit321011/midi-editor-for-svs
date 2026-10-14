import type { ProjectObjectTree, SynthesisUnitObjectNode } from './types'
import { buildNodeIndex } from './objectTree'
import { V5P_DEFAULT_MODEL, supportsMultiReferenceModel } from './v5pModel'

export const MAX_A_REFERENCES = 16
export function additionalReferences(unit: SynthesisUnitObjectNode) {
  const config = unit.synthesisUnit.multiReference
  return config?.additionalReferences ?? (config?.secondaryUnitId
    ? [{ unitId: config.secondaryUnitId, cfg: config.secondaryCfg }] : [])
}

export function canBindPrimaryReference(tree: ProjectObjectTree, unitId: string, referenceId: string) {
  const nodes = buildNodeIndex(tree.root).nodes
  const target = nodes[unitId]
  const reference = nodes[referenceId]
  if (target?.kind !== 'synthesisUnit' || reference?.kind !== 'synthesisUnit') return { ok: false, reason: '合成单元不存在' }
  if (unitId === referenceId) return { ok: false, reason: '合成单元不能绑定自身作为 A 区参考' }
  if (target.synthesisUnit.reference?.unitId === referenceId) return { ok: false, reason: '已经绑定该 A 区参考' }
  if (target.synthesisUnit.multiReference?.enabled
    && additionalReferences(target).some(source => source.unitId === referenceId)) return { ok: false, reason: '参考不能重复' }
  return referenceCyclePolicy(tree, unitId, referenceId)
}

export function referenceCyclePolicy(tree: ProjectObjectTree, unitId: string, referenceId: string) {
  const nodes = buildNodeIndex(tree.root).nodes
  const visited = new Set<string>()
  const active = new Set<string>()
  const visit = (id: string): boolean => {
    if (id === unitId || active.has(id)) return true
    if (visited.has(id)) return false
    const node = nodes[id]
    if (node?.kind !== 'synthesisUnit') return false
    active.add(id)
    const references = [node.synthesisUnit.reference?.unitId,
      ...(node.synthesisUnit.multiReference?.enabled ? additionalReferences(node).map(source => source.unitId) : [])]
    if (references.some(next => next && visit(next))) return true
    active.delete(id)
    visited.add(id)
    return false
  }
  return visit(referenceId) ? { ok: false, reason: '该绑定会形成合成单元循环引用' } : { ok: true }
}

export function bindPrimaryReference(tree: ProjectObjectTree, unitId: string, referenceId: string, now = new Date().toISOString()) {
  const policy = canBindPrimaryReference(tree, unitId, referenceId)
  if (!policy.ok) return policy
  const unit = buildNodeIndex(tree.root).nodes[unitId] as SynthesisUnitObjectNode
  unit.synthesisUnit.reference = {
    unitId: referenceId, audioSource: 'guide', range: 'full-guide',
    revisionPolicy: 'follow-latest', boundAt: now,
  }
  unit.synthesisUnit.unitRevision++
  unit.synthesisUnit.updatedAt = now
  return { ok: true }
}

export function configureMultiReference(
  tree: ProjectObjectTree, unitId: string,
  patch: Partial<NonNullable<SynthesisUnitObjectNode['synthesisUnit']['multiReference']>>,
) {
  const nodes = buildNodeIndex(tree.root).nodes
  const unit = nodes[unitId]
  if (unit?.kind !== 'synthesisUnit') return { ok: false, reason: '合成单元不存在' }
  const previous = unit.synthesisUnit.multiReference
  const next = { enabled: false, secondaryUnitId: null, secondaryCfg: -1, ...previous, ...patch }
  if (patch.additionalReferences === undefined && (patch.secondaryUnitId !== undefined || patch.secondaryCfg !== undefined)
    && next.additionalReferences) {
    next.additionalReferences = next.secondaryUnitId ? [{ unitId: next.secondaryUnitId, cfg: next.secondaryCfg }, ...next.additionalReferences.slice(1)] : next.additionalReferences.slice(1)
  }
  if (!Number.isFinite(next.secondaryCfg) || next.secondaryCfg < -1 || next.secondaryCfg > 10) return { ok: false, reason: 'A2 CFG 必须在 -1 到 10 之间' }
  if (next.enabled && !supportsMultiReferenceModel(unit.synthesisUnit.presetId ?? V5P_DEFAULT_MODEL)) return { ok: false, reason: '当前仅 PgO / Sg 支持多 A' }
  const sources = next.additionalReferences ?? (next.secondaryUnitId ? [{ unitId: next.secondaryUnitId, cfg: next.secondaryCfg }] : [])
  if (sources.length >= MAX_A_REFERENCES) return { ok: false, reason: `最多 ${MAX_A_REFERENCES} 个参考` }
  if (next.enabled || patch.additionalReferences !== undefined || patch.secondaryUnitId !== undefined) {
    const ids = new Set([unit.synthesisUnit.reference?.unitId])
    for (const source of sources) {
      if (!Number.isFinite(source.cfg) || source.cfg < -1 || source.cfg > 10) return { ok: false, reason: 'A CFG 必须在 -1 到 10 之间' }
      if (nodes[source.unitId]?.kind !== 'synthesisUnit') return { ok: false, reason: '参考不存在' }
      if (ids.has(source.unitId)) return { ok: false, reason: '参考不能重复' }
      ids.add(source.unitId)
      const policy = referenceCyclePolicy(tree, unitId, source.unitId)
      if (!policy.ok) return policy
    }
  }
  if (next.additionalReferences) {
    next.secondaryUnitId = sources[0]?.unitId ?? null
    next.secondaryCfg = sources[0]?.cfg ?? -1
  }
  const changed = previous?.enabled !== next.enabled || JSON.stringify(additionalReferences(unit).map(source => source.unitId)) !== JSON.stringify(sources.map(source => source.unitId))
  unit.synthesisUnit.multiReference = next
  if (changed) unit.synthesisUnit.unitRevision++
  unit.synthesisUnit.updatedAt = new Date().toISOString()
  return { ok: true }
}

export function removeReference(tree: ProjectObjectTree, unitId: string, referenceId: string) {
  const nodes = buildNodeIndex(tree.root).nodes
  const unit = nodes[unitId]
  if (unit?.kind !== 'synthesisUnit') return { ok: false, reason: '合成单元不存在' }
  const sources = unit.synthesisUnit.multiReference?.enabled ? additionalReferences(unit) : []
  if (unit.synthesisUnit.reference?.unitId !== referenceId) {
    return configureMultiReference(tree, unitId, { additionalReferences: sources.filter(source => source.unitId !== referenceId) })
  }
  const next = sources[0]
  const now = new Date().toISOString()
  unit.synthesisUnit.reference = next
    ? { unitId: next.unitId, audioSource: 'guide', range: 'full-guide', revisionPolicy: 'follow-latest', boundAt: now } : null
  if (next && unit.synthesisUnit.samplingSettings?.guidance.mode === 'three-way') unit.synthesisUnit.samplingSettings.guidance.audio = next.cfg
  const result = configureMultiReference(tree, unitId, { additionalReferences: sources.slice(1) })
  unit.synthesisUnit.unitRevision++
  unit.synthesisUnit.updatedAt = now
  return result
}
