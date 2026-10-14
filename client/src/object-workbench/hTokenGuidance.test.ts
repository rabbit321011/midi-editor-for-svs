import { describe, expect, it } from 'vitest'
import { groupHTokenEvents, hTokenWeightColor } from './hTokenGuidance'
import type { SynthesisHTokenEvent } from './types'

const events: SynthesisHTokenEvent[] = [
  { id: 'a', tokenId: 32, frame: 0, guidanceWeight: 0.3, origin: 'user' },
  { id: 'b', tokenId: 30, frame: 2, guidanceWeight: 0.3, origin: 'user' },
  { id: 'default', tokenId: 56, frame: 4, origin: 'user' },
  { id: 'c', tokenId: 33, frame: 6, guidanceWeight: 0.3, origin: 'user' },
  { id: 'pul', tokenId: 366, frame: 7, origin: 'user' },
  { id: 'd', tokenId: 34, frame: 9, guidanceWeight: 0.3, origin: 'user' },
  { id: 'sep', tokenId: 365, frame: 11, origin: 'user' },
  { id: 'e', tokenId: 35, frame: 13, guidanceWeight: 0.3, origin: 'user' },
]
describe('H token grouping and markers', () => {
  it('groups by exact weight, or by adjacency across blank frames only', () => {
    const before = structuredClone(events)
    const ids = (mode: 'none' | 'same-weight' | 'adjacent') =>
      groupHTokenEvents([...events].reverse(), mode).map(group => group.map(event => event.id))
    expect(ids('none')).toEqual([['a'], ['b'], ['c'], ['d'], ['e']])
    expect(ids('same-weight')).toEqual([['a', 'b', 'c', 'd', 'e']])
    expect(ids('adjacent')).toEqual([['a', 'b'], ['c'], ['d'], ['e']])
    expect(events).toEqual(before)
  })
  it('keeps different negative weights separate and skips default weights', () => {
    const modified = events.slice(0, 3).map((event, i) => ({ ...event, guidanceWeight: i === 0 ? -1 : -0.1 }))
    expect(groupHTokenEvents(modified, 'same-weight').map(group => group.length)).toEqual([1, 2])
    expect(groupHTokenEvents([], 'adjacent')).toEqual([])
  })
  it('maps 0.1 to blue, 2 to red, and clamps values beyond the endpoints', () => {
    expect(hTokenWeightColor(0.1)).toBe('rgb(44, 125, 255)')
    expect(hTokenWeightColor(2)).toBe('rgb(255, 64, 74)')
    expect(hTokenWeightColor(-10)).toBe(hTokenWeightColor(0.1))
    expect(hTokenWeightColor(10)).toBe(hTokenWeightColor(2))
    expect(hTokenWeightColor(1)).not.toBe(hTokenWeightColor(0.1))
  })
})
