import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { DbSearchSettingsRepository } from './db-search.service.js'

test('DB paths are explicit, persisted, and unrelated to UI preference files', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'aisvc-db-settings-'))
  try {
    const repo = new DbSearchSettingsRepository(path.join(root, 'settings.json'))
    assert.deepEqual(repo.read(), { vectorLibraryPath: '', audioLibraryPath: '' })
    assert.throws(() => repo.write({ vectorLibraryPath: 'relative', audioLibraryPath: root }))
    fs.writeFileSync(path.join(root, 'MODEL_REGISTRY.json'), '{}')
    const value = { vectorLibraryPath: root, audioLibraryPath: root }
    assert.deepEqual(repo.write(value), value)
    assert.deepEqual(repo.read(), value)
    assert.throws(() => repo.write({ vectorLibraryPath: root }))
  } finally { fs.rmSync(root, { recursive: true, force: true }) }
})
