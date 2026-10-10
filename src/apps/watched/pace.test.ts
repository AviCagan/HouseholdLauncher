import { describe, expect, it } from 'vitest'
import { DEFAULT_PACE, clampPace, effectivePace, episodesPerWeek, measurePace } from './pace'
import { at, season, seasonRow, show } from './testkit'
import type { WatchSettings } from '@/data/types'

const NOW = at('2026-10-12')
const iso = (d: string) => at(d).toISOString()

const settings = (patch: Partial<WatchSettings> = {}): WatchSettings => ({
  singleton: true,
  pace_mode: 'auto',
  pace_minutes: DEFAULT_PACE,
  updated_by: null,
  updated_at: '2026-01-01T00:00:00.000Z',
  ...patch,
})

describe('measurePace', () => {
  it('has nothing to say before a season is finished', () => {
    const s = show({ episodes: season(1, 10, '2020-01-01', 30) })
    expect(measurePace([], [s], NOW)).toBeNull()
    expect(measurePace([seasonRow({ show_id: s.id, season: 1, started_at: iso('2026-10-01') })], [s], NOW)).toBeNull()
  })

  it('divides what was watched by the time it took, breaks included', () => {
    // 300 min over Sep 1-15 and 360 min over Sep 10-29, overlapping: 660 min
    // in the 28 days from the first start to the last finish.
    const a = show({ episodes: season(1, 10, '2020-01-01', 30) })
    const b = show({ episodes: season(1, 6, '2020-01-01', 60) })
    const log = [
      seasonRow({ show_id: a.id, season: 1, started_at: iso('2026-09-01'), finished_at: iso('2026-09-15') }),
      seasonRow({ show_id: b.id, season: 1, started_at: iso('2026-09-10'), finished_at: iso('2026-09-29') }),
    ]
    const sample = measurePace(log, [a, b], NOW)!
    expect(sample.minutes).toBe(660)
    expect(sample.episodes).toBe(16)
    expect(sample.seasons).toBe(2)
    expect(sample.days).toBeCloseTo(28, 5)
    expect(effectivePace(settings(), sample).minutesPerWeek).toBe(165)
  })

  it('never counts shows added after the fact', () => {
    const backfilled = show({ watched_before: true, episodes: season(1, 10, '2020-01-01', 30) })
    const flagged = show({ episodes: season(1, 10, '2020-01-01', 30) })
    const log = [
      seasonRow({ show_id: backfilled.id, season: 1, started_at: iso('2026-09-01'), finished_at: iso('2026-09-10') }),
      seasonRow({ show_id: flagged.id, season: 1, started_at: iso('2026-09-01'), finished_at: iso('2026-09-10'), watched_before: true }),
    ]
    expect(measurePace(log, [backfilled, flagged], NOW)).toBeNull()
  })

  it("spreads a weekend binge over a week so one binge doesn't rewrite every date", () => {
    const s = show({ episodes: season(1, 10, '2020-01-01', 30) })
    const log = [seasonRow({ show_id: s.id, season: 1, started_at: iso('2026-10-03'), finished_at: iso('2026-10-05') })]
    const sample = measurePace(log, [s], NOW)!
    expect(sample.days).toBe(7)
    expect(sample.spanDays).toBeCloseTo(2, 5)
  })

  it('leans on the dial until there are a few weeks of history', () => {
    // 300 measured from two days of history: 2/21 of the way from the dial.
    const sample = { seasons: 1, episodes: 10, minutes: 300, days: 7, spanDays: 2, from: '', to: '' }
    const pace = effectivePace(settings({ pace_minutes: 240 }), sample)
    expect(pace.confidence).toBeCloseTo(2 / 21, 5)
    expect(pace.minutesPerWeek).toBe(Math.round(300 * (2 / 21) + 240 * (19 / 21)))
    // Three weeks in, it's all the record.
    expect(effectivePace(settings({ pace_minutes: 240 }), { ...sample, spanDays: 21 }).minutesPerWeek).toBe(300)
  })

  it('uses the last year when there is one, and older history only when there is not', () => {
    const old = show({ episodes: season(1, 10, '2010-01-01', 60) })
    const recent = show({ episodes: season(1, 4, '2020-01-01', 30) })
    const log = [
      seasonRow({ show_id: old.id, season: 1, started_at: iso('2024-01-01'), finished_at: iso('2024-01-08') }),
      seasonRow({ show_id: recent.id, season: 1, started_at: iso('2026-09-01'), finished_at: iso('2026-09-15') }),
    ]
    expect(measurePace(log, [old, recent], NOW)!.minutes).toBe(120)
    expect(measurePace(log.slice(0, 1), [old, recent], NOW)!.minutes).toBe(600)
  })

  it('counts the season on now, up to where someone said they were', () => {
    const s = show({
      stage: 'watching',
      current_season: 1,
      current_episode: 4,
      progress_at: iso('2026-10-11'),
      started_at: iso('2026-10-04'),
      episodes: season(1, 10, '2020-01-01', 45),
    })
    const sample = measurePace([], [s], NOW)!
    expect(sample.minutes).toBe(180)
    expect(sample.days).toBeCloseTo(7, 5)
    expect(sample.spanDays).toBeCloseTo(7, 5)
  })
})

describe('effectivePace', () => {
  it('uses the dial until there is a record, then the record', () => {
    expect(effectivePace(undefined, null)).toEqual({ minutesPerWeek: DEFAULT_PACE, source: 'default', sample: null, confidence: 0 })
    expect(effectivePace(settings({ pace_minutes: 300 }), null).minutesPerWeek).toBe(300)
    const sample = { seasons: 1, episodes: 10, minutes: 700, days: 7, spanDays: 30, from: '', to: '' }
    expect(effectivePace(settings({ pace_minutes: 300 }), sample)).toMatchObject({ minutesPerWeek: 700, source: 'measured' })
  })

  it('means it when set to manual', () => {
    const sample = { seasons: 1, episodes: 10, minutes: 700, days: 7, spanDays: 30, from: '', to: '' }
    expect(effectivePace(settings({ pace_mode: 'manual', pace_minutes: 120 }), sample)).toMatchObject({
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
