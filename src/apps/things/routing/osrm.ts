import type { LatLng } from './geocode'

/**
 * Distance/duration matrix from the public OSRM demo server.
 *
 * That server has no SLA and is explicitly not for production load — our usage
 * is a handful of requests per shopping trip, well within courtesy, but the
 * haversine fallback below is load-bearing rather than decorative.
 */

const OSRM = 'https://router.project-osrm.org'
const TIMEOUT_MS = 5000

export interface Matrix {
  /** durations[i][j] in seconds */
  durations: number[][]
  /** distances[i][j] in metres */
  distances: number[][]
  source: 'osrm' | 'haversine'
}

/**
 * OSRM takes `lng,lat` — reversed from essentially every other API, and the
 * single most common way this integration breaks. This is the ONLY place
 * coordinates are serialised, and it is unit tested.
 */
export function toOsrmCoords(points: LatLng[]): string {
  return points.map((p) => `${p.lng},${p.lat}`).join(';')
}

interface TableResponse {
  code?: string
  durations?: number[][]
  distances?: number[][]
}

async function fetchTable(points: LatLng[]): Promise<Matrix | null> {
  const url = `${OSRM}/table/v1/driving/${toOsrmCoords(points)}?annotations=duration,distance`
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS)
  try {
    const res = await fetch(url, { signal: ctrl.signal })
    if (!res.ok) return null
    const json = (await res.json()) as TableResponse
    if (json.code !== 'Ok' || !json.durations || !json.distances) return null
    return {
      durations: json.durations,
      distances: json.distances,
      source: 'osrm',
    }
  } catch {
    return null
  } finally {
    clearTimeout(timer)
  }
}

const EARTH_R = 6_371_000
const toRad = (d: number) => (d * Math.PI) / 180

export function haversine(a: LatLng, b: LatLng): number {
  const dLat = toRad(b.lat - a.lat)
  const dLng = toRad(b.lng - a.lng)
  const s =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2
  return 2 * EARTH_R * Math.asin(Math.sqrt(s))
}

/** Straight-line distance underestimates driving; 1.35 is a decent city fudge. */
const CIRCUITY = 1.35
/** ~35 km/h average urban driving, for a rough duration. */
const SPEED_MPS = 9.7

export function haversineMatrix(points: LatLng[]): Matrix {
  const n = points.length
  const distances: number[][] = []
  const durations: number[][] = []
  for (let i = 0; i < n; i++) {
    distances[i] = []
    durations[i] = []
    for (let j = 0; j < n; j++) {
      const d = i === j ? 0 : haversine(points[i], points[j]) * CIRCUITY
      distances[i][j] = d
      durations[i][j] = d / SPEED_MPS
    }
  }
  return { distances, durations, source: 'haversine' }
}

export async function buildMatrix(points: LatLng[]): Promise<Matrix> {
  if (points.length < 2) return haversineMatrix(points)
  const table = (await fetchTable(points)) ?? (await fetchTable(points))
  return table ?? haversineMatrix(points)
}
