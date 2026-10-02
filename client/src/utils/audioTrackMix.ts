import type { AudioSegment, Track } from '@/types'

export function audibleSegments(
  segments: AudioSegment[],
  tracks: Record<string, Track>,
  trackOrder: string[],
): AudioSegment[] {
  const hasSolo = trackOrder.some(id => {
    const track = tracks[id]
    return track && !track.ignored && track.solo
  })
  return segments.filter(seg => {
    const track = tracks[seg.trackId]
    return !seg.ignored && !!track && !track.ignored && !track.collapsed
      && !track.muted && (!hasSolo || track.solo)
  })
}
