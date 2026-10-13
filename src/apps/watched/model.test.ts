import { describe, expect, it } from 'vitest'
import { DEFAULT_RUNTIME, addDaysIso, allEpisodes, daysBetweenIso, formatHours, formatMinutes, formatSpan, hasUnairedEpisodes, lastPlannedSeason, remainingEpisodes, seasonFullyAired, seasonStats, showTotals, yearsLabel, seasonsOut, lastSeasonOut } from './model'
import { season, seasonsInfo, show } from './testkit'

describe('allEpisodes', () => {
  it('orders listed episodes and fills in missing runtimes', () => {
    const s = show({
      avg_runtime: 50,
      episodes: [
        [2, 1, null, '2021-01-01'],
        [1, 2, 40, '2020-01-08'],
        [1, 1, 42, '2020-01-01'],
      ],
    })
    expect(allEpisodes(s).map((e) => [e.season, e.number, e.minutes])).toEqual([
      [1, 1, 42],
      [1, 2, 40],
      [2, 1, 50],
    ])
    expect(allEpisodes(show({ episodes: [[1, 1, null, null]] }))[0].minutes).toBe(DEFAULT_RUNTIME)
  })

  it('infers the rest of an announced season at the cadence of what is listed', () => {
    // Six announced, two listed a week apart: the other four follow weekly.
    const s = show({ avg_runtime: 50, seasons: seasonsInfo({ n: 1, eps: 6 }), episodes: season(1, 2, '2026-10-01', 50, 7) })
    const eps = allEpisodes(s)
    expect(eps).toHaveLength(6)
    expect(eps.slice(2).map((e) => [e.number, e.airdate, e.inferred])).toEqual([
      [3, '2026-10-15', true],
      [4, '2026-10-22', true],
      [5, '2026-10-29', true],
      [6, '2026-11-05', true],
    ])
  })

  it('treats a streaming drop as a drop', () => {
    const s = show({ seasons: seasonsInfo({ n: 1, eps: 5 }), episodes: season(1, 3, '2026-10-01', 50, 0) })
    expect(new Set(allEpisodes(s).map((e) => e.airdate))).toEqual(new Set(['2026-10-01']))
  })

  it('dates a season from its premiere when nothing is listed, and leaves it undated when nothing is known', () => {
    const s = show({ seasons: seasonsInfo({ n: 2, eps: 3, premiere: '2027-01-10' }, { n: 3, eps: 2 }) })
    expect(allEpisodes(s).map((e) => [e.season, e.number, e.airdate])).toEqual([
      [2, 1, '2027-01-10'],
      [2, 2, '2027-01-17'],
      [2, 3, '2027-01-24'],
      [3, 1, null],
      [3, 2, null],
    ])
  })
})

describe('seasonStats / showTotals', () => {
  const s = show({
    avg_runtime: 45,
    seasons: seasonsInfo({ n: 1, eps: 3 }, { n: 2, eps: 4 }, { n: 3 }),
    episodes: [...season(1, 3, '2026-01-01', 30), ...season(2, 2, '2026-10-05', 60, 7)],
  })

  it('counts per season, including what is still to air', () => {
    const [one, two, three] = seasonStats(s, '2026-10-12')
    expect(one).toMatchObject({ n: 1, episodes: 3, minutes: 90, avgRuntime: 30, aired: 3, tba: false })
    // Two listed (Oct 5 and 12, both out) plus two inferred at 45 min.
    expect(two).toMatchObject({ n: 2, episodes: 4, minutes: 210, aired: 2, tba: false })
    expect(three).toMatchObject({ n: 3, episodes: 0, tba: true })
  })

  it('adds up the show', () => {
    const t = showTotals(s, '2026-10-12')
    // Season 3 is only announced: coming, not out.
    expect(t).toMatchObject({ seasons: 2, comingSeasons: 1, episodes: 7, minutes: 300, airedEpisodes: 5, airedMinutes: 210 })
    expect(t.avgEpisodesPerSeason).toBe(3.5)
  })

  it('knows which seasons are fully out', () => {
    expect(seasonFullyAired(s, 1, '2026-10-12')).toBe(true)
    expect(seasonFullyAired(s, 2, '2026-10-12')).toBe(false)
    expect(hasUnairedEpisodes(s, '2026-10-12')).toBe(true)
    expect(lastPlannedSeason(s)).toBe(2)
  })
})

describe('remainingEpisodes', () => {
  const s = show({ episodes: [...season(1, 3, '2020-01-01'), ...season(2, 3, '2021-01-01'), ...season(3, 3, '2022-01-01')] })

  it('starts where they are', () => {
    const left = remainingEpisodes(s, { season: 2, done: 1 })
    expect(left.map((e) => `${e.season}x${e.number}`)).toEqual(['2x2', '2x3', '3x1', '3x2', '3x3'])
  })

  it('honours the seasons the slot covers', () => {
    const slot = { ...s, plan_from: 2, plan_to: 2 }
    expect(remainingEpisodes(slot).map((e) => `${e.season}x${e.number}`)).toEqual(['2x1', '2x2', '2x3'])
  })
})

describe('formatting', () => {
  it('does dates without time zones', () => {
    expect(addDaysIso('2026-10-30', 3)).toBe('2026-11-02')
    expect(addDaysIso('2028-02-28', 1)).toBe('2028-02-29')
    expect(daysBetweenIso('2026-10-01', '2026-11-01')).toBe(31)
  })

  it('says durations the way people do', () => {
    expect(formatMinutes(45)).toBe('45m')
    expect(formatMinutes(120)).toBe('2h')
    expect(formatMinutes(2000)).toBe('33h 20m')
    expect(formatHours(2000)).toBe('33 hrs')
    expect(formatHours(90)).toBe('1.5 hrs')
    expect(formatSpan(5)).toBe('5 days')
    expect(formatSpan(21)).toBe('3 weeks')
    expect(formatSpan(150)).toBe('5 months')
    expect(formatSpan(913)).toBe('2.5 years')
  })

  it('lists the years a show ran like a TV guide', () => {
    expect(yearsLabel({ premiered: '2019-01-01', ended: '2023-05-01', status: 'Ended' })).toBe('2019–2023')
    expect(yearsLabel({ premiered: '2022-02-18', ended: null, status: 'Running' })).toBe('2022–')
    expect(yearsLabel({ premiered: '2020-01-01', ended: '2020-06-01', status: 'Ended' })).toBe('2020')
    expect(yearsLabel({ premiered: null, ended: null, status: null })).toBe('')
  })
})

describe('seasons that are out', () => {
  // Daredevil: Born Again as TVmaze has it: two seasons out, a third
  // announced with eight episodes and no dates.
  const bornAgain = () =>
    show({
      status: 'Running',
      tvmaze_id: 1,
      episodes: [...season(1, 9, '2025-03-04', 50, 7), ...season(2, 8, '2026-03-24', 50, 7)],
      seasons: seasonsInfo({ n: 1, eps: 9 }, { n: 2, eps: 8 }, { n: 3, eps: 8 }),
    })

  it("doesn't count an announced season as out", () => {
    const s = bornAgain()
    expect(seasonsOut(s, '2026-10-13')).toEqual([1, 2])
    expect(lastSeasonOut(s, '2026-10-13')).toBe(2)
    const totals = showTotals(s, '2026-10-13')
    expect(totals.seasons).toBe(2)
    expect(totals.comingSeasons).toBe(1)
    expect(totals.airedEpisodes).toBe(17)
  })

  it('counts a season once its first episode is out', () => {
    expect(seasonsOut(bornAgain(), '2026-03-24')).toEqual([1, 2])
    expect(seasonsOut(bornAgain(), '2026-03-23')).toEqual([1])
  })
})
