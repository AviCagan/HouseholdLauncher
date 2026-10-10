import type { EpisodeTuple, SeasonInfo, WatchSeason, WatchShow } from '@/data/types'
import { addDaysIso } from './model'

/** Test fixtures for Watched. Not imported by the app. */

let seq = 0

export function show(patch: Partial<WatchShow> = {}): WatchShow {
  seq += 1
  return {
    id: `show-${seq}`,
    tvmaze_id: null,
    title: `Show ${seq}`,
    premiered: null,
    ended: null,
    status: 'Ended',
    network: null,
    genres: [],
    summary: null,
    poster_url: null,
    avg_runtime: null,
    episodes: [],
    seasons: [],
    next_airdate: null,
    data_updated_at: null,
    stage: 'lineup',
    shelf_owner: null,
    shelf_order: seq,
    lineup_order: seq,
    live: false,
    plan_from: null,
    plan_to: null,
    current_season: null,
    current_episode: 0,
    progress_at: null,
    started_at: null,
    finished_at: null,
    watched_before: false,
    created_by: null,
    updated_by: null,
    created_at: '2026-01-01T00:00:00.000Z',
    updated_at: '2026-01-01T00:00:00.000Z',
    ...patch,
  }
}

/**
 * One season's episodes: `count` of them, `minutes` long, the first airing
 * on `start` and one every `cadence` days after (0 = all at once).
 */
export function season(
  n: number,
  count: number,
  start: string | null,
  minutes: number | null = 30,
  cadence = 7,
): EpisodeTuple[] {
  return Array.from({ length: count }, (_, i) => [
    n,
    i + 1,
    minutes,
    start ? addDaysIso(start, i * cadence) : null,
  ])
}

export function seasonsInfo(...items: Partial<SeasonInfo>[]): SeasonInfo[] {
  return items.map((s, i) => ({ n: s.n ?? i + 1, eps: s.eps ?? null, premiere: s.premiere ?? null, end: s.end ?? null }))
}

export function seasonRow(patch: Partial<WatchSeason> & { show_id: string; season: number }): WatchSeason {
  return {
    id: `${patch.show_id}:${patch.season}`,
    show_title: null,
    started_at: null,
    finished_at: null,
    watched_before: false,
    created_by: null,
    updated_by: null,
    created_at: '2026-01-01T00:00:00.000Z',
    updated_at: '2026-01-01T00:00:00.000Z',
    ...patch,
  }
}

/** Local noon on a date — far from midnight, so no test depends on the hour. */
export const at = (iso: string): Date => {
  const [y, m, d] = iso.split('-').map(Number)
  return new Date(y, m - 1, d, 12)
}

/** The local calendar day of a Date, for comparing projections. */
export const dayOf = (date: Date | null | undefined): string | null => {
  if (!date) return null
  const y = date.getFullYear()
  const m = String(date.getMonth() + 1).padStart(2, '0')
  const d = String(date.getDate()).padStart(2, '0')
  return `${y}-${m}-${d}`
}
