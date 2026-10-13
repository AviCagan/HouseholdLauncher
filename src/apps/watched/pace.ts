import type { WatchSeason, WatchSettings, WatchShow, WatchView } from '@/data/types'
import { allEpisodes } from './model'
import { plausible } from './insights'

/**
 * How much TV the household gets through in a week, in minutes.
 *
 * Minutes rather than episodes, because episodes aren't a unit: three
 * episodes of a sitcom and three of a prestige drama are an hour apart. The
 * pace is one number for the household, and each show turns it back into
 * episodes at its own length.
 */

/** Four hours a week — about an episode a night. What a household starts on. */
export const DEFAULT_PACE = 240
export const MIN_PACE = 15
export const MAX_PACE = 10080

const DAY = 86_400_000
/** Nothing older than a year counts at all. */
const LOOKBACK_DAYS = 365
/**
 * How fast the record forgets, in days. Every episode counts, but one from
 * three weeks ago counts about a third as much as tonight's, so the pace
 * follows how they watch now — a busy month pulls it down, a holiday binge
 * pushes it up, and either fades once it's over.
 */
const MEMORY_DAYS = 21
/**
 * Four episodes in one evening is a real evening, not a weekly habit. The
 * time they're spread over is never counted as less than this.
 */
const MIN_SPAN_DAYS = 2
/**
 * A stretch with nothing watched counts against the pace — a quiet week is a
 * slower week — but only up to this long. After that it's a trip or a break,
 * and the next episode picks up from how they were watching before.
 */
const IDLE_CAP_DAYS = 10
/**
 * How much history it takes to trust the record completely. Until then the
 * measured pace is blended with the dial in proportion, so the first couple
 * of evenings nudge the dates rather than swing them.
 */
const CONFIDENT_DAYS = 14

export interface PaceSample {
  /** Episodes the measurement counted. */
  episodes: number
  /** Their minutes, unweighted. */
  minutes: number
  /** What the record says, before any blending with the dial. */
  minutesPerWeek: number
  /** The history covered: first episode counted to the end of the window. */
  spanDays: number
  from: string
  /** The last time anything was watched. */
  to: string
}

export interface Pace {
  minutesPerWeek: number
  source: 'measured' | 'manual' | 'default'
  sample: PaceSample | null
  /** 0–1: how much of the number is the record rather than the dial. */
  confidence: number
}

export const clampPace = (minutes: number): number =>
  Math.min(MAX_PACE, Math.max(MIN_PACE, Math.round(minutes)))

/** Minutes watched, either at a moment (an episode) or spread over a stretch (a season). */
interface Watched {
  start: number
  end: number
  episodes: number
  minutes: number
}

function seasonEpisodes(show: WatchShow, season: number) {
  return allEpisodes(show).filter((e) => e.season === season)
}

/**
 * What the record says the pace is, or null when there is no record yet.
 *
 * The record is every episode logged with a time — each tap of +, or a batch
 * logged with dates — plus, for any part of a season that was finished
 * without ticking episodes, that season's minutes spread from when it was
 * started to when it was finished. Shows added after the fact have no dates
 * and never count.
 *
 * The pace is minutes watched divided by the time they took, breaks
 * included, with recent watching weighted most (see MEMORY_DAYS). Shows
 * watched side by side add up, which is right: two at once is more TV.
 */
export function measurePace(
  log: WatchSeason[],
  shows: WatchShow[],
  views: WatchView[],
  now: Date,
): PaceSample | null {
  const byId = new Map(shows.map((s) => [s.id, s]))
  const counts = (show: WatchShow | undefined): show is WatchShow => !!show && !show.watched_before
  const items: Watched[] = []

  // Episodes logged one at a time.
  const viewed = new Map<string, Set<number>>()
  for (const v of views) {
    const show = byId.get(v.show_id)
    if (!counts(show)) continue
    const at = Date.parse(v.watched_at)
    if (!Number.isFinite(at)) continue
    const minutes = v.minutes ?? seasonEpisodes(show, v.season).find((e) => e.number === v.episode)?.minutes ?? show.avg_runtime ?? 0
    if (minutes <= 0) continue
    items.push({ start: at, end: at, episodes: 1, minutes })
    const key = `${v.show_id}:${v.season}`
    if (!viewed.has(key)) viewed.set(key, new Set())
    viewed.get(key)!.add(v.episode)
  }

  /** A stretch of a season with no episodes logged: its minutes spread over the stretch. */
  function stretch(show: WatchShow, season: number, startIso: string, endIso: string, upTo?: number) {
    const end = Date.parse(endIso)
    let start = Date.parse(startIso)
    if (!Number.isFinite(start) || !Number.isFinite(end)) return
    // Two phones' clocks can disagree by a minute; never a negative stretch.
    start = Math.min(start, end)
    const logged = viewed.get(`${show.id}:${season}`)
    const rest = seasonEpisodes(show, season)
      .filter((e) => upTo === undefined || e.number <= upTo)
      .filter((e) => !logged?.has(e.number))
    const minutes = rest.reduce((t, e) => t + e.minutes, 0)
    // Ticked off faster than it runs: when it was really watched is unknown.
    if (minutes > 0 && plausible(start, end, minutes)) items.push({ start, end, episodes: rest.length, minutes })
  }

  // Finished seasons, for whatever wasn't ticked off episode by episode.
  for (const row of log) {
    if (!row.started_at || !row.finished_at || row.watched_before) continue
    const show = byId.get(row.show_id)
    if (counts(show)) stretch(show, row.season, row.started_at, row.finished_at)
  }

  // The season on now, up to wherever someone last said they were.
  for (const show of shows) {
    if (show.stage !== 'watching' || !show.current_season || !show.progress_at || show.current_episode <= 0) continue
    if (!counts(show)) continue
    const row = log.find((r) => r.show_id === show.id && r.season === show.current_season)
    if (row?.finished_at) continue
    const startIso = row?.started_at ?? show.started_at
    if (startIso) stretch(show, show.current_season, startIso, show.progress_at, show.current_episode)
  }

  const cutoff = now.getTime() - LOOKBACK_DAYS * DAY
  const recent = items.filter((w) => w.end >= cutoff)
  if (recent.length === 0) return null

  const first = Math.min(...recent.map((w) => w.start))
  const last = Math.max(...recent.map((w) => w.end))
  // The screen's clock only ticks every few minutes; an episode logged since
  // is still tonight's, not the future's, and has to count straight away.
  const end = Math.min(Math.max(now.getTime(), last), last + IDLE_CAP_DAYS * DAY)
  const tau = MEMORY_DAYS * DAY
  const weight = (t: number) => Math.exp(-Math.max(0, end - t) / tau)

  // Weighted minutes: an episode at its moment, a stretch averaged over itself.
  let weighted = 0
  for (const w of recent) {
    const avg = w.end - w.start < 60_000 ? weight(w.end) : (tau * (weight(w.end) - weight(w.start))) / (w.end - w.start)
    weighted += w.minutes * avg
  }
  // Weighted time: the whole history, but never less than MIN_SPAN_DAYS.
  const from = Math.min(first, end - MIN_SPAN_DAYS * DAY)
  const weightedDays = (tau * (1 - weight(from))) / DAY

  return {
    episodes: recent.reduce((t, w) => t + w.episodes, 0),
    minutes: recent.reduce((t, w) => t + w.minutes, 0),
    minutesPerWeek: (weighted / weightedDays) * 7,
    spanDays: Math.max(0, (end - first) / DAY),
    from: new Date(first).toISOString(),
    to: new Date(last).toISOString(),
  }
}

/**
 * The pace the estimates use.
 *
 * Manual means manual. Auto starts on the dial and moves toward the record
 * as the record grows — weighted by how many days of history it covers — so
 * a brand-new household gets dates on day one, and they quietly become
 * their own over the first couple of weeks without one evening swinging them.
 */
export function effectivePace(settings: WatchSettings | undefined, sample: PaceSample | null): Pace {
  const dialled = clampPace(settings?.pace_minutes ?? DEFAULT_PACE)
  if (settings?.pace_mode === 'manual') return { minutesPerWeek: dialled, source: 'manual', sample, confidence: 0 }
  if (sample) {
    const confidence = Math.min(1, Math.max(0, sample.spanDays / CONFIDENT_DAYS))
    return {
      minutesPerWeek: clampPace(sample.minutesPerWeek * confidence + dialled * (1 - confidence)),
      source: 'measured',
      sample,
      confidence,
    }
  }
  return { minutesPerWeek: dialled, source: 'default', sample: null, confidence: 0 }
}

/** The same pace in a given show's episodes: 240 a week of 45-minute ones is 5.3. */
export const episodesPerWeek = (minutesPerWeek: number, episodeMinutes: number): number =>
  episodeMinutes > 0 ? minutesPerWeek / episodeMinutes : 0
