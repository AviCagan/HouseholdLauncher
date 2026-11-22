import type { Result } from './engine'

/**
 * Every period as a row of history, and the numbers across them: cycle
 * length, days from the flow to the hefsek, and the haflagah number each flow
 * made. Only calendar flows count — a stain or a birth starts a niddah
 * period but not a cycle.
 */

export interface CycleRow {
  id: string
  /** Hebrew date (absolute day) the flow was on. */
  day1: number
  half: 'night' | 'day'
  startAt: number
  /** Days from this flow's date to the next one's. */
  length: number | null
  /** The flow day the hefsek was on (flow day = 1). */
  toHefsek: number | null
  /** The Chabad haflagah count from the previous hefsek, in onot. */
  haflagah: number | null
  immersion: number | null
}

export function cycleRows(result: Result): CycleRow[] {
  const flows = result.cycles.filter((c) => c.calendar && c.cause === 'flow')
  return flows.map((c, i) => {
    const next = flows[i + 1]
    const prev = flows[i - 1]
    const h0 = prev?.firstHefsek ?? null
    return {
      id: c.id,
      day1: c.onah.abs,
      half: c.onah.half,
      startAt: c.startAt,
      length: next ? next.onah.abs - c.onah.abs : null,
      toHefsek: c.firstHefsek !== null ? c.firstHefsek - c.day1 + 1 : null,
      haflagah: h0 !== null ? 2 * (c.onah.abs - h0) - (c.onah.half === 'night' ? 1 : 0) : null,
      immersion: c.immersion,
    }
  })
}

export interface Stats {
  count: number
  average: number | null
  shortest: number | null
  longest: number | null
}

export function stats(values: (number | null)[]): Stats {
  const xs = values.filter((v): v is number => v !== null)
  if (xs.length === 0) return { count: 0, average: null, shortest: null, longest: null }
  return {
    count: xs.length,
    average: Math.round((xs.reduce((a, b) => a + b, 0) / xs.length) * 10) / 10,
    shortest: Math.min(...xs),
    longest: Math.max(...xs),
  }
}
