import type { WatchSeason, WatchSettings, WatchShow } from '@/data/types'
import { allEpisodes } from './model'

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
/** Only the last year counts: last year's habits say more than 2019's. */
const LOOKBACK_DAYS = 365
/** And only the most recent few seasons, so a change of habit shows up. */
const MAX_SEASONS = 8
/**
 * A season binged in a weekend is a real pace for that weekend and a wild
 * one for the next two years. Spreading any sample over at least a week
 * keeps one binge from promising them April 2029 by Thursday.
 */
const MIN_SPAN_DAYS = 7
/**
 * How much history it takes to trust the record completely. Until then the
 * measured pace is blended with the dial in proportion — a season finished
 * an hour after it was started says almost nothing about next year, and
 * shouldn't move every date in the app on its own.
 */
const CONFIDENT_DAYS = 21

export interface PaceSample {
  seasons: number
  episodes: number
  minutes: number
  /** The span the minutes are spread over: at least a week. */
  days: number
  /** The span actually covered, unpadded — how much history there is. */
  spanDays: number
  from: string
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

function minutesOf(show: WatchShow, season: number, firstN?: number): { episodes: number; minutes: number } {
  let eps = allEpisodes(show).filter((e) => e.season === season)
  if (firstN !== undefined) eps = eps.slice(0, firstN)
  return { episodes: eps.length, minutes: eps.reduce((t, e) => t + e.minutes, 0) }
}

interface Span {
  start: number
  end: number
  episodes: number
  minutes: number
}

/**
 * What the record says the pace is, or null when there is no record yet.
 *
 * Built from seasons with a real start and finish — never from shows added
 * after the fact, which have neither — plus the season playing now when
 * someone has said how far into it they are. The span runs from the earliest
 * start to the latest finish in the sample, so breaks between shows count:
 * this is the pace of their actual life, which is what a date two years out
 * has to be measured in. Seasons watched side by side count once each in the
 * minutes and once in the span, which is exactly right for two at a time.
 */
export function measurePace(log: WatchSeason[], shows: WatchShow[], now: Date): PaceSample | null {
  const byId = new Map(shows.map((s) => [s.id, s]))
  const spans: Span[] = []

  for (const row of log) {
    if (!row.started_at || !row.finished_at || row.watched_before) continue
    const show = byId.get(row.show_id)
    if (!show || show.watched_before) continue
    const end = Date.parse(row.finished_at)
    let start = Date.parse(row.started_at)
    if (!Number.isFinite(start) || !Number.isFinite(end)) continue
    // Two phones' clocks can disagree by a minute; never a negative season.
    start = Math.min(start, end)
    const { episodes, minutes } = minutesOf(show, row.season)
    if (minutes > 0) spans.push({ start, end, episodes, minutes })
  }

  // The season on now, up to wherever someone last said they were.
  for (const show of shows) {
    if (show.stage !== 'watching' || !show.current_season || !show.progress_at) continue
    if (show.current_episode <= 0) continue
    const row = log.find((r) => r.show_id === show.id && r.season === show.current_season)
    const startIso = row?.started_at ?? show.started_at
    if (!startIso) continue
    const end = Date.parse(show.progress_at)
    const start = Math.min(Date.parse(startIso), end)
    if (!Number.isFinite(start) || !Number.isFinite(end)) continue
    const { episodes, minutes } = minutesOf(show, show.current_season, show.current_episode)
    if (minutes > 0) spans.push({ start, end, episodes, minutes })
  }

  if (spans.length === 0) return null

  spans.sort((a, b) => b.end - a.end)
  const cutoff = now.getTime() - LOOKBACK_DAYS * DAY
  const recent = spans.filter((s) => s.end >= cutoff)
  const pick = (recent.length > 0 ? recent : spans).slice(0, MAX_SEASONS)

  const minutes = pick.reduce((t, s) => t + s.minutes, 0)
  const episodes = pick.reduce((t, s) => t + s.episodes, 0)
  const from = Math.min(...pick.map((s) => s.start))
  const to = Math.max(...pick.map((s) => s.end))
  return {
    seasons: pick.length,
    episodes,
    minutes,
    days: Math.max(MIN_SPAN_DAYS, (to - from) / DAY),
    spanDays: (to - from) / DAY,
    from: new Date(from).toISOString(),
    to: new Date(to).toISOString(),
  }
}

/**
 * The pace the estimates use.
 *
 * Manual means manual. Auto starts on the dial and moves toward the record
 * as the record grows — weighted by how many days of history it covers — so
 * a brand-new household gets dates on day one, and they quietly become
 * their own over the first few weeks without one quick season swinging them.
 */
export function effectivePace(settings: WatchSettings | undefined, sample: PaceSample | null): Pace {
  const dialled = clampPace(settings?.pace_minutes ?? DEFAULT_PACE)
  if (settings?.pace_mode === 'manual') return { minutesPerWeek: dialled, source: 'manual', sample, confidence: 0 }
  if (sample) {
    const measured = (sample.minutes / sample.days) * 7
    const confidence = Math.min(1, Math.max(0, sample.spanDays / CONFIDENT_DAYS))
    return {
      minutesPerWeek: clampPace(measured * confidence + dialled * (1 - confidence)),
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
