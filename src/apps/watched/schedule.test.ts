import { describe, expect, it } from 'vitest'
import { assignLanes, estimatePosition, projectLineup, timeToWatch } from './schedule'
import { at, dayOf, season, seasonRow, seasonsInfo, show } from './testkit'

/**
 * The estimates are the feature, so these pin the arithmetic day by day.
 * Every scenario runs from local noon on Mon 12 Oct 2026, so "day 0" is the
 * 12th, and paces are picked to make the daily budget a round number.
 */

const NOW = at('2026-10-12')

describe('projectLineup: one thing at a time', () => {
  it('finishes a binge at the pace, starting today', () => {
    // 10 × 30 min = 300 min, at 300 a week: seven days, so done on day 6.
    const a = show({ episodes: season(1, 10, '2020-01-01', 30) })
    const p = projectLineup([a], [], 300, NOW).get(a.id)!
    expect(dayOf(p.start)).toBe('2026-10-12')
    expect(dayOf(p.finish)).toBe('2026-10-18')
    expect(p.minutesLeft).toBe(300)
    expect(p.episodesLeft).toBe(10)
    expect(p.tba).toBe(false)
  })

  it('starts the next show when the one before it ends', () => {
    const a = show({ lineup_order: 1, episodes: season(1, 10, '2020-01-01', 30) })
    const b = show({ lineup_order: 2, episodes: season(1, 10, '2020-01-01', 30) })
    const out = projectLineup([b, a], [], 300, NOW)
    expect(dayOf(out.get(a.id)!.finish)).toBe('2026-10-18')
    expect(dayOf(out.get(b.id)!.start)).toBe('2026-10-19')
    expect(dayOf(out.get(b.id)!.finish)).toBe('2026-10-25')
  })

  it('leaves shelf, watched and dropped shows out', () => {
    const shelf = show({ stage: 'shelf', episodes: season(1, 2, '2020-01-01') })
    const done = show({ stage: 'watched', episodes: season(1, 2, '2020-01-01') })
    const dropped = show({ stage: 'dropped', episodes: season(1, 2, '2020-01-01') })
    expect(projectLineup([shelf, done, dropped], [], 300, NOW).size).toBe(0)
  })
})

describe('projectLineup: two at once', () => {
  it('watches a weekly show as it airs and binges something else around it', () => {
    // 60 min a day. The weekly show takes its episode on air day; the binge
    // gets every other day.
    const weekly = show({ live: true, lineup_order: 1, episodes: season(1, 8, '2026-10-12', 60, 7) })
    const binge = show({ lineup_order: 2, episodes: season(1, 10, '2015-01-01', 60) })
    const out = projectLineup([weekly, binge], [], 420, NOW)

    const w = out.get(weekly.id)!
    expect(dayOf(w.start)).toBe('2026-10-12')
    // Episode 8 airs seven weeks after the first: Nov 30.
    expect(dayOf(w.finish)).toBe('2026-11-30')

    const b = out.get(binge.id)!
    // Day 0 went to the weekly premiere; the binge starts the next day,
    // gets six days, loses day 7 to episode 2, and needs four more.
    expect(dayOf(b.start)).toBe('2026-10-13')
    expect(dayOf(b.finish)).toBe('2026-10-23')
  })

  it("slots an upcoming premiere in alongside whatever is on when it starts airing", () => {
    const binge = show({ lineup_order: 1, episodes: season(1, 30, '2010-01-01', 60) })
    const upcoming = show({ live: true, lineup_order: 2, episodes: season(1, 4, '2026-11-01', 60, 7) })
    const out = projectLineup([binge, upcoming], [], 420, NOW)

    expect(dayOf(out.get(upcoming.id)!.start)).toBe('2026-11-01')
    expect(dayOf(out.get(upcoming.id)!.finish)).toBe('2026-11-22')
    // The binge lost two days to the premiere and the second episode.
    expect(dayOf(out.get(binge.id)!.finish)).toBe('2026-11-12')
  })

  it('moves on to the next show when a binge catches up with something still airing', () => {
    // Four episodes out (the last airing today), four more weekly.
    const airing = show({ lineup_order: 1, episodes: season(1, 8, '2026-09-21', 60, 7) })
    const next = show({ lineup_order: 2, episodes: season(1, 10, '2015-01-01', 60) })
    const out = projectLineup([airing, next], [], 420, NOW)
    const a = out.get(airing.id)!
    const n = out.get(next.id)!
    // Days 0-3 clear the four that are out; day 4 has nothing, so the next
    // show starts then rather than waiting for the season to finish airing.
    expect(dayOf(n.start)).toBe('2026-10-16')
    expect(a.finish!.getTime()).toBeGreaterThanOrEqual(at('2026-11-09').getTime() - 12 * 3600_000)
    expect(n.start!.getTime()).toBeLessThan(a.finish!.getTime())
  })

  it('splits the time between two shows that were both started', () => {
    const one = show({
      stage: 'watching',
      current_season: 1,
      started_at: NOW.toISOString(),
      progress_at: NOW.toISOString(),
      episodes: season(1, 7, '2015-01-01', 60),
    })
    const two = show({
      stage: 'watching',
      current_season: 1,
      started_at: NOW.toISOString(),
      progress_at: NOW.toISOString(),
      episodes: season(1, 7, '2015-01-01', 60),
    })
    const out = projectLineup([one, two], [], 420, NOW)
    // Half an hour a day each: seven hours of each takes two weeks.
    expect(dayOf(out.get(one.id)!.finish)).toBe('2026-10-25')
    expect(dayOf(out.get(two.id)!.finish)).toBe('2026-10-25')
  })
})

describe('projectLineup: dates nobody knows yet', () => {
  it('reports an announced season with no dates as TBA instead of guessing', () => {
    const s = show({
      episodes: season(1, 3, '2015-01-01', 60),
      seasons: seasonsInfo({ n: 1, eps: 3 }, { n: 2, eps: 8 }),
    })
    const p = projectLineup([s], [], 420, NOW).get(s.id)!
    expect(p.tba).toBe(true)
    expect(p.finish).toBeNull()
    expect(dayOf(p.seasonFinish.get(1))).toBe('2026-10-14')
    expect(p.seasonFinish.has(2)).toBe(false)
  })

  it('jumps ahead to a premiere a year away', () => {
    const later = show({ episodes: season(1, 2, '2027-11-15', 60, 7) })
    const p = projectLineup([later], [], 420, NOW).get(later.id)!
    expect(dayOf(p.start)).toBe('2027-11-15')
    expect(dayOf(p.finish)).toBe('2027-11-22')
    expect(dayOf(p.waitingUntil)).toBe('2027-11-15')
  })

  it('waits for a season with nothing listed instead of calling it done', () => {
    // Caught up on two seasons, waiting in the lineup for a third that has
    // been announced with no episodes.
    const waiting = show({
      tvmaze_id: 11,
      status: 'Running',
      live: true,
      plan_from: 3,
      episodes: [...season(1, 9, '2022-02-18', 55, 7), ...season(2, 10, '2025-01-17', 50, 7)],
      seasons: seasonsInfo({ n: 1, eps: 9 }, { n: 2, eps: 10 }, { n: 3, eps: 0 }),
    })
    const p = projectLineup([waiting], [], 420, NOW).get(waiting.id)!
    expect(p.finish).toBeNull()
    expect(p.tba).toBe(true)
    expect(p.start).toBeNull()
    expect(p.episodesLeft).toBe(0)

    // Over is over, though: an ended show with nothing left is done.
    const ended = { ...waiting, status: 'Ended' }
    expect(projectLineup([ended], [], 420, NOW).get(ended.id)!.finish).not.toBeNull()
  })

  it('says so when it would take longer than the horizon', () => {
    const huge = show({ episodes: season(1, 100, '2015-01-01', 60) })
    const p = projectLineup([huge], [], 15, NOW, 30).get(huge.id)!
    expect(p.finish).toBeNull()
    expect(p.beyond).toBe(true)
    expect(p.tba).toBe(false)
  })
})

describe('estimatePosition', () => {
  const twoSeasons = [...season(1, 10, '2010-01-01', 60), ...season(2, 10, '2011-01-01', 60)]

  it('estimates how far into the season they are from the pace', () => {
    // Ten days at an hour a day is all ten episodes — but they haven't said
    // they finished, so it stops at the last one.
    const w = show({ stage: 'watching', current_season: 2, started_at: at('2026-10-02').toISOString(), episodes: twoSeasons })
    const log = [seasonRow({ show_id: w.id, season: 2, started_at: at('2026-10-02').toISOString() })]
    expect(estimatePosition(w, log, 420, NOW)).toEqual({ season: 2, done: 9, estimated: true })

    const p = projectLineup([w], log, 420, NOW).get(w.id)!
    expect(p.position).toEqual({ season: 2, done: 9, estimated: true })
    expect(p.episodesLeft).toBe(1)
    expect(dayOf(p.finish)).toBe('2026-10-12')
  })

  it('takes their word for it when they said where they are just now', () => {
    const w = show({
      stage: 'watching',
      current_season: 1,
      current_episode: 3,
      progress_at: NOW.toISOString(),
      episodes: twoSeasons,
    })
    expect(estimatePosition(w, [], 420, NOW)).toEqual({ season: 1, done: 3, estimated: false })
  })

  it("assumes a show watched as it airs is caught up with what's out", () => {
    const w = show({
      stage: 'watching',
      live: true,
      current_season: 1,
      started_at: at('2026-09-14').toISOString(),
      episodes: season(1, 10, '2026-09-14', 45, 7),
    })
    // Out by Oct 12: Sep 14, 21, 28, Oct 5, Oct 12.
    expect(estimatePosition(w, [], 240, NOW)?.done).toBe(5)
  })

  it('never counts an episode that has not aired', () => {
    const w = show({
      stage: 'watching',
      current_season: 1,
      started_at: at('2026-01-01').toISOString(),
      episodes: season(1, 10, '2026-10-05', 30, 7),
    })
    // Months of pace, but only Oct 5 and Oct 12 are out.
    expect(estimatePosition(w, [], 600, NOW)?.done).toBe(2)
  })
})

describe('assignLanes', () => {
  it('keeps back-to-back shows on one row', () => {
    const lanes = assignLanes(
      [
        { id: 'a', start: at('2026-10-01'), finish: at('2026-10-20') },
        { id: 'b', start: at('2026-10-20'), finish: at('2026-11-20') },
      ],
      at('2030-01-01'),
    )
    expect([lanes.get('a'), lanes.get('b')]).toEqual([0, 0])
  })

  it('stacks overlapping shows and reuses a row once it frees up', () => {
    const lanes = assignLanes(
      [
        { id: 'a', start: at('2026-10-01'), finish: at('2026-10-20') },
        { id: 'b', start: at('2026-10-05'), finish: at('2026-10-10') },
        { id: 'c', start: at('2026-10-12'), finish: at('2026-10-30') },
        { id: 'd', start: at('2026-10-25'), finish: null },
      ],
      at('2030-01-01'),
    )
    expect(lanes.get('a')).toBe(0)
    expect(lanes.get('b')).toBe(1)
    expect(lanes.get('c')).toBe(1)
    expect(lanes.get('d')).toBe(0)
  })
})

describe('timeToWatch', () => {
  it("counts only what has aired, and says how much hasn't", () => {
    const s = show({
      stage: 'shelf',
      episodes: [...season(1, 4, '2026-09-21', 60, 7), [1, 5, 60, '2026-10-19'], [1, 6, 60, null]],
    })
    const t = timeToWatch(s, 420, NOW)
    expect(t.episodes).toBe(4)
    expect(t.minutes).toBe(240)
    expect(t.unaired).toBe(2)
    expect(t.days).toBe(4)
  })
})
