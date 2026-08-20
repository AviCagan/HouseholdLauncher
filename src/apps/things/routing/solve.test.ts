import { describe, expect, it } from 'vitest'
import { solveTrip, legs } from './solve'
import { toOsrmCoords, haversine, haversineMatrix } from './osrm'
import { googleMultiStop, singleStopUrl } from './deeplink'

/** Symmetric matrix from points on a line: home at 0, stops at 1,2,3 units. */
function lineMatrix(positions: number[]): number[][] {
  return positions.map((a) => positions.map((b) => Math.abs(a - b)))
}

describe('toOsrmCoords', () => {
  it('serialises as lng,lat — reversed from every other API', () => {
    // This is the single most common way the OSRM integration breaks.
    expect(toOsrmCoords([{ lat: 40.7, lng: -74.0 }])).toBe('-74,40.7')
  })

  it('joins multiple points with semicolons', () => {
    const s = toOsrmCoords([
      { lat: 1, lng: 2 },
      { lat: 3, lng: 4 },
    ])
    expect(s).toBe('2,1;4,3')
  })
})

describe('solveTrip', () => {
  it('finds the optimal cost on a 4-point line', () => {
    // Home at 0, stops at 10, 30, 20. Several orders tie at the optimum
    // (out-and-back on a line), so assert the cost rather than one arbitrary
    // winner — the ordering is genuinely ambiguous here.
    const m = lineMatrix([0, 10, 30, 20])
    const { order, totalDuration } = solveTrip(m, m)
    expect(totalDuration).toBe(60)
    expect([...order].sort((a, b) => a - b)).toEqual([1, 2, 3])
  })

  it('picks the cheap order when one is strictly better', () => {
    // Two stops far apart on opposite sides: visiting the near one first is
    // strictly optimal, so there is a single right answer.
    const m = lineMatrix([0, -5, 40])
    const { order, totalDuration } = solveTrip(m, m)
    expect(order).toEqual([1, 2])
    expect(totalDuration).toBe(90)
  })

  it('returns an empty order when there are no stops', () => {
    const { order, totalDuration } = solveTrip([[0]], [[0]])
    expect(order).toEqual([])
    expect(totalDuration).toBe(0)
  })

  it('visits every stop exactly once', () => {
    const m = lineMatrix([0, 5, 12, 3, 22, 8])
    const { order } = solveTrip(m, m)
    expect([...order].sort((a, b) => a - b)).toEqual([1, 2, 3, 4, 5])
  })

  it('agrees with brute force above the brute-force cutoff', () => {
    // 8 stops takes the NN + 2-opt branch. On a line the optimal tour is still
    // a simple sweep, so the heuristic must find it.
    const positions = [0, 40, 10, 70, 25, 55, 5, 33, 61]
    const m = lineMatrix(positions)
    const { order } = solveTrip(m, m)
    const sweep = positions
      .map((p, i) => ({ p, i }))
      .slice(1)
      .sort((a, b) => a.p - b.p)
      .map((x) => x.i)
    expect(order).toEqual(sweep)
  })

  it('never returns a tour worse than nearest-neighbour would', () => {
    const m = [
      [0, 9, 4, 7, 3, 8, 6, 2, 5],
      [9, 0, 6, 3, 8, 2, 7, 4, 1],
      [4, 6, 0, 5, 2, 9, 3, 8, 7],
      [7, 3, 5, 0, 6, 4, 9, 1, 8],
      [3, 8, 2, 6, 0, 7, 5, 9, 4],
      [8, 2, 9, 4, 7, 0, 1, 6, 3],
      [6, 7, 3, 9, 5, 1, 0, 4, 2],
      [2, 4, 8, 1, 9, 6, 4, 0, 7],
      [5, 1, 7, 8, 4, 3, 2, 7, 0],
    ]
    const { order, totalDuration } = solveTrip(m, m)
    const naive = [1, 2, 3, 4, 5, 6, 7, 8]
    let naiveCost = 0
    let prev = 0
    for (const s of naive) {
      naiveCost += m[prev][s]
      prev = s
    }
    naiveCost += m[prev][0]
    expect(totalDuration).toBeLessThanOrEqual(naiveCost)
    expect(order).toHaveLength(8)
  })
})

describe('legs', () => {
  it('starts and ends at home', () => {
    const m = lineMatrix([0, 10, 20])
    const out = legs([1, 2], m, m)
    expect(out[0].from).toBe(0)
    expect(out.at(-1)!.to).toBe(0)
    expect(out).toHaveLength(3)
  })
})

describe('haversine', () => {
  it('measures a known distance within a percent', () => {
    // Statue of Liberty → Empire State Building, ~8.2 km.
    const d = haversine({ lat: 40.6892, lng: -74.0445 }, { lat: 40.7484, lng: -73.9857 })
    expect(d).toBeGreaterThan(8000)
    expect(d).toBeLessThan(8500)
  })

  it('produces a zero diagonal', () => {
    const m = haversineMatrix([
      { lat: 1, lng: 1 },
      { lat: 2, lng: 2 },
    ])
    expect(m.distances[0][0]).toBe(0)
    expect(m.distances[1][1]).toBe(0)
  })
})

describe('deep links', () => {
  const home = { lat: 40.7, lng: -74.0 }
  const stops = [
    { lat: 40.71, lng: -74.01 },
    { lat: 40.72, lng: -74.02 },
  ]

  it('routes Google out and back to home with encoded waypoints', () => {
    const url = googleMultiStop(home, stops)
    expect(url).toContain('origin=40.7%2C-74')
    expect(url).toContain('destination=40.7%2C-74')
    expect(url).toContain('40.71%2C-74.01%7C40.72%2C-74.02')
  })

  it('caps Google waypoints at 9', () => {
    const many = Array.from({ length: 12 }, (_, i) => ({ lat: 40 + i, lng: -74 }))
    const url = googleMultiStop(home, many)
    expect(url.match(/%7C/g)?.length).toBe(8) // 9 waypoints => 8 separators
  })

  it('builds a single-destination Waze link', () => {
    expect(singleStopUrl('waze', stops[0])).toBe(
      'https://waze.com/ul?ll=40.71%2C-74.01&navigate=yes',
    )
  })
})
