import { describe, expect, it } from 'vitest'
import { createEmptyProjectObjectTree, createEmptySynthesisUnit } from '@/object-workbench'
import { resolveDbSearchAudio } from './dbSearchInput'

describe('DB query input', () => {
  it('uses the owned Guide, never an active Take, for both SYN and its timeline reference', async () => {
    const tree = createEmptyProjectObjectTree()
    const unit = createEmptySynthesisUnit({
      id: 'syn', name: 'SYN', defaultTimelineStart: null,
      guide: { assetId: 'guide', audioSHA256: 'hash', sampleRate: 44100, channels: 1, sampleCount: 44100, duration: 1,
        source: { sourceAudioObjectId: 'audio', sourceAssetId: 'source', effectiveStartSample: 0, effectiveEndSampleExclusive: 44100, sourceTimelineStart: null, resolverManifest: '' } },
    })
    const guide = new Blob(['GUIDE'])
    tree.assets.guide = { id: 'guide', blobKey: 'guide.wav', storage: 'projectBlob', sampleRate: 44100, channels: 1, duration: 1 }
    const track = { id: 'track', name: 'SYN track', kind: 'trackObject' as const, trackObject: { contentType: 'audio' as const, sourceObjectId: 'syn', timelineStart: 0, timelineEnd: 1, ignored: false } }
    const options = { tree, nodes: { syn: unit, track }, sourceBlobs: new Map([['guide.wav', guide], ['take.wav', new Blob(['TAKE'])]]), segments: {}, tracks: {} }
    expect(await resolveDbSearchAudio({ ...options, node: unit })).toBe(guide)
    expect(await resolveDbSearchAudio({ ...options, node: track })).toBe(guide)
  })
})
