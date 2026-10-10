import { describe, expect, it } from 'vitest'
import { average, formatScore, rankSeasons, rankShows, seasonScores, showScores, toX2 } from './ratings'
import { show } from './testkit'
import type { WatchRating } from '@/data/types'

const AVI = 'avi'
const JACKIE = 'jackie'

let n = 0
const rating = (show_id: string, season: number, profile_id: string, score: number): WatchRating => ({
  id: `r${++n}`,
  show_id,
  season,
  profile_id,
  score_x2: Math.round(score * 2),
  created_at: '',
  updated_at: '',
})

describe('scores', () => {
  it('averages whoever rated, to one decimal', () => {
    expect(average([])).toBeNull()
    expect(average([8, 9])).toBe(8.5)
    expect(average([7, 8, 8])).toBe(7.7)
    expect(formatScore(8)).toBe('8')
    expect(formatScore(8.5)).toBe('8.5')
    expect(formatScore(null)).toBe('–')
    expect(toX2(8.4)).toBe(17)
    expect(toX2(0)).toBe(1)
    expect(toX2(11)).toBe(20)
  })

  it('combines one season', () => {
    const r = [rating('s', 1, AVI, 8), rating('s', 1, JACKIE, 9), rating('s', 2, AVI, 3)]
    const scores = seasonScores(r, 's', 1)
    expect(scores.byPerson.get(AVI)).toBe(8)
    expect(scores.byPerson.get(JACKIE)).toBe(9)
    expect(scores.together).toBe(8.5)
  })

  it("uses each person's whole-show rating, or their seasons' average when they only rated seasons", () => {
    const r = [
      rating('s', 0, AVI, 9),
      rating('s', 1, AVI, 5),
      rating('s', 1, JACKIE, 6),
      rating('s', 2, JACKIE, 8),
    ]
    const scores = showScores(r, 's')
    expect(scores.byPerson.get(AVI)).toBe(9)
    expect(scores.basis.get(AVI)).toBe('show')
    expect(scores.byPerson.get(JACKIE)).toBe(7)
    expect(scores.basis.get(JACKIE)).toBe('seasons')
    expect(scores.together).toBe(8)
  })
})

describe('rankings', () => {
  const a = show({ title: 'Alpha', stage: 'watched', finished_at: '2026-01-01' })
  const b = show({ title: 'Bravo', stage: 'watched', finished_at: '2026-02-01' })
  const c = show({ title: 'Charlie', stage: 'watched', finished_at: '2026-03-01' })
  const unrated = show({ title: 'Delta', stage: 'watched', finished_at: '2026-04-01' })
  const playing = show({ title: 'Echo', stage: 'watching' })
  const ratings = [
    rating(a.id, 0, AVI, 9),
    rating(a.id, 0, JACKIE, 7),
    rating(b.id, 0, AVI, 6),
    rating(b.id, 0, JACKIE, 10),
    rating(c.id, 0, AVI, 7),
    rating(c.id, 1, JACKIE, 9),
    rating(c.id, 2, JACKIE, 8),
    rating(playing.id, 1, AVI, 10),
  ]

  it('ranks watched shows by the combined score, ties sharing a place, unrated last', () => {
    const ranked = rankShows([a, b, c, unrated, playing], ratings, 'together')
    // Alpha 8, Bravo 8, Charlie (7 + 8.5) / 2 = 7.8. Ties break by most
    // recently finished but share the rank.
    expect(ranked.map((r) => [r.show.title, r.key, r.rank])).toEqual([
      ['Bravo', 8, 1],
      ['Alpha', 8, 1],
      ['Charlie', 7.8, 3],
      ['Delta', null, null],
    ])
  })

  it("ranks by one person's scores", () => {
    expect(rankShows([a, b, c], ratings, JACKIE).map((r) => r.show.title)).toEqual(['Bravo', 'Charlie', 'Alpha'])
    expect(rankShows([a, b, c], ratings, AVI).map((r) => r.show.title)).toEqual(['Alpha', 'Charlie', 'Bravo'])
  })

  it('ranks seasons across every show, including one still playing', () => {
    const seasons = rankSeasons([a, b, c, playing], ratings, 'together')
    expect(seasons.map((s) => [s.show.title, s.season, s.key])).toEqual([
      ['Echo', 1, 10],
      ['Charlie', 1, 9],
      ['Charlie', 2, 8],
    ])
    expect(seasons.map((s) => s.rank)).toEqual([1, 2, 3])
  })
})
