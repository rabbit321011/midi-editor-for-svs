import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { UiPreferencesRepository } from './ui-preferences.service.js'

test('romaji is off by default and survives repository restart', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'aisvc-ui-preferences-'))
  try {
    const file = path.join(directory, 'preferences.json')
    const first = new UiPreferencesRepository(file)
    assert.deepEqual(first.read(), { showRomaji: false })
    first.write({ showRomaji: true })
    assert.deepEqual(new UiPreferencesRepository(file).read(), { showRomaji: true })
    assert.throws(() => first.write({ showRomaji: 'false' }), /布尔值/)
    assert.equal(first.read().showRomaji, true)
    first.write({ showRomaji: false })
    assert.equal(new UiPreferencesRepository(file).read().showRomaji, false)
  } finally { fs.rmSync(directory, { recursive: true, force: true }) }
})
