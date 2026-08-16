import assert from 'node:assert/strict'
import test from 'node:test'
import {
  getV5PRuntimeStatus,
  isV5PRuntimeReady,
  unloadAllModelRuntimes,
  unloadV5PRuntime,
} from './model-runtime.service.js'

test('unloaded V5-P runtime is reported without a worker', () => {
  const status = getV5PRuntimeStatus()
  assert.equal(status.id, 'V5P_40K_EMA')
  assert.equal(status.state, 'unloaded')
  assert.equal(status.pid, undefined)
  assert.equal(isV5PRuntimeReady(), false)
  const pg = getV5PRuntimeStatus('V5Pg_20K')
  assert.equal(pg.id, 'V5Pg_20K')
  assert.equal(pg.state, 'unloaded')
})

test('releasing an already unloaded runtime is not a release-all failure', async () => {
  assert.equal((await unloadV5PRuntime()).ok, false)
  const result = await unloadAllModelRuntimes()
  assert.deepEqual(result, { released: [], failed: [] })
})
