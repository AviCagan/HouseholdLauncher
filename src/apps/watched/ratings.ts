import type { WatchRating, WatchShow } from '@/data/types'

/**
 * Scores, and the rankings built from them.
 *
 * Out of ten, in half points, one per person per season or per show. The
 * combined score is the plain average of whoever rated — so a show only one
 * of them has scored yet still places, and moves when the other weighs in.
 */

export const toScore = (x2: number): number => x2 / 2
export const toX2 = (score: number): number => Math.min(20, Math.max(1, Math.round(score * 2)))

/** Average to one decimal, or null for nobody. */
export function average(values: number[]): number | null {
  if (values.length === 0) return null
  return Math.round((values.reduce((t, v) => t + v, 0) / values.length) * 10) / 10
}

/** 8 → "8", 8.5 → "8.5", 8.25 → "8.3". */
export function formatScore(score: number | null): string {
  if (score === null) return '–'
  const r = Math.round(score * 10) / 10
  return Number.isInteger(r) ? String(r) : r.toFixed(1)
}

export interface Scores {
  byPerson: Map<string, number>
  together: number | null
}

export function seasonScores(ratings: WatchRating[], showId: string, season: number): Scores {
  const byPerson = new Map<string, number>()
  for (const r of ratings) {
    if (r.show_id === showId && r.season === season) byPerson.set(r.profile_id, toScore(r.score_x2))
  }
  return { byPerson, together: average([...byPerson.values()]) }
}

export interface ShowScores extends Scores {
  /** Whether each person's number is their whole-show rating or their seasons' average. */
  basis: Map<string, 'show' | 'seasons'>
}

/**
 * A show's score per person: their rating of the whole show when they gave
 * one, otherwise the average of the seasons they rated. Rating per season or
 * per show is their choice, and either way the show gets a number.
 */
export function showScores(ratings: WatchRating[], showId: string): ShowScores {
  const whole = new Map<string, number>()
  const seasons = new Map<string, number[]>()
  for (const r of ratings) {
    if (r.show_id !== showId) continue
    if (r.season === 0) whole.set(r.profile_id, toScore(r.score_x2))
    else {
      const list = seasons.get(r.profile_id)
      if (list) list.push(toScore(r.score_x2))
      else seasons.set(r.profile_id, [toScore(r.score_x2)])
    }
  }
  const byPerson = new Map<string, number>()
  const basis = new Map<string, 'show' | 'seasons'>()
  for (const [person, score] of whole) {
    byPerson.set(person, score)
    basis.set(person, 'show')
  }
  for (const [person, list] of seasons) {
    if (byPerson.has(person)) continue
    byPerson.set(person, average(list)!)
    basis.set(person, 'seasons')
  }
  return { byPerson, together: average([...byPerson.values()]), basis }
}

/** "together" for the combined score, or a profile id for one person's. */
export type RankBy = 'together' | string

const keyOf = (scores: Scores, by: RankBy): number | null =>
  by === 'together' ? scores.together : (scores.byPerson.get(by) ?? null)

/**
 * Competition ranking — 1, 2, 2, 4 — so a tie reads as a tie rather than
 * one of them being silently ranked above the other.
 */
function withRanks<T extends { key: number | null }>(rows: T[]): (T & { rank: number | null })[] {
  let rank = 0
  let prev: number | null = null
  return rows.map((row, i) => {
    if (row.key === null) return { ...row, rank: null }
    if (row.key !== prev) {
      rank = i + 1
      prev = row.key
    }
    return { ...row, rank }
  })
}

export interface RankedShow {
  show: WatchShow
  scores: ShowScores
  key: number | null
  rank: number | null
}

/**
 * Everything watched, best first. Unrated shows come last, newest finished
 * first, so the list doubles as "what still needs a score".
 */
export function rankShows(shows: WatchShow[], ratings: WatchRating[], by: RankBy): RankedShow[] {
  // A show rated as a whole stays ranked while its next season is queued;
  // one with only season scores so far waits until it's finished.
  const ratedWhole = new Set(ratings.filter((r) => r.season === 0).map((r) => r.show_id))
  const rows = shows
    .filter((s) => s.stage === 'watched' || ratedWhole.has(s.id))
    .map((show) => {
      const scores = showScores(ratings, show.id)
      return { show, scores, key: keyOf(scores, by) }
    })
    .sort(
      (a, b) =>
        (b.key ?? -1) - (a.key ?? -1) ||
        (b.show.finished_at ?? '').localeCompare(a.show.finished_at ?? '') ||
        a.show.title.localeCompare(b.show.title),
    )
  return withRanks(rows)
}

export interface RankedSeason {
  show: WatchShow
  season: number
  scores: Scores
  key: number | null
  rank: number | null
}

/** Every rated season of every show, best first — "S3 of The Office" against everything. */
export function rankSeasons(shows: WatchShow[], ratings: WatchRating[], by: RankBy): RankedSeason[] {
  const byId = new Map(shows.map((s) => [s.id, s]))
  const pairs = new Map<string, { show: WatchShow; season: number }>()
  for (const r of ratings) {
    if (r.season === 0) continue
    const show = byId.get(r.show_id)
    if (!show) continue
    pairs.set(`${r.show_id}:${r.season}`, { show, season: r.season })
  }
  const rows = [...pairs.values()]
    .map(({ show, season }) => {
      const scores = seasonScores(ratings, show.id, season)
      return { show, season, scores, key: keyOf(scores, by) }
    })
    .filter((r) => r.key !== null)
    .sort(
      (a, b) =>
        (b.key ?? -1) - (a.key ?? -1) ||
        a.show.title.localeCompare(b.show.title) ||
        a.season - b.season,
    )
  return withRanks(rows)
}
