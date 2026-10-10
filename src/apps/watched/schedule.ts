import type { WatchSeason, WatchShow } from '@/data/types'
import { allEpisodes, dayStart, isoDay, remainingEpisodes, type Ep } from './model'

/**
 * When will we get to it, and when will we be done?
 *
 * The lineup is played forward a day at a time at the household's pace, and
 * whatever happens to each show is its estimate. Simulating rather than
 * dividing is the whole point: dividing can't know that a show airing weekly
 * only gives you fifty minutes a week however much time you have, or that
 * the rest of that time went to whatever was next in line — which is exactly
 * "we're watching these two at once, one comes out on Fridays".
 *
 * Each day's minutes go, in order, to:
 *
 *   1. shows being watched as they air — whatever has aired and not been
 *      watched, shared between them;
 *   2. shows already started, binge-style — shared equally, since starting
 *      two means watching two;
 *   3. the rest of the lineup in order — the first one with something to
 *      watch takes what's left, and if it runs out (caught up on something
 *      still airing) the next one takes the remainder.
 *
 * Pure. Tested directly.
 */

const DAY = 86_400_000
/** Twenty years. Anything still unfinished past that is reported as such. */
export const HORIZON_DAYS = 365 * 20
const EPS = 1e-6

export interface Position {
  season: number
  /** Episodes finished within the season. */
  done: number
  /** True when this comes from the pace rather than from someone saying so. */
  estimated: boolean
}

export interface Projection {
  showId: string
  /** Actual for something already playing; projected otherwise. */
  start: Date | null
  /** Null when something planned has no date yet, or it runs past the horizon. */
  finish: Date | null
  seasonFinish: Map<number, Date>
  position: Position | null
  /** It can't move until this date — the next episode isn't out. */
  waitingUntil: Date | null
  /** Some planned episodes have no air date yet. */
  tba: boolean
  /** Still going when the simulation stopped. */
  beyond: boolean
  minutesLeft: number
  episodesLeft: number
}

interface Slot {
  show: WatchShow
  eps: Ep[]
  /** Local-midnight timestamp each episode becomes watchable; null for never-yet. */
  avail: (number | null)[]
  idx: number
  /** Minutes already watched of eps[idx]. */
  into: number
  started: boolean
  firstDay: number | null
  finishDay: number | null
  seasonFinish: Map<number, Date>
  position: Position | null
}

/** Midnight `n` days after `base`, in local time — DST-safe, unlike adding 86,400,000. */
function dayAt(base: Date, n: number): number {
  return new Date(base.getFullYear(), base.getMonth(), base.getDate() + n).getTime()
}

/**
 * Where they are in the season they're on, right now.
 *
 * Starts from the last thing anyone said — an episode count and when — or
 * from the season's start, and adds what the pace says they've watched
 * since. Two limits keep it honest: it never counts an episode that hasn't
 * aired, and it never finishes the season, because finishing is the one
 * thing they always tell us. A season that "should" be over is reported as
 * down to its last episode.
 */
export function estimatePosition(
  show: WatchShow,
  log: WatchSeason[],
  minutesPerWeek: number,
  now: Date,
): Position | null {
  const season = show.current_season
  if (!season) return null
  const eps = allEpisodes(show).filter((e) => e.season === season)
  const today = isoDay(now)
  const len = eps.length
  const explicit = show.progress_at !== null
  const anchorDone = Math.min(show.current_episode, Math.max(0, len - 1))
  if (len === 0) return { season, done: 0, estimated: false }

  const row = log.find((r) => r.show_id === show.id && r.season === season)
  const anchorIso = show.progress_at ?? row?.started_at ?? show.started_at
  const anchor = anchorIso ? Date.parse(anchorIso) : now.getTime()
  const aired = eps.filter((e) => e.airdate !== null && e.airdate <= today).length
  const cap = Math.max(anchorDone, len - 1)

  let done = anchorDone
  if (show.live) {
    // Watching as it airs: assume they're caught up with what's out.
    done = Math.max(anchorDone, Math.min(aired, cap))
  } else {
    let budget = (Math.max(0, now.getTime() - anchor) / DAY) * (minutesPerWeek / 7)
    for (let i = anchorDone; i < len; i++) {
      const ep = eps[i]
      if (ep.airdate === null || ep.airdate > today) break
      if (budget + EPS < ep.minutes) break
      budget -= ep.minutes
      done++
    }
    done = Math.min(done, cap)
  }
  return { season, done, estimated: !explicit || done > anchorDone }
}

/** What one slot could watch today, capped at `limit` — no need to count further. */
function capacity(slot: Slot, today: number, limit: number): number {
  let total = 0
  for (let i = slot.idx; i < slot.eps.length && total < limit; i++) {
    const at = slot.avail[i]
    if (at === null || at > today) break
    total += slot.eps[i].minutes - (i === slot.idx ? slot.into : 0)
  }
  return Math.min(total, limit)
}

function consume(slot: Slot, minutes: number, today: number): void {
  if (minutes <= EPS) return
  if (slot.firstDay === null) slot.firstDay = today
  let left = minutes
  while (left > EPS && slot.idx < slot.eps.length) {
    const at = slot.avail[slot.idx]
    if (at === null || at > today) break
    const ep = slot.eps[slot.idx]
    const need = ep.minutes - slot.into
    if (left + EPS >= need) {
      left -= need
      slot.into = 0
      const next = slot.eps[slot.idx + 1]
      if (!next || next.season !== ep.season) slot.seasonFinish.set(ep.season, new Date(today))
      slot.idx++
      if (slot.idx >= slot.eps.length) slot.finishDay = today
    } else {
      slot.into += left
      left = 0
    }
  }
}

/** Share `budget` between slots, each up to what it can take; returns what's left. */
function waterfill(budget: number, group: Slot[], today: number, perDay: number): number {
  let remaining = budget
  let open = group
    .map((slot) => ({ slot, cap: capacity(slot, today, perDay) }))
    .filter((x) => x.cap > EPS)
  while (remaining > EPS && open.length > 0) {
    const share = remaining / open.length
    let used = 0
    const next: typeof open = []
    for (const x of open) {
      const give = Math.min(share, x.cap)
      consume(x.slot, give, today)
      used += give
      x.cap -= give
      if (x.cap > EPS) next.push(x)
    }
    remaining -= used
    open = next
    if (used <= EPS) break
  }
  return remaining
}

/**
 * Project every show in the lineup and on now.
 *
 * Shows on a shelf, watched or dropped aren't in it — they have no place in
 * the queue to be projected from.
 */
export function projectLineup(
  shows: WatchShow[],
  log: WatchSeason[],
  minutesPerWeek: number,
  now: Date,
  horizonDays: number = HORIZON_DAYS,
): Map<string, Projection> {
  const base = dayStart(isoDay(now))
  const perDay = Math.max(0, minutesPerWeek) / 7
  const active = shows
    .filter((s) => s.stage === 'watching' || s.stage === 'lineup')
    .sort((a, b) => a.lineup_order - b.lineup_order)

  // Started binge shows split the time between them, so the catch-up
  // estimate for each gets its share rather than the whole week.
  const binging = Math.max(1, active.filter((s) => s.stage === 'watching' && !s.live).length)

  const slots: Slot[] = active.map((show) => {
    const position =
      show.stage === 'watching' ? estimatePosition(show, log, minutesPerWeek / binging, now) : null
    const eps = remainingEpisodes(show, position ? { season: position.season, done: position.done } : null)
    return {
      show,
      eps,
      avail: eps.map((e) => (e.airdate ? dayStart(e.airdate).getTime() : null)),
      idx: 0,
      into: 0,
      started: show.stage === 'watching',
      firstDay: null,
      finishDay: null,
      seasonFinish: new Map(),
      position,
    }
  })

  const waitingNow = new Map<string, Date | null>()
  const today0 = base.getTime()
  for (const slot of slots) {
    const at = slot.avail[0]
    waitingNow.set(slot.show.id, at !== undefined && at !== null && at > today0 ? new Date(at) : null)
  }

  let day = 0
  while (day <= horizonDays && perDay > 0) {
    const today = dayAt(base, day)
    const open = slots.filter((s) => s.idx < s.eps.length)
    if (open.length === 0) break

    // Nothing out to watch today: jump to the next air date rather than
    // stepping through empty days one at a time.
    let anyNow = false
    let nextAt = Infinity
    for (const s of open) {
      const at = s.avail[s.idx]
      if (at === null) continue
      if (at <= today) anyNow = true
      else nextAt = Math.min(nextAt, at)
    }
    if (!anyNow) {
      if (nextAt === Infinity) break
      day = Math.max(day + 1, Math.round((nextAt - today0) / DAY))
      continue
    }

    const live = open.filter((s) => s.show.live)
    const started = open.filter((s) => !s.show.live && s.started)
    const queued = open.filter((s) => !s.show.live && !s.started)

    let left = waterfill(perDay, live, today, perDay)
    left = waterfill(left, started, today, perDay)
    for (const s of queued) {
      if (left <= EPS) break
      const cap = capacity(s, today, left)
      if (cap <= EPS) continue
      consume(s, cap, today)
      s.started = true
      left -= cap
    }
    day++
  }

  const out = new Map<string, Projection>()
  for (const slot of slots) {
    const { show } = slot
    const actualStart = show.stage === 'watching' && show.started_at ? new Date(show.started_at) : null
    // Waiting in the lineup for a season with nothing listed yet: there is
    // nothing to estimate — and it is certainly not done today.
    const awaiting =
      slot.eps.length === 0 &&
      show.stage === 'lineup' &&
      show.plan_to === null &&
      show.tvmaze_id !== null &&
      show.status !== 'Ended'
    out.set(show.id, {
      showId: show.id,
      start: actualStart ?? (slot.firstDay !== null ? new Date(slot.firstDay) : null),
      finish:
        slot.finishDay !== null ? new Date(slot.finishDay) : slot.eps.length === 0 && !awaiting ? new Date(today0) : null,
      seasonFinish: slot.seasonFinish,
      position: slot.position,
      waitingUntil: waitingNow.get(show.id) ?? null,
      tba: awaiting || slot.avail.some((a) => a === null),
      beyond: slot.idx < slot.eps.length && !slot.avail.slice(slot.idx).some((a) => a === null),
      minutesLeft: slot.eps.reduce((t, e) => t + e.minutes, 0),
      episodesLeft: slot.eps.length,
    })
  }
  return out
}

/**
 * Rows for the program guide: shows that overlap in time get separate rows,
 * like channels. Greedy by start date, which is optimal for intervals.
 */
export function assignLanes(
  items: { id: string; start: Date | null; finish: Date | null }[],
  fallbackEnd: Date,
): Map<string, number> {
  const sorted = items
    .filter((i) => i.start !== null)
    .sort((a, b) => a.start!.getTime() - b.start!.getTime())
  const laneEnds: number[] = []
  const lanes = new Map<string, number>()
  for (const item of sorted) {
    const start = item.start!.getTime()
    const end = (item.finish ?? fallbackEnd).getTime()
    // Free once the last show on it has finished — a show that starts the
    // day another ends follows it on the same row, like a schedule.
    let lane = laneEnds.findIndex((e) => e <= start)
    if (lane === -1) {
      lane = laneEnds.length
      laneEnds.push(end)
    } else {
      laneEnds[lane] = end
    }
    lanes.set(item.id, lane)
  }
  return lanes
}

/**
 * For a show that isn't in the lineup: how long it would take on its own,
 * starting now. Only what has aired counts toward the time; what hasn't is
 * reported separately so "6 weeks" never quietly includes a season that
 * isn't out.
 */
export function timeToWatch(
  show: WatchShow,
  minutesPerWeek: number,
  now: Date,
): { days: number; minutes: number; episodes: number; unaired: number } {
  const today = isoDay(now)
  const eps = remainingEpisodes(show)
  const out = eps.filter((e) => e.airdate !== null && e.airdate <= today)
  const minutes = out.reduce((t, e) => t + e.minutes, 0)
  return {
    days: minutesPerWeek > 0 ? (minutes / minutesPerWeek) * 7 : Infinity,
    minutes,
    episodes: out.length,
    unaired: eps.length - out.length,
  }
}
