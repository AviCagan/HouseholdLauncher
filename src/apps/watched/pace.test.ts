import { describe, expect, it } from 'vitest'
import { DEFAULT_PACE, clampPace, effectivePace, episodesPerWeek, measurePace, type PaceSample } from './pace'
import { at, season, seasonRow, show, view } from './testkit'
import type { WatchSettings, WatchShow } from '@/data/types'

const NOW = at('2026-10-12')
const DAY = 86_400_000
/** An ISO time `days` before NOW (fractions allowed). */
const ago = (days: number) => new Date(NOW.getTime() - days * DAY).toISOString()
/** NOW moved by `days`. */
const later = (days: number) => new Date(NOW.getTime() + days * DAY)

const settings = (patch: Partial<WatchSettings> = {}): WatchSettings => ({
  singleton: true,
  pace_mode: 'auto',
  pace_minutes: DEFAULT_PACE,
  updated_by: null,
  updated_at: '2026-01-01T00:00:00.000Z',
  ...patch,
})

const sample = (patch: Partial<PaceSample> = {}): PaceSample => ({
  episodes: 10,
  minutes: 300,
  minutesPerWeek: 300,
  spanDays: 30,
  from: '',
  to: '',
  ...patch,
})

/** Episodes 1, 2, 3… of season 1 watched `days` before NOW. */
function watchedAt(s: WatchShow, ...days: number[]) {
  return days.map((d, i) => view({ show_id: s.id, season: 1, episode: i + 1, watched_at: ago(d) }))
}

const drama = () => show({ stage: 'watching', current_season: 1, episodes: season(1, 20, '2020-01-01', 45) })

describe('measurePace: learning from episodes', () => {
  it('has nothing to say before anything is watched', () => {
    expect(measurePace([], [drama()], [], NOW)).toBeNull()
  })

  it('learns "four episodes in two days" straight away', () => {
    const s = drama()
    const got = measurePace([], [s], watchedAt(s, 2, 1.95, 1, 0), NOW)!
    expect(got.episodes).toBe(4)
    expect(got.minutes).toBe(180)
    // 180 minutes in two days is about 630 a week, give or take the weighting.
    expect(got.minutesPerWeek).toBeGreaterThan(560)
    expect(got.minutesPerWeek).toBeLessThan(680)
  })

  it('moves with every episode logged', () => {
    const s = drama()
    const views = watchedAt(s, 6, 4, 2)
    const before = measurePace([], [s], views, NOW)!.minutesPerWeek
    const tonight = view({ show_id: s.id, season: 1, episode: 4, watched_at: ago(0) })
    expect(measurePace([], [s], [...views, tonight], NOW)!.minutesPerWeek).toBeGreaterThan(before)
  })

  it('counts an episode logged after the screen last read the clock', () => {
    const s = drama()
    const views = watchedAt(s, 3, 2, 1)
    const before = measurePace([], [s], views, NOW)!
    const justNow = view({ show_id: s.id, season: 1, episode: 4, watched_at: new Date(NOW.getTime() + 5 * 60_000).toISOString() })
    const after = measurePace([], [s], [...views, justNow], NOW)!
    expect(after.episodes).toBe(4)
    expect(after.minutesPerWeek).toBeGreaterThan(before.minutesPerWeek)
  })

  it('weights how they watch now over how they watched a month ago', () => {
    const s = drama()
    // The same eight episodes over the same five weeks: bunched up early, or late.
    const early = watchedAt(s, 35, 34, 33, 32, 31, 30, 29, 0)
    const late = watchedAt(s, 35, 6, 5, 4, 3, 2, 1, 0)
    expect(measurePace([], [s], late, NOW)!.minutesPerWeek).toBeGreaterThan(
      measurePace([], [s], early, NOW)!.minutesPerWeek * 2,
    )
  })

  it('lets a quiet week slow it down, but not a month away', () => {
    const s = drama()
    const habit = watchedAt(s, 9, 7, 5, 3)
    const onTheDay = measurePace([], [s], habit, later(-3))!.minutesPerWeek
    const quietWeek = measurePace([], [s], habit, later(4))!.minutesPerWeek
    const tenDays = measurePace([], [s], habit, later(7))!.minutesPerWeek
    const monthAway = measurePace([], [s], habit, later(27))!.minutesPerWeek
    expect(quietWeek).toBeLessThan(onTheDay)
    // Idle time stops counting after ten days: a month away reads like ten days.
    expect(monthAway).toBeCloseTo(tenDays, 5)
  })

  it('adds up two shows watched side by side', () => {
    const a = drama()
    const b = drama()
    const one = measurePace([], [a, b], watchedAt(a, 6, 4, 2, 0), NOW)!.minutesPerWeek
    const both = measurePace([], [a, b], [...watchedAt(a, 6, 4, 2, 0), ...watchedAt(b, 5, 3, 1)], NOW)!.minutesPerWeek
    expect(both).toBeGreaterThan(one * 1.5)
  })

  it('uses the length logged with the episode, else the show’s own', () => {
    const s = drama()
    const logged = [view({ show_id: s.id, season: 1, episode: 1, watched_at: ago(1), minutes: 90 })]
    expect(measurePace([], [s], logged, NOW)!.minutes).toBe(90)
    expect(measurePace([], [s], watchedAt(s, 1), NOW)!.minutes).toBe(45)
  })
})

describe('measurePace: finished seasons', () => {
  it('spreads a season finished without ticking episodes over the dates given', () => {
    // Ten 60-minute episodes, started three weeks ago and finished one week ago.
    const s = show({ episodes: season(1, 10, '2020-01-01', 60) })
    const log = [seasonRow({ show_id: s.id, season: 1, started_at: ago(21), finished_at: ago(7) })]
    const got = measurePace(log, [s], [], NOW)!
    expect(got.minutes).toBe(600)
    expect(got.episodes).toBe(10)
    // 600 minutes over the three weeks to now: the week since counts as quiet.
    expect(got.minutesPerWeek).toBeGreaterThan(150)
    expect(got.minutesPerWeek).toBeLessThan(260)
  })

  it('never counts an episode twice when some were ticked and the season finished', () => {
    const s = show({ episodes: season(1, 10, '2020-01-01', 30) })
    const log = [seasonRow({ show_id: s.id, season: 1, started_at: ago(10), finished_at: ago(0) })]
    const views = [1, 2, 3, 4].map((e) => view({ show_id: s.id, season: 1, episode: e, watched_at: ago(10 - e) }))
    const got = measurePace(log, [s], views, NOW)!
    expect(got.minutes).toBe(300)
    expect(got.episodes).toBe(10)
  })

  it('counts the season on now up to where someone said they were', () => {
    const s = show({
      stage: 'watching',
      current_season: 1,
      current_episode: 4,
      progress_at: ago(1),
      started_at: ago(8),
      episodes: season(1, 10, '2020-01-01', 45),
    })
    expect(measurePace([], [s], [], NOW)!.minutes).toBe(180)
    // Episodes ticked one by one aren't counted again from the stretch.
    const views = [3, 4].map((e) => view({ show_id: s.id, season: 1, episode: e, watched_at: ago(5 - e) }))
    const got = measurePace([], [s], views, NOW)!
    expect(got.minutes).toBe(180)
    expect(got.episodes).toBe(4)
  })

  it("ignores a season ticked off faster than it runs — nobody knows when it was watched", () => {
    const s = show({ episodes: season(1, 5, '2020-01-01', 70) })
    const log = [seasonRow({ show_id: s.id, season: 1, started_at: ago(0.01), finished_at: ago(0) })]
    expect(measurePace(log, [s], [], NOW)).toBeNull()
  })

  it('never counts shows added after the fact', () => {
    const backfilled = show({ watched_before: true, episodes: season(1, 10, '2020-01-01', 30) })
    const flagged = show({ episodes: season(1, 10, '2020-01-01', 30) })
    const log = [
      seasonRow({ show_id: backfilled.id, season: 1, started_at: ago(30), finished_at: ago(20) }),
      seasonRow({ show_id: flagged.id, season: 1, started_at: ago(30), finished_at: ago(20), watched_before: true }),
    ]
    const views = [view({ show_id: backfilled.id, season: 1, episode: 1, watched_at: ago(1) })]
    expect(measurePace(log, [backfilled, flagged], views, NOW)).toBeNull()
  })

  it('forgets anything older than a year', () => {
    const s = show({ episodes: season(1, 10, '2010-01-01', 60) })
    const log = [seasonRow({ show_id: s.id, season: 1, started_at: ago(420), finished_at: ago(400) })]
    expect(measurePace(log, [s], [], NOW)).toBeNull()
  })
})

describe('effectivePace', () => {
  it('uses the dial until there is a record, then the record', () => {
    expect(effectivePace(undefined, null)).toEqual({ minutesPerWeek: DEFAULT_PACE, source: 'default', sample: null, confidence: 0 })
    expect(effectivePace(settings({ pace_minutes: 300 }), null).minutesPerWeek).toBe(300)
    expect(effectivePace(settings({ pace_minutes: 300 }), sample({ minutesPerWeek: 700 }))).toMatchObject({
      minutesPerWeek: 700,
      source: 'measured',
    })
  })

  it('leans on the dial until there are a couple of weeks of history', () => {
    const pace = effectivePace(settings({ pace_minutes: 240 }), sample({ minutesPerWeek: 600, spanDays: 2 }))
    expect(pace.confidence).toBeCloseTo(2 / 14, 5)
    expect(pace.minutesPerWeek).toBe(Math.round(600 * (2 / 14) + 240 * (12 / 14)))
    expect(effectivePace(settings({ pace_minutes: 240 }), sample({ minutesPerWeek: 600, spanDays: 14 })).minutesPerWeek).toBe(600)
  })

  it('means it when set to manual', () => {
    expect(effectivePace(settings({ pace_mode: 'manual', pace_minutes: 120 }), sample({ minutesPerWeek: 700 }))).toMatchObject({
      minutesPerWeek: 120,
      source: 'manual',
    })
  })

  it('keeps the pace inside sane bounds', () => {
    expect(clampPace(1)).toBe(15)
    expect(clampPace(1e9)).toBe(10080)
    expect(episodesPerWeek(240, 45)).toBeCloseTo(5.33, 2)
    expect(episodesPerWeek(240, 0)).toBe(0)
  })
})
