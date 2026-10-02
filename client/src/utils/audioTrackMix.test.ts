import { describe, expect, it } from 'vitest'
import type { AudioSegment, Track } from '@/types'
import { audibleSegments } from './audioTrackMix'

function track(id: string, patch: Partial<Track> = {}): Track {
  return {
    id, name: id, color: '#fff', segments: [id], sourceFile: id,
    sampleRate: 44100, totalSamples: 44100, f0Cache: null, f0Pending: 0, f0Total: 0,
    collapsed: false, muted: false, solo: false, volume: 1, ignored: false,
    boundCompGroupId: null, ...patch,
  }
}

function segment(id: string, patch: Partial<AudioSegment> = {}): AudioSegment {
  return {
    id, trackId: id, sourceFile: id, srcStartSample: 0, srcEndSample: 44100,
    timelineStart: 0, timelineEnd: 1, f0Data: null, f0Extracted: false,
    color: '#fff', ignored: false, ...patch,
  }
}

describe('audibleSegments', () => {
  const segments = ['a', 'b', 'c'].map(id => segment(id))
  const order = ['a', 'b', 'c']

  it('includes unmuted tracks at their configured volume', () => {
    const tracks: Record<string, Track> = { a: track('a', { volume: 0.25 }), b: track('b', { muted: true }), c: track('c') }
    const result = audibleSegments(segments, tracks, order)
    expect(result.map(seg => seg.id)).toEqual(['a', 'c'])
    expect(tracks[result[0]!.trackId]?.volume).toBe(0.25)
  })

  it('exports only solo tracks, excluding a muted solo track', () => {
    const tracks = { a: track('a'), b: track('b', { solo: true }), c: track('c', { solo: true, muted: true }) }
    expect(audibleSegments(segments, tracks, order).map(seg => seg.id)).toEqual(['b'])
  })

  it('respects ignored and collapsed tracks and ignored segments', () => {
    const tracks = { a: track('a', { ignored: true, solo: true }), b: track('b', { collapsed: true }), c: track('c') }
    expect(audibleSegments(segments, tracks, order).map(seg => seg.id)).toEqual(['c'])
    expect(audibleSegments([segment('c', { ignored: true })], tracks, order)).toEqual([])
    expect(audibleSegments([segment('missing')], tracks, order)).toEqual([])
  })

  it('applies the same rules to a selected subset', () => {
    const tracks = { a: track('a', { solo: true }), b: track('b'), c: track('c') }
    expect(audibleSegments(segments.slice(1), tracks, order)).toEqual([])
  })
})
