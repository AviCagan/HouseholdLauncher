import { describe, expect, it } from 'vitest'
import { largePoster, mapPosters, mapSearch, mapShowDetail, stripHtml, type TvmShow } from './tvmaze'
import { premieresFrom } from './comingSoon'
import { ratingRowId, seasonRowId, stableId } from './ids'

/**
 * Shapes copied from real TVmaze responses (Severance, trimmed), so a field
 * they rename or drop shows up here rather than as blank cards on the phone.
 */

const SEVERANCE: TvmShow = {
  id: 44933,
  name: 'Severance',
  type: 'Scripted',
  language: 'English',
  genres: ['Drama', 'Science-Fiction', 'Mystery'],
  status: 'Running',
  runtime: null,
  averageRuntime: 49,
  premiered: '2022-02-18',
  ended: null,
  network: null,
  webChannel: { name: 'Apple TV' },
  image: {
    medium: 'https://static.tvmaze.com/uploads/images/medium_portrait/548/1371406.jpg',
    original: 'https://static.tvmaze.com/uploads/images/original_untouched/548/1371406.jpg',
  },
  summary: '<p><b>Severance</b> follows Mark &amp; his team.</p>',
  _embedded: {
    seasons: [
      { number: 1, episodeOrder: 9, premiereDate: '2022-02-18', endDate: '2022-04-08' },
      { number: 2, episodeOrder: 10, premiereDate: '2025-01-17', endDate: '2025-03-21' },
      { number: 3, episodeOrder: null, premiereDate: null, endDate: null },
    ],
    episodes: [
      { season: 1, number: 1, type: 'regular', runtime: 57, airdate: '2022-02-18' },
      { season: 1, number: 2, type: 'regular', runtime: null, airdate: '2022-02-18' },
      { season: 1, number: null, type: 'significant_special', runtime: 20, airdate: '2022-03-01' },
      { season: 2, number: 10, type: 'regular', runtime: 75, airdate: '2025-03-21' },
      { season: 2, number: 11, type: 'regular', runtime: 50, airdate: '' },
    ],
    nextepisode: null,
    images: [
      {
        type: 'background',
        main: false,
        resolutions: { original: { url: 'https://x/bg.jpg', width: 3840, height: 2160 } },
      },
      {
        type: 'poster',
        main: false,
        resolutions: {
          original: { url: 'https://x/p1.jpg', width: 2000, height: 3000 },
          medium: { url: 'https://x/p1m.jpg', width: 210, height: 295 },
        },
      },
      {
        type: 'poster',
        main: true,
        resolutions: {
          original: { url: 'https://x/p0.jpg', width: 680, height: 1000 },
          medium: { url: 'https://x/p0m.jpg', width: 210, height: 295 },
        },
      },
    ],
  },
}

describe('mapShowDetail', () => {
  const d = mapShowDetail(SEVERANCE)

  it('keeps the show facts', () => {
    expect(d).toMatchObject({
      tvmaze_id: 44933,
      title: 'Severance',
      premiered: '2022-02-18',
      ended: null,
      status: 'Running',
      network: 'Apple TV',
      genres: ['Drama', 'Science-Fiction', 'Mystery'],
      avg_runtime: 49,
      next_airdate: null,
      summary: 'Severance follows Mark & his team.',
      poster_url: 'https://static.tvmaze.com/uploads/images/medium_portrait/548/1371406.jpg',
    })
  })

  it('packs episodes compactly, without specials, with blank dates as null', () => {
    expect(d.episodes).toEqual([
      [1, 1, 57, '2022-02-18'],
      [1, 2, null, '2022-02-18'],
      [2, 10, 75, '2025-03-21'],
      [2, 11, 50, null],
    ])
  })

  it('keeps announced seasons with nothing listed yet', () => {
    expect(d.seasons).toEqual([
      { n: 1, eps: 9, premiere: '2022-02-18', end: '2022-04-08' },
      { n: 2, eps: 10, premiere: '2025-01-17', end: '2025-03-21' },
      { n: 3, eps: null, premiere: null, end: null },
    ])
  })

  it('offers posters first, the main one leading, then other pictures', () => {
    expect(d.posters.map((p) => [p.kind, p.url, p.thumb])).toEqual([
      ['poster', 'https://x/p0.jpg', 'https://x/p0m.jpg'],
      ['poster', 'https://x/p1.jpg', 'https://x/p1m.jpg'],
      ['background', 'https://x/bg.jpg', 'https://x/bg.jpg'],
    ])
    expect(mapPosters(undefined)).toEqual([])
  })
})

describe('mapSearch', () => {
  it('turns search results into hits and skips junk', () => {
    const hits = mapSearch([{ score: 0.9, show: SEVERANCE }, { score: 0.1 }, { show: { id: 'x' } }])
    expect(hits).toHaveLength(1)
    expect(hits[0]).toMatchObject({
      tvmazeId: 44933,
      title: 'Severance',
      network: 'Apple TV',
      averageRuntime: 49,
      poster: SEVERANCE.image!.medium,
    })
    expect(mapSearch(null)).toEqual([])
  })
})

describe('helpers', () => {
  it('strips summaries to plain text', () => {
    expect(stripHtml('<p>One<br/>two &amp; three</p>')).toBe('One two & three')
    expect(stripHtml('')).toBeNull()
    expect(stripHtml('<p>abcdefghij</p>', 5)).toBe('abcd…')
  })

  it('finds the big version of a TVmaze poster', () => {
    expect(largePoster('https://static.tvmaze.com/uploads/images/medium_portrait/548/1.jpg')).toBe(
      'https://static.tvmaze.com/uploads/images/original_untouched/548/1.jpg',
    )
    expect(largePoster('https://elsewhere.com/a.jpg')).toBe('https://elsewhere.com/a.jpg')
    expect(largePoster(null)).toBeNull()
  })
})

describe('premieresFrom', () => {
  const entry = (show: Partial<TvmShow>, season: number, number: number | null, airdate: string, embedded = false) =>
    embedded
      ? { season, number, airdate, _embedded: { show: { id: 1, name: 'X', ...show } } }
      : { season, number, airdate, show: { id: 1, name: 'X', ...show } }

  it('keeps season premieres of shows worth suggesting, soonest airing per show', () => {
    const list = premieresFrom([
      entry({ id: 1, name: 'New Drama', type: 'Scripted', language: 'English' }, 1, 1, '2026-10-14'),
      entry({ id: 1, name: 'New Drama', type: 'Scripted', language: 'English' }, 1, 1, '2026-10-13'),
      entry({ id: 2, name: 'Returning', type: 'Scripted', language: 'English', webChannel: { name: 'Netflix' } }, 4, 1, '2026-10-15', true),
      entry({ id: 3, name: 'Mid-season', type: 'Scripted', language: 'English' }, 2, 5, '2026-10-13'),
      entry({ id: 4, name: 'Talk', type: 'Talk Show', language: 'English' }, 30, 1, '2026-10-13'),
      entry({ id: 5, name: 'Elsewhere', type: 'Scripted', language: 'Norwegian' }, 1, 1, '2026-10-13'),
    ])
    expect(list.map((u) => [u.tvmazeId, u.airdate, u.isNew, u.network])).toEqual([
      [1, '2026-10-13', true, null],
      [2, '2026-10-15', false, 'Netflix'],
    ])
    expect(premieresFrom('nope')).toEqual([])
  })
})

describe('stableId', () => {
  it('gives the same UUID for the same row from either phone', () => {
    expect(seasonRowId('show-1', 2)).toBe(seasonRowId('show-1', 2))
    expect(ratingRowId('show-1', 0, 'avi')).not.toBe(ratingRowId('show-1', 0, 'jackie'))
    expect(seasonRowId('show-1', 2)).not.toBe(seasonRowId('show-1', 3))
    expect(stableId('a', 1)).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/)
  })
})
