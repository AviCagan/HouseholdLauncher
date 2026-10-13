import type { WatchRating, WatchSeason, WatchShow } from '@/data/types'
import { allEpisodes } from './model'
import { seasonScores, showScores } from './ratings'

/**
 * How long things took, and whether the good ones go faster.
 *
 * A "run" is one season (or a whole show) watched with real dates: when it
 * was started, when it was finished, how much TV that was, and how the two
 * of them rated it. From the runs comes the pattern — do they tear through
 * the shows they love and crawl through the ones they don't? — and from the
 * pattern, a speed factor the estimates use for a show they've already
 * started rating.
 *
 * Pure. Tested directly.
 */

const DAY = 86_400_000
/** A season finished in one sitting took a day, not zero time. */
const MIN_DAYS = 1
/** Below this many rated runs there's no pattern worth acting on. */
export const MIN_RUNS = 4
/**
 * How far the pattern can move an estimate. Even a strong habit doesn't
 * make a show they love go three times as fast.
 */
const MAX_FACTOR = 1.6

export interface WatchRun {
  show: WatchShow
  /** 0 for the whole show. */
  season: number
  start: number
  end: number
  days: number
  episodes: number
  minutes: number
  hoursPerWeek: number
  /** Their combined score, or null if nobody rated it. */
  score: number | null
}

function run(show: WatchShow, season: number, start: number, end: number, episodes: number, minutes: number, score: number | null): WatchRun {
  const days = Math.max(MIN_DAYS, (end - start) / DAY)
  return { show, season, start, end, days, episodes, minutes, hoursPerWeek: (minutes / 60 / days) * 7, score }
}

/** Every season finished with real dates — never one added after the fact. */
export function seasonRuns(shows: WatchShow[], log: WatchSeason[], ratings: WatchRating[]): WatchRun[] {
  const byId = new Map(shows.map((s) => [s.id, s]))
  const out: WatchRun[] = []
  for (const row of log) {
    if (!row.started_at || !row.finished_at || row.watched_before) continue
    const show = byId.get(row.show_id)
    if (!show || show.watched_before) continue
    const end = Date.parse(row.finished_at)
    const start = Math.min(Date.parse(row.started_at), end)
    if (!Number.isFinite(start) || !Number.isFinite(end)) continue
    const eps = allEpisodes(show).filter((e) => e.season === row.season)
    const minutes = eps.reduce((t, e) => t + e.minutes, 0)
    if (minutes <= 0) continue
    out.push(run(show, row.season, start, end, eps.length, minutes, seasonScores(ratings, show.id, row.season).together))
  }
  return out.sort((a, b) => b.end - a.end)
}

/** A whole show, first season started to last finished — once every season of it is done. */
export function showRun(show: WatchShow, log: WatchSeason[], ratings: WatchRating[]): WatchRun | null {
  if (show.stage !== 'watched' || show.watched_before) return null
  const seasons = seasonRuns([show], log, ratings)
  if (seasons.length === 0) return null
  const start = Math.min(...seasons.map((r) => r.start))
  const end = Math.max(...seasons.map((r) => r.end))
  const episodes = seasons.reduce((t, r) => t + r.episodes, 0)
  const minutes = seasons.reduce((t, r) => t + r.minutes, 0)
  return run(show, 0, start, end, episodes, minutes, showScores(ratings, show.id).together)
}

export interface RatingPace {
  /** Rated runs: the points of the pattern. */
  points: WatchRun[]
  /** Correlation between score and (log) speed, −1…1; null until there are enough runs. */
  r: number | null
  /** Typical hours a week for the ones they rated highest and lowest. */
  loved: { cutoff: number; hoursPerWeek: number; count: number } | null
  meh: { cutoff: number; hoursPerWeek: number; count: number } | null
  /** How much faster (above 1) or slower they watch something rated `score`. */
  factor: (score: number | null) => number
}

const median = (xs: number[]): number => {
  const s = [...xs].sort((a, b) => a - b)
  const m = Math.floor(s.length / 2)
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2
}

/**
 * Do they watch the good ones faster?
 *
 * Fits log(speed) against score — a straight line in log terms means "each
 * extra point is X% faster", which is how a habit like that behaves. With
 * few runs the slope is shrunk toward zero, so two lucky seasons don't bend
 * every estimate; the factor is capped either way.
 */
export function ratingPace(runs: WatchRun[]): RatingPace {
  const points = runs.filter((r) => r.score !== null && r.hoursPerWeek > 0)
  const none: RatingPace = { points, r: null, loved: null, meh: null, factor: () => 1 }
  if (points.length < MIN_RUNS) return none

  const xs = points.map((p) => p.score!)
  const ys = points.map((p) => Math.log(p.hoursPerWeek))
  const n = points.length
  const mx = xs.reduce((t, x) => t + x, 0) / n
  const my = ys.reduce((t, y) => t + y, 0) / n
  let sxy = 0
  let sxx = 0
  let syy = 0
  for (let i = 0; i < n; i++) {
    sxy += (xs[i] - mx) * (ys[i] - my)
    sxx += (xs[i] - mx) ** 2
    syy += (ys[i] - my) ** 2
  }
  if (sxx === 0 || syy === 0) return { ...none, r: 0 }
  const r = sxy / Math.sqrt(sxx * syy)
  const slope = (sxy / sxx) * (n / (n + 6))

  // The top and bottom of what they've rated, split at the median score.
  const cut = median(xs)
  const hi = points.filter((p) => p.score! > cut)
  const lo = points.filter((p) => p.score! <= cut)
  const group = (list: WatchRun[], cutoff: number) =>
    list.length ? { cutoff, hoursPerWeek: median(list.map((p) => p.hoursPerWeek)), count: list.length } : null

  return {
    points,
    r,
    loved: group(hi, cut),
    meh: group(lo, cut),
    factor: (score) => {
      if (score === null) return 1
      const f = Math.exp(slope * (score - mx))
      return Math.min(MAX_FACTOR, Math.max(1 / MAX_FACTOR, f))
    },
  }
}

/**
 * The speed factor for each show in play: what they've rated it so far
 * (earlier seasons, or the show) run through the pattern. Shows nobody has
 * rated yet go at the plain pace.
 */
export function speedFactors(shows: WatchShow[], ratings: WatchRating[], pattern: RatingPace): Map<string, number> {
  const out = new Map<string, number>()
  for (const show of shows) {
    if (show.stage !== 'watching' && show.stage !== 'lineup') continue
    const score = showScores(ratings, show.id).together
    const f = pattern.factor(score)
    if (Math.abs(f - 1) > 0.02) out.set(show.id, f)
  }
  return out
}
