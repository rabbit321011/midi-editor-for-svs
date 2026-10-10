import { describe, expect, it } from 'vitest'
import { createEmptyProjectObjectTree } from './objectTree'
import { createEmptySynthesisUnit } from './synthesisUnit'
import { createMultipleSynthesisMaterialSnapshot, createMultiSynthesisMaterialSnapshot, createSynthesisMaterialSnapshot } from './synthesisMaterialSnapshot'
import { additionalReferences, bindPrimaryReference, configureMultiReference, referenceCyclePolicy, removeReference } from './synthesisMultiReference'
import type { SynthesisUnitObjectNode } from './types'

function unit(id: string, frames: number): SynthesisUnitObjectNode {
  const value = createEmptySynthesisUnit({
    id, name: id, defaultTimelineStart: null,
    guide: { assetId: `asset:${id}`, audioSHA256: 'a'.repeat(64), sampleRate: 44100, channels: 1,
      sampleCount: frames * 2048, duration: frames * 2048 / 44100,
      source: { sourceAudioObjectId: 'source', sourceAssetId: 'source-asset', effectiveStartSample: 0,
        effectiveEndSampleExclusive: frames * 2048, sourceTimelineStart: null, resolverManifest: 'test' } },
  })
  value.synthesisUnit.hTokenTrack = {
    ...value.synthesisUnit.hTokenTrack, status: 'ready',
    events: [{ id: `${id}:h`, frame: 0, tokenId: 46, origin: 'user' },
      { id: `${id}:sep`, frame: frames - 1, tokenId: 365, origin: 'user' }],
  }
  value.synthesisUnit.midiPTokenTrack = { ...value.synthesisUnit.midiPTokenTrack, status: 'ready', classes: Array(frames).fill(120) }
  return value
}

describe('PgO dual reference', () => {
  it('adds multiple references and promotes the next reference when removing A1', () => {
    const tree = createEmptyProjectObjectTree()
    const a = unit('a', 8), c = unit('c', 16), d = unit('d', 24), b = unit('b', 12)
    tree.root.children.push(a, b, c, d)
    bindPrimaryReference(tree, 'b', 'a')
    const result = configureMultiReference(tree, 'b', { enabled: true,
      additionalReferences: [{ unitId: 'c', cfg: 0.2 }, { unitId: 'd', cfg: 0.3 }] })
    expect(result.ok).toBe(true)
    const snapshot = createMultipleSynthesisMaterialSnapshot([{ unit: a, cfg: -0.7 }, { unit: c, cfg: 0.2 }, { unit: d, cfg: 0.3 }], b)
    expect(snapshot.reference.unitId).toBe('d')
    expect(snapshot.multiA?.references.map(source => source.leadingPadFrames)).toEqual([16, 8, 0])
    expect(removeReference(tree, 'b', 'a').ok).toBe(true)
    expect(b.synthesisUnit.reference?.unitId).toBe('c')
    expect(b.synthesisUnit.samplingSettings?.guidance.mode === 'three-way' && b.synthesisUnit.samplingSettings.guidance.audio).toBe(0.2)
    expect(additionalReferences(b)).toEqual([{ unitId: 'd', cfg: 0.3 }])
    expect(removeReference(tree, 'b', 'd').ok).toBe(true)
    expect(additionalReferences(b)).toEqual([])
    expect(removeReference(tree, 'b', 'c').ok).toBe(true)
    expect(b.synthesisUnit.reference).toBeNull()
  })
  it('uses the longest reference anchor while preserving both original controls', () => {
    const a = unit('a', 8), a2 = unit('a2', 16), b = unit('b', 12)
    b.synthesisUnit.reference = { unitId: 'a', audioSource: 'guide', range: 'full-guide', revisionPolicy: 'follow-latest', boundAt: '2026-10-05T00:00:00Z' }
    const before = JSON.stringify([a, a2, b])
    const snapshot = createMultiSynthesisMaterialSnapshot(a, a2, b, -0.7, 0.2)
    expect(snapshot.reference.unitId).toBe('a2')
    expect(snapshot.multiA?.primaryUnitId).toBe('a')
    expect(snapshot.multiA?.references.map(source => source.leadingPadFrames)).toEqual([8, 0])
    expect(snapshot.multiA?.references.map(source => source.audioCfg)).toEqual([-0.7, 0.2])
    expect(JSON.stringify([a, a2, b])).toBe(before)
    expect(createSynthesisMaterialSnapshot(a, b).multiA).toBeUndefined()
  })

  it('keeps disabled configuration optional and rejects duplicate/self/cyclic references', () => {
    const tree = createEmptyProjectObjectTree()
    const a = unit('a', 8), a2 = unit('a2', 16), b = unit('b', 12)
    tree.root.children.push(a, a2, b)
    expect(bindPrimaryReference(tree, 'b', 'a').ok).toBe(true)
    expect(configureMultiReference(tree, 'b', { enabled: true, secondaryUnitId: 'a2', secondaryCfg: 0.2 }).ok).toBe(true)
    const saved = JSON.parse(JSON.stringify(tree))
    expect(saved.root.children.find((node: any) => node.id === 'b').synthesisUnit.multiReference.secondaryCfg).toBe(0.2)
    expect(configureMultiReference(tree, 'b', { secondaryUnitId: 'a' }).ok).toBe(false)
    expect(configureMultiReference(tree, 'b', { secondaryUnitId: 'b' }).ok).toBe(false)
    expect(referenceCyclePolicy(tree, 'a2', 'b').ok).toBe(false)
    expect(configureMultiReference(tree, 'b', { secondaryCfg: NaN }).ok).toBe(false)
    expect(configureMultiReference(tree, 'b', { enabled: false }).ok).toBe(true)
    expect(b.synthesisUnit.reference?.unitId).toBe('a')
    expect(b.synthesisUnit.multiReference?.secondaryUnitId).toBe('a2')
  })
})
