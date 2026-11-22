import { hebrewLabel, type Zmanim } from './calendar'
import type { Settings } from './settings'
import { timeline, type Segment } from './status'
import type { Result } from './types'

/**
 * His view, as her phone publishes it.
 *
 * Exactly what "His view" lists and nothing else: the status (as a timeline,
 * so "now" stays right on his phone between publishes), the upcoming onot
 * perishah with their times, mikvah night, and a tick for the beinonit
 * bedikah — relations are forbidden until it's done. No check results, no
 * stains, no notes, no questions to a rav, and no flow or hefsek dates
 * beyond what the status itself implies.
 */
export interface HisSnapshot {
  v: 1
  publishedAt: number
  segments: Segment[]
  onot: { start: number; end: number; beinonit: boolean; done: boolean | null }[]
  mikvah: { at: number; label: string; onHold: boolean } | null
}

export function hisView(result: Result, z: Zmanim, s: Settings, now: number, days = 45): HisSnapshot {
  const until = now + days * 86_400_000
  const current = [...result.cycles].reverse().find((c) => c.immersion === null && c.mikvah)
  return {
    v: 1,
    publishedAt: now,
    segments: timeline(result, now - 86_400_000, until, z, s),
    onot: result.vestot
      .filter((v) => v.end > now - 86_400_000 && v.start < until && (v.kind !== 'or_zarua' || s.orZarua))
      .map((v) => {
        const beinonit = v.kind === 'beinonit' || v.kind === 'beinonit31'
        return { start: v.start, end: v.end, beinonit, done: beinonit ? v.bedikahDone : null }
      }),
    mikvah:
      current?.mikvah && !current.mikvah.withheld
        ? { at: current.mikvah.at, label: hebrewLabel(current.mikvah.abs), onHold: current.mikvah.waitingOn.length > 0 }
        : null,
  }
}

/** His side: the segment covering a moment. */
export function segmentAt(snap: HisSnapshot, t: number): Segment | null {
  return snap.segments.find((x) => x.from <= t && t < x.to) ?? null
}
