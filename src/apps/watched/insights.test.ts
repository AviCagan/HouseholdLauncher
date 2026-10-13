import { describe, expect, it } from 'vitest'
import type { WatchRating } from '@/data/types'
import { MIN_RUNS, ratingPace, seasonRuns, showRun, speedFactors } from './insights'
import { projectLineup } from './schedule'
import { at, dayOf, season, seasonRow, show } from './testkit'

const DAY = 86_400_000
const iso = (d: string) => at(d).toISOString()

function score(show_id: string, season: number, profile_id: string, s: number): WatchRating {
  return {
    id: `${show_id}:${season}:${profile_id}`,
    show_id,
    season,
    profile_id,
    score_x2: s * 2,
    created_at: '2026-01-01T00:00:00.000Z',
    updated_at: '2026-01-01T00:00:00.000Z',
  }
}

describe('seasonRuns', () => {
  it('says how long a season took, how much TV that was, and how they rated it', () => {
    const s = show({ episodes: season(1, 10, '2020-01-01', 60) })
    const log = [seasonRow({ show_id: s.id, season: 1, started_at: iso('2026-09-01'), finished_at: iso('2026-09-11') })]
    const [r] = seasonRuns([s], log, [score(s.id, 1, 'avi', 9), score(s.id, 1, 'jackie', 8)])
    expect(r).toMatchObject({ season: 1, days: 10, episodes: 10, minutes: 600, score: 8.5 })
    expect(r.hoursPerWeek).toBeCloseTo(7, 5)
  })

  it('counts a one-sitting season as a day, and skips ones added after the fact', () => {
    const s = show({ episodes: season(1, 4, '2020-01-01', 30) })
    const before = show({ watched_before: true, episodes: season(1, 4, '2020-01-01', 30) })
    const log = [
      // Two hours of TV, 6pm to 10pm the same evening.
      seasonRow({ show_id: s.id, season: 1, started_at: '2026-09-01T18:00:00.000Z', finished_at: '2026-09-01T22:00:00.000Z' }),
      seasonRow({ show_id: before.id, season: 1, started_at: iso('2026-09-01'), finished_at: iso('2026-09-05') }),
    ]
    const runs = seasonRuns([s, before], log, [])
    expect(runs).toHaveLength(1)
    expect(runs[0].days).toBe(1)
  })

  it('skips a season finished faster than it runs — Start and Finished tapped back to back', () => {
    const s = show({ episodes: season(1, 5, '2020-01-01', 70) })
    const log = [seasonRow({ show_id: s.id, season: 1, started_at: '2026-09-01T20:00:00.000Z', finished_at: '2026-09-01T20:01:00.000Z' })]
    expect(seasonRuns([s], log, [score(s.id, 1, 'avi', 9)])).toHaveLength(0)
  })

  it("uses the show's score for a season nobody scored on its own — a one-season show rated once", () => {
    const limited = show({ status: 'Ended', episodes: season(1, 8, '2020-01-01', 50) })
    const log = [seasonRow({ show_id: limited.id, season: 1, started_at: iso('2026-09-01'), finished_at: iso('2026-09-05') })]
    const [r] = seasonRuns([limited], log, [score(limited.id, 0, 'avi', 9), score(limited.id, 0, 'jackie', 8)])
    expect(r.score).toBe(8.5)
    // A season's own score still wins when there is one.
    const [own] = seasonRuns([limited], log, [score(limited.id, 0, 'avi', 9), score(limited.id, 1, 'avi', 6)])
    expect(own.score).toBe(6)
  })

  it('adds up a finished show from its first start to its last finish', () => {
    const s = show({ stage: 'watched', episodes: [...season(1, 5, '2020-01-01', 60), ...season(2, 5, '2021-01-01', 60)] })
    const log = [
      seasonRow({ show_id: s.id, season: 1, started_at: iso('2026-08-01'), finished_at: iso('2026-08-08') }),
      seasonRow({ show_id: s.id, season: 2, started_at: iso('2026-08-20'), finished_at: iso('2026-08-31') }),
    ]
    const r = showRun(s, log, [score(s.id, 0, 'avi', 7)])!
    expect(r).toMatchObject({ season: 0, days: 30, episodes: 10, minutes: 600, score: 7 })
  })
})

/** A season of 600 minutes rated `s`, watched over `days` days. */
function rated(s: number, days: number) {
  const sh = show({ stage: 'watched', episodes: season(1, 10, '2020-01-01', 60) })
  const start = at('2026-06-01').getTime()
  return {
    show: sh,
    row: seasonRow({ show_id: sh.id, season: 1, started_at: new Date(start).toISOString(), finished_at: new Date(start + days * DAY).toISOString() }),
    score: score(sh.id, 1, 'avi', s),
  }
}

function pattern(...seasons: [number, number][]) {
  const items = seasons.map(([s, d]) => rated(s, d))
  return ratingPace(seasonRuns(items.map((i) => i.show), items.map((i) => i.row), items.map((i) => i.score)))
}

describe('ratingPace', () => {
  it("doesn't call a pattern until there are a few rated seasons", () => {
    const p = pattern([9, 5], [5, 30], [8, 7])
    expect(MIN_RUNS).toBe(4)
    expect(p.r).toBeNull()
    expect(p.factor(9)).toBe(1)
  })

  it('finds that the ones they love go faster, and says how much', () => {
    const p = pattern([9.5, 4], [9, 5], [8, 8], [6, 20], [5, 30], [4, 40])
    expect(p.r!).toBeGreaterThan(0.9)
    expect(p.loved!.hoursPerWeek).toBeGreaterThan(p.meh!.hoursPerWeek * 2)
    expect(p.factor(9.5)).toBeGreaterThan(1.1)
    expect(p.factor(4)).toBeLessThan(0.9)
    // Never more than 1.6× either way, however strong the habit.
    expect(p.factor(100)).toBeCloseTo(1.6, 5)
  })

  it('finds nothing when speed has nothing to do with the score', () => {
    const p = pattern([9, 10], [5, 10], [7, 10], [8, 10])
    expect(p.r).toBe(0)
    expect(p.factor(9)).toBe(1)
  })
})

describe('speed in the estimates', () => {
  it('runs a show they rate highly faster, and leaves unrated shows alone', () => {
    const p = pattern([9.5, 4], [9, 5], [8, 8], [6, 20], [5, 30], [4, 40])
    const loved = show({ stage: 'lineup', lineup_order: 1, episodes: [...season(1, 10, '2020-01-01', 30), ...season(2, 10, '2021-01-01', 30)], plan_from: 2 })
    const unrated = show({ stage: 'lineup', lineup_order: 2, episodes: season(1, 10, '2020-01-01', 30) })
    const ratings = [score(loved.id, 1, 'avi', 9.5)]
    const speed = speedFactors([loved, unrated], ratings, p)
    expect(speed.get(loved.id)!).toBeGreaterThan(1.1)
    expect(speed.has(unrated.id)).toBe(false)

    const now = at('2026-10-12')
    const plain = projectLineup([loved], [], 300, now).get(loved.id)!
    const fast = projectLineup([loved], [], 300, now, undefined, speed).get(loved.id)!
    expect(fast.finish!.getTime()).toBeLessThan(plain.finish!.getTime())
    // The time left is still the real running time.
    expect(fast.minutesLeft).toBe(300)
    expect(dayOf(fast.start)).toBe('2026-10-12')
  })
})
