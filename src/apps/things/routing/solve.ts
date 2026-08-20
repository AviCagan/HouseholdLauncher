/**
 * Trip order solver: start at home (index 0), visit every stop once, return
 * home. Only the interior is permuted — both endpoints are fixed.
 */

export interface Solution {
  /** Interior order as indices into the original points array. */
  order: number[]
  totalDuration: number
  totalDistance: number
}

/**
 * Exact brute force is worth it below this size: 7! = 5040 permutations of an
 * 8-addition sum runs in well under a millisecond. For a household shopping
 * trip this branch runs essentially always, and it is both simpler and strictly
 * better than a heuristic.
 */
const BRUTE_FORCE_MAX = 7

function tourCost(order: number[], m: number[][]): number {
  let cost = 0
  let prev = 0
  for (const stop of order) {
    cost += m[prev][stop]
    prev = stop
  }
  return cost + m[prev][0]
}

function permutations(items: number[]): number[][] {
  if (items.length <= 1) return [items]
  const out: number[][] = []
  for (let i = 0; i < items.length; i++) {
    const rest = [...items.slice(0, i), ...items.slice(i + 1)]
    for (const p of permutations(rest)) out.push([items[i], ...p])
  }
  return out
}

function bruteForce(interior: number[], m: number[][]): number[] {
  let best = interior
  let bestCost = Infinity
  for (const candidate of permutations(interior)) {
    const cost = tourCost(candidate, m)
    if (cost < bestCost) {
      bestCost = cost
      best = candidate
    }
  }
  return best
}

function nearestNeighbour(interior: number[], m: number[][]): number[] {
  const remaining = new Set(interior)
  const order: number[] = []
  let current = 0
  while (remaining.size > 0) {
    let best = -1
    let bestCost = Infinity
    for (const candidate of remaining) {
      if (m[current][candidate] < bestCost) {
        bestCost = m[current][candidate]
        best = candidate
      }
    }
    order.push(best)
    remaining.delete(best)
    current = best
  }
  return order
}

/**
 * 2-opt on a fixed-endpoint path: reverse interior segments [i..j] and keep any
 * improvement. Never returns a worse tour than it was given.
 */
function twoOpt(order: number[], m: number[][], maxPasses = 100): number[] {
  let best = [...order]
  let bestCost = tourCost(best, m)

  for (let pass = 0; pass < maxPasses; pass++) {
    let improved = false
    for (let i = 0; i < best.length - 1; i++) {
      for (let j = i + 1; j < best.length; j++) {
        const candidate = [
          ...best.slice(0, i),
          ...best.slice(i, j + 1).reverse(),
          ...best.slice(j + 1),
        ]
        const cost = tourCost(candidate, m)
        if (cost < bestCost - 1e-9) {
          best = candidate
          bestCost = cost
          improved = true
        }
      }
    }
    if (!improved) break
  }
  return best
}

/**
 * @param durations square matrix where index 0 is home
 * @param distances same shape, used only for reporting
 */
export function solveTrip(durations: number[][], distances: number[][]): Solution {
  const n = durations.length
  if (n <= 1) return { order: [], totalDuration: 0, totalDistance: 0 }

  const interior = Array.from({ length: n - 1 }, (_, i) => i + 1)

  // Optimise on duration — road-aware, and closer to what "a good trip" means
  // than raw distance. Distance is reported for display only.
  const order =
    interior.length <= BRUTE_FORCE_MAX
      ? bruteForce(interior, durations)
      : twoOpt(nearestNeighbour(interior, durations), durations)

  return {
    order,
    totalDuration: tourCost(order, durations),
    totalDistance: tourCost(order, distances),
  }
}

/** Per-leg breakdown for the trip UI, including the drive home. */
export function legs(
  order: number[],
  durations: number[][],
  distances: number[][],
): { from: number; to: number; duration: number; distance: number }[] {
  const path = [0, ...order, 0]
  const out = []
  for (let i = 0; i < path.length - 1; i++) {
    const from = path[i]
    const to = path[i + 1]
    out.push({
      from,
      to,
      duration: durations[from][to],
      distance: distances[from][to],
    })
  }
  return out
}
