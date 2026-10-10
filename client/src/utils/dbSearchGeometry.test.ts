import { describe, expect, it } from 'vitest'
import { dbPointPosition, type DbPoint } from './dbSearchGeometry'

const point: DbPoint = { id: 'one', rank: 1, name: 'one', text: '', duration: 2, distance: 0.4, cosine: 0.92, x: 3, y: 4, short: false }
describe('DB search projection', () => {
  it('restores exact high-dimensional radius while preserving angle', () => {
    const result = dbPointPosition(point, true)
    expect(Math.hypot(result.x, result.y)).toBeCloseTo(point.distance, 12)
    expect(result.x / result.y).toBeCloseTo(3 / 4, 12)
  })
  it('uses ordinary PCA coordinates when strict mode is off', () => {
    expect(dbPointPosition(point, false)).toEqual({ x: 3, y: 4 })
  })
  it('handles degenerate directions deterministically without altering radius', () => {
    const degenerate = { ...point, x: 0, y: 0 }
    expect(dbPointPosition(degenerate, true)).toEqual(dbPointPosition(degenerate, true))
    expect(Math.hypot(...Object.values(dbPointPosition(degenerate, true)))).toBeCloseTo(0.4, 12)
    expect(dbPointPosition({ ...degenerate, distance: 0 }, true)).toEqual({ x: 0, y: 0 })
  })
})
