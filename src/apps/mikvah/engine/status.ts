import { civilOf, hebrewLabel, type Zmanim } from './calendar'
import { onahSpan, place, vesetName } from './engine'
import type { Settings } from './settings'
import type { Cycle, Result, Veset } from './types'

/**
 * What to show right now — and, as a timeline, for the next weeks (his phone
 * reads the timeline, since it can't recompute from her records).
 *
 * Statuses: tehorah; niddah, waiting (day n of 5); niddah, counting (day n of
 * 7); mikvah night; with an onat perishah laid over tehorah for its onah.
 */

export type StatusKind = 'tehorah' | 'waiting' | 'counting' | 'mikvah' | 'after_seven' | 'none'

export interface Status {
  kind: StatusKind
  day?: number
  of?: number
  cycleId?: string
  /** Onot perishah covering this moment. */
  vestot: Veset[]
  /** A plain line for the screen: "Niddah — counting, day 3 of 7". */
  line: string
  ruleId: string
}

export function cycleAt(result: Result, t: number): Cycle | null {
  let found: Cycle | null = null
  for (const c of result.cycles) {
    if (c.startAt <= t && (c.immersion === null || c.immersion > t)) found = c
  }
  return found
}

export function statusAt(result: Result, t: number, z: Zmanim, s: Settings): Status {
  const vestot = result.vestot.filter((v) => v.start <= t && t <= v.end && v.kind !== 'or_zarua')
  const c = cycleAt(result, t)
  if (!c) {
    if (result.cycles.length === 0) return { kind: 'none', vestot, line: 'No period logged yet', ruleId: 'ASK' }
    return {
      kind: 'tehorah',
      vestot,
      line: vestot.length ? `Tehorah — onat perishah (${vestot.map((v) => vesetName(v.kind)).join(', ')})` : 'Tehorah',
      ruleId: vestot.length ? vestot[0].ruleId : 'M1',
    }
  }
  const here = place(t, z, s).onah
  if (c.hefsek && here.abs > c.hefsek.abs) {
    const n = here.abs - c.hefsek.abs
    if (c.mikvah && !c.mikvah.withheld && (here.abs === c.mikvah.abs || (here.abs === c.mikvah.abs - 1 && n >= 7))) {
      return { kind: 'mikvah', cycleId: c.id, vestot, line: here.abs === c.mikvah.abs ? 'Mikvah night — tonight' : 'Mikvah night is tonight', ruleId: 'M1' }
    }
    if (n <= 7) return { kind: 'counting', day: n, of: 7, cycleId: c.id, vestot, line: `Niddah — counting, day ${n} of 7`, ruleId: 'N1' }
    return { kind: 'after_seven', cycleId: c.id, vestot, line: 'Niddah — the seven days are done; waiting for mikvah night', ruleId: 'M1' }
  }
  const n = here.abs - c.day1 + 1
  return {
    kind: 'waiting',
    day: n,
    of: s.minDays,
    cycleId: c.id,
    vestot,
    line: c.earliestHefsek === null ? 'Niddah — waiting for the date from your rav' : `Niddah — waiting, day ${n} of ${s.minDays}`,
    ruleId: c.earliestHefsek === null ? 'L3' : 'D1',
  }
}

export interface NextThing {
  label: string
  at: number
  ruleId: string
}

/** The next thing to do, with its time. */
export function nextThing(result: Result, now: number, z: Zmanim, s: Settings): NextThing | null {
  const c = cycleAt(result, now)
  if (c) {
    if (!c.hefsek) {
      if (c.earliestHefsek === null) return null
      const day = Math.max(c.earliestHefsek, place(now, z, s).onah.abs)
      const t = z.times(civilOf(day))
      const deadline = (t.shkiah ?? NaN) - s.marginMinutes * 60_000
      return { label: `Hefsek taharah ${hebrewLabel(day, false)}, before shkiah`, at: deadline, ruleId: 'H1' }
    }
    const slot = c.slots.find((x) => x.result === null && x.closes > now)
    if (slot) return { label: `Bedikah, clean day ${slot.day} (${slot.part})`, at: Math.max(slot.opens, now), ruleId: 'N1' }
    if (c.mikvah && !c.mikvah.withheld) return { label: 'Mikvah night', at: c.mikvah.at, ruleId: 'M1' }
    return null
  }
  const v = result.vestot.find((x) => x.end > now && x.kind !== 'or_zarua')
  if (v) return { label: `Onat perishah: ${vesetName(v.kind)}`, at: v.start, ruleId: v.ruleId }
  return null
}

export interface Segment {
  from: number
  to: number
  kind: StatusKind
  day?: number
  of?: number
  line: string
}

/**
 * Status, onah by onah, from `from` to `to`, merged into runs. This is what
 * his phone gets: it can show "now" correctly without her records.
 */
export function timeline(result: Result, from: number, to: number, z: Zmanim, s: Settings): Segment[] {
  const out: Segment[] = []
  let o = place(from, z, s).onah
  for (let guard = 0; guard < 400; guard++) {
    const span = onahSpan(o, z, s, false)
    if (!Number.isFinite(span.start) || span.start > to) break
    const mid = (Math.max(span.start, from) + span.end) / 2
    const st = statusAt(result, mid, z, s)
    const seg: Segment = { from: span.start, to: span.end, kind: st.kind, day: st.day, of: st.of, line: st.line.replace(/ — onat perishah.*$/, '') }
    const last = out[out.length - 1]
    if (last && last.kind === seg.kind && last.day === seg.day) last.to = seg.to
    else out.push(seg)
    o = o.half === 'night' ? { abs: o.abs, half: 'day' } : { abs: o.abs + 1, half: 'night' }
  }
  return out
}
