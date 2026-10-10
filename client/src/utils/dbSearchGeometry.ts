export interface DbPoint {
  id: string
  rank: number
  name: string
  text: string
  duration: number
  distance: number
  cosine: number
  x: number
  y: number
  short: boolean
}

export function dbPointPosition(point: DbPoint, strict: boolean): { x: number; y: number } {
  if (!strict) return { x: point.x, y: point.y }
  if (point.distance === 0) return { x: 0, y: 0 }
  const length = Math.hypot(point.x, point.y)
  const angle = length > 1e-12 ? Math.atan2(point.y, point.x) : point.rank * Math.PI * (3 - Math.sqrt(5))
  return { x: point.distance * Math.cos(angle), y: point.distance * Math.sin(angle) }
}
