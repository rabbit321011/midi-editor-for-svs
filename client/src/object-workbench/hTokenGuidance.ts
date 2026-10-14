import type { HTokenMergeMode, SynthesisHTokenEvent } from './types'

export function groupHTokenEvents(events: SynthesisHTokenEvent[], mode: HTokenMergeMode): SynthesisHTokenEvent[][] {
  const groups: SynthesisHTokenEvent[][] = []
  const byWeight = new Map<number, SynthesisHTokenEvent[]>()
  let previous: SynthesisHTokenEvent[] | undefined
  for (const event of [...events].sort((a, b) => a.frame - b.frame)) {
    if (event.tokenId === 0) continue
    const weight = event.guidanceWeight ?? 1
    if (event.tokenId >= 364 || weight === 1) { previous = undefined; continue }
    const group = mode === 'same-weight' ? byWeight.get(weight)
      : mode === 'adjacent' && previous?.[0].guidanceWeight === weight ? previous : undefined
    if (group) group.push(event)
    else {
      previous = [event]
      groups.push(previous)
      byWeight.set(weight, previous)
    }
  }
  return groups
}

export function hTokenWeightColor(weight: number): string {
  const ratio = Math.max(0, Math.min(1, (weight - 0.1) / 1.9))
  const start = [44, 125, 255], end = [255, 64, 74]
  return `rgb(${start.map((value, index) => Math.round(value + (end[index] - value) * ratio)).join(', ')})`
}
