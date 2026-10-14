import assert from 'node:assert/strict'
import test from 'node:test'
import { getModelCatalog } from './model-catalog.service.js'

test('model catalog only exposes the managed SVS families', () => {
  const ids = new Set(getModelCatalog().map(item => item.id))
  for (const id of [
    'V4fg_10k',
    'V4Hg_10k',
    'V5P_40K_EMA',
    'V5Pg_20K',
    'V5PgO_8K',
    'V5Sg_40K_EMA',
    'V5PgOV_300K_EMA',
    'OpenVPI-SOME',
    'V5F_F1_3K_EMA',
    'V5F_F1_6K_EMA',
  ]) assert.equal(ids.has(id), true, id)
  for (const id of [
    'plus_ja_sft_v4c step24k',
    'V4H_24k',
    'V4H_30k',
    'V4PH',
    'V4iph_30k',
    'v4ijph_30k',
    'V4Sf_30k',
  ]) assert.equal(ids.has(id), false, id)
})

test('catalog keeps PH/PUL and direct-control engines distinct', () => {
  const catalog = new Map(getModelCatalog().map(item => [item.id, item]))
  assert.equal(catalog.get('V4Hg_10k')?.engine, 'v4h_phone_pul')
  assert.equal(catalog.get('V4fg_10k')?.engine, 't1')
  assert.equal(catalog.get('V5P_40K_EMA')?.engine, 'v5p_direct')
  assert.equal(catalog.get('V5Pg_20K')?.engine, 'v5p_direct')
  assert.equal(catalog.get('V5PgO_8K')?.engine, 'v5p_direct')
  assert.equal(catalog.get('V5PgO_8K')?.runtimeState, 'configured')
  assert.equal(catalog.get('V5PgOV_300K_EMA')?.engine, 'v5p_direct')
  assert.equal(catalog.get('V5PgOV_300K_EMA')?.runtimeState, 'configured')
  assert.equal(Array.isArray(catalog.get('V5PgO_8K')?.vramProfile?.samples), true)
  assert.equal(catalog.get('V5P_40K_EMA')?.hidden, true)
  assert.notEqual(catalog.get('V5PgO_8K')?.hidden, true)
  assert.equal(catalog.get('V5Sg_40K_EMA')?.runtimeState, 'configured')
  assert.equal(catalog.get('V5Sg_40K_EMA')?.capabilities.includes('guide-some'), true)
  assert.equal(catalog.get('V5Sg_40K_EMA')?.capabilities.includes('multi-reference'), true)
  assert.equal(catalog.get('V5Sg_40K_EMA')?.capabilities.includes('midi-p'), false)
  assert.notEqual(catalog.get('V5Sg_40K_EMA')?.hidden, true)
  assert.equal(catalog.get('V5F_F1_3K_EMA')?.engine, 'v5f_lora')
  assert.equal(catalog.get('V5F_F1_6K_EMA')?.runtimeState, 'configured')
})
