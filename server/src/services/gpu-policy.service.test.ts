import assert from 'node:assert/strict'
import test from 'node:test'
import { chooseEvictions, estimateGpuMemory, evictionOrder } from './gpu-policy.service.js'
import type { ModelRuntimeStatus } from './model-runtime.service.js'

test('duration estimate uses the next larger calibrated sample and falls back to max', () => {
  const short = estimateGpuMemory('V5P_40K_EMA', 35)
  assert.equal(short.sampleSeconds, 60)
  const beyond = estimateGpuMemory('V5P_40K_EMA', 500)
  assert.equal(beyond.sampleSeconds, 60)
})

test('V5PgO reuses the compatible V5-P peak profile', () => {
  const baseline = estimateGpuMemory('V5P_40K_EMA', 35)
  const pgo = estimateGpuMemory('V5PgO_8K', 35)
  assert.equal(pgo.modelId, 'V5PgO_8K')
  assert.equal(pgo.sampleSeconds, baseline.sampleSeconds)
  assert.equal(pgo.peakDeltaMiB, baseline.peakDeltaMiB)
  assert.equal(Number.isFinite(pgo.residentMiB), true)
})

test('Sg uses an explicitly unmeasured conservative profile rather than claiming a Pg measurement', () => {
  const pg = estimateGpuMemory('V5PgO_8K', 35)
  const sg = estimateGpuMemory('V5Sg_40K_EMA', 35, 'three-way', 2)
  assert.equal(sg.modelId, 'V5Sg_40K_EMA')
  assert.equal(sg.profilePolicy, 'conservative-unmeasured')
  assert.ok(sg.peakDeltaMiB > pg.peakDeltaMiB)
  assert.equal(sg.referenceCount, 2)
})

test('V5PgOV uses the compatible V5-P peak profile', () => {
  const baseline = estimateGpuMemory('V5P_40K_EMA', 35)
  const pgov = estimateGpuMemory('V5PgOV_300K_EMA', 35)
  assert.equal(pgov.modelId, 'V5PgOV_300K_EMA')
  assert.equal(pgov.sampleSeconds, baseline.sampleSeconds)
  assert.equal(pgov.peakDeltaMiB, baseline.peakDeltaMiB)
})

test('three-way CFG keeps sequential peak estimate and reports its time factor', () => {
  const unified = estimateGpuMemory('V5P_40K_EMA', 35, 'unified')
  const threeWay = estimateGpuMemory('V5P_40K_EMA', 35, 'three-way')
  assert.equal(threeWay.peakDeltaMiB, unified.peakDeltaMiB)
  assert.equal(threeWay.guidanceMode, 'three-way')
  assert.equal(threeWay.estimatedTimeFactor, 2)
  assert.equal(threeWay.profilePolicy, 'sequential-branch-peak')
})

test('dual A reports sequential eight-branch time without doubling the peak batch', () => {
  const single = estimateGpuMemory('V5PgO_8K', 45, 'three-way', 1)
  const dual = estimateGpuMemory('V5PgO_8K', 45, 'three-way', 2)
  assert.equal(dual.peakDeltaMiB, single.peakDeltaMiB)
  assert.equal(dual.referenceCount, 2)
  assert.equal(dual.estimatedTimeFactor, 4)
  assert.throws(() => estimateGpuMemory('V5PgO_8K', 45, 'three-way', 17), /referenceCount/)
})

test('eviction order excludes the active model and sorts by last use', () => {
  const runtimes: ModelRuntimeStatus[] = [
    runtime('V4fg_10k', '2026-08-12T10:00:00Z'),
    runtime('V4Hg_10k', '2026-08-12T11:00:00Z'),
    runtime('V5P_40K_EMA', '2026-08-12T09:00:00Z'),
  ]
  const order = evictionOrder(runtimes, 'V5P_40K_EMA')
  assert.deepEqual(order.map(item => item.modelId), ['V4fg_10k', 'V4Hg_10k'])
})

test('chooseEvictions keeps evicting until enough memory is available', () => {
  const runtimes: ModelRuntimeStatus[] = [
    { ...runtime('V4fg_10k', '2026-08-12T10:00:00Z'), residentMiB: 2810 },
    { ...runtime('V4Hg_10k', '2026-08-12T11:00:00Z'), residentMiB: 2810 },
  ]
  const evicted = chooseEvictions(runtimes, 'V5P_40K_EMA', 6000, 1000)
  assert.deepEqual(evicted.map(item => item.modelId), ['V4fg_10k', 'V4Hg_10k'])
  const one = chooseEvictions(runtimes, 'V5P_40K_EMA', 3500, 1000)
  assert.deepEqual(one.map(item => item.modelId), ['V4fg_10k'])
})

function runtime(modelId: string, lastUsedAt: string): ModelRuntimeStatus {
  return {
    id: modelId,
    modelId,
    device: 'cuda:0',
    state: 'ready',
    lastUsedAt,
  }
}
