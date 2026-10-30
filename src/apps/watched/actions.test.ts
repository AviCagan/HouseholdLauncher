import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useData } from '@/store/useData'
import type { DataAdapter } from '@/data/adapter'
import type { WatchShow } from '@/data/types'
import {
  addShow,
  between,
  eveningOf,
  finishSeason,
  finishWithUndo,
  logEpisodes,
  rate,
  removeShow,
  reopenShow,
  restore,
  setSeasonDates,
  unwatchedEpisode,
  watchedEpisode,
  type ShowData,
} from './actions'
import { ratingRowId, seasonRowId, viewRowId } from './ids'
import { addDaysIso, isoDay } from './model'
import { season, seasonsInfo, show } from './testkit'

vi.mock('sonner', () => ({ toast: Object.assign(vi.fn(), { error: vi.fn(), success: vi.fn(), dismiss: vi.fn() }) }))

/** An adapter that records what was asked of it. */
function recorder(overrides: Partial<DataAdapter> = {}) {
  const calls: { op: string; table: string; id?: string; row?: unknown; patch?: unknown }[] = []
  const adapter: DataAdapter = {
    kind: 'supabase',
    async list() {
      return [] as never
    },
    async insert(table, row) {
      calls.push({ op: 'insert', table, row })
      return row as never
    },
    async update(table, id, patch) {
      calls.push({ op: 'update', table, id, patch })
      return null as never
    },
    async remove(table, id) {
      calls.push({ op: 'remove', table, id })
    },
    async claim() {
      return { won: true } as never
    },
    async unclaim() {
      return null as never
    },
    async steal() {
      return { won: true } as never
    },
    async completeRecurring() {
      return { won: true } as never
    },
    subscribe() {
      return () => {}
    },
    ...overrides,
  }
  return { adapter, calls }
}

const flush = () => new Promise((r) => setTimeout(r, 0))
const today = isoDay(new Date())

function data(patch: Partial<ShowData> = {}): ShowData {
  return {
    tvmaze_id: 1,
    title: 'Severance',
    premiered: '2022-02-18',
    ended: null,
    status: 'Running',
    network: 'Apple TV',
    genres: [],
    summary: null,
    poster_url: null,
    avg_runtime: 50,
    episodes: season(1, 9, '2022-02-18', 50),
    seasons: seasonsInfo({ n: 1, eps: 9 }),
    next_airdate: null,
    ...patch,
  }
}

beforeEach(() => {
  useData.setState({ watch_shows: [], watch_seasons: [], watch_ratings: [], watch_settings: [], watch_views: [], missingTables: [] })
  vi.spyOn(console, 'error').mockImplementation(() => {})
})

describe('addShow', () => {
  it('puts it on the right shelf at the end, before the network answers', () => {
    const { adapter, calls } = recorder()
    useData.setState({ adapter })
    const first = addShow(data({ tvmaze_id: 1 }), { kind: 'shelf', owner: 'jackie' }, 'avi')
    const second = addShow(data({ tvmaze_id: 2, title: 'Andor' }), { kind: 'shelf', owner: 'jackie' }, 'avi')
    expect(first.status).toBe('added')
    const rows = useData.getState().watch_shows
    expect(rows.map((r) => [r.title, r.stage, r.shelf_owner, r.created_by])).toEqual([
      ['Severance', 'shelf', 'jackie', 'avi'],
      ['Andor', 'shelf', 'jackie', 'avi'],
    ])
    expect(second.status === 'added' && second.show.shelf_order).toBeGreaterThan(rows[0].shelf_order)
    // The writes are under way, not waited on.
    expect(calls.map((c) => c.op)).toEqual(['insert', 'insert'])
  })

  it("won't add a show twice, and says where it already is", () => {
    const { adapter } = recorder()
    useData.setState({ adapter })
    const first = addShow(data(), { kind: 'shelf', owner: null }, 'avi')
    const again = addShow(data(), { kind: 'lineup', at: 'end' }, 'jackie')
    expect(again).toEqual({ status: 'exists', show: (first as { show: WatchShow }).show })
    expect(useData.getState().watch_shows).toHaveLength(1)
  })

  it('starting straight away records the season start after the show exists', async () => {
    const { adapter, calls } = recorder()
    useData.setState({ adapter })
    const res = addShow(data({ tvmaze_id: 3 }), { kind: 'watching' }, 'avi')
    await flush()
    await flush()
    expect(calls.map((c) => `${c.op}:${c.table}`)).toEqual(['insert:watch_shows', 'insert:watch_seasons'])
    const showRow = (res as { show: WatchShow }).show
    expect(showRow.current_season).toBe(1)
    expect(useData.getState().watch_seasons[0].id).toBe(seasonRowId(showRow.id, 1))
  })

  it('takes a show back off the page when the other phone added it first', async () => {
    const { adapter } = recorder({
      async insert() {
        throw { code: '23505' }
      },
    })
    useData.setState({ adapter })
    addShow(data(), { kind: 'shelf', owner: null }, 'avi')
    expect(useData.getState().watch_shows).toHaveLength(1)
    await flush()
    expect(useData.getState().watch_shows).toHaveLength(0)
  })

  it('defaults to watching as it airs only when there are dated episodes to come', () => {
    const { adapter } = recorder()
    useData.setState({ adapter })
    const airing = addShow(
      data({ tvmaze_id: 4, episodes: season(1, 4, addDaysIso(today, -14), 50, 7) }),
      { kind: 'lineup', at: 'end' },
      'avi',
    )
    const tbaOnly = addShow(
      data({ tvmaze_id: 5, episodes: season(1, 4, '2020-01-01', 50), seasons: seasonsInfo({ n: 1, eps: 4 }, { n: 2, eps: 8 }) }),
      { kind: 'lineup', at: 'end' },
      'avi',
    )
    expect((airing as { show: WatchShow }).show.live).toBe(true)
    expect((tbaOnly as { show: WatchShow }).show.live).toBe(false)
  })
})

describe('finishSeason', () => {
  const twoSeasons = [...season(1, 3, '2020-01-01'), ...season(2, 3, '2021-01-01')]

  it('moves on to the next season when it is out', async () => {
    const { adapter } = recorder()
    useData.setState({ adapter })
    const s = show({ stage: 'watching', current_season: 1, status: 'Ended', episodes: twoSeasons })
    useData.setState({ watch_shows: [s] })
    expect(finishSeason(s, 'avi')).toEqual({ kind: 'continued', season: 2 })
    await flush()
    await flush()
    const row = useData.getState().watch_shows[0]
    expect(row.current_season).toBe(2)
    expect(row.current_episode).toBe(0)
    const seasons = useData.getState().watch_seasons
    expect(seasons.find((r) => r.season === 1)?.finished_at).toBeTruthy()
    expect(seasons.find((r) => r.season === 2)?.started_at).toBeTruthy()
  })

  it('finishes the show after the last season of something that has ended', () => {
    const { adapter } = recorder()
    useData.setState({ adapter })
    const s = show({ stage: 'watching', current_season: 2, status: 'Ended', episodes: twoSeasons })
    useData.setState({ watch_shows: [s] })
    expect(finishSeason(s, 'avi')).toEqual({ kind: 'finished' })
    const row = useData.getState().watch_shows[0]
    expect(row.stage).toBe('watched')
    expect(row.plan_to).toBe(2)
    expect(row.finished_at).toBeTruthy()
  })

  it("reports being caught up when the next season isn't out", () => {
    const { adapter } = recorder()
    useData.setState({ adapter })
    const future = addDaysIso(today, 30)
    const s = show({
      stage: 'watching',
      current_season: 1,
      status: 'Running',
      episodes: [...season(1, 3, '2020-01-01'), ...season(2, 3, future)],
    })
    useData.setState({ watch_shows: [s] })
    expect(finishSeason(s, 'avi')).toEqual({ kind: 'caught-up', next: 2, airs: future })
    expect(useData.getState().watch_shows[0].stage).toBe('watching')
  })

  it('reports being caught up on a running show with nothing announced', () => {
    const { adapter } = recorder()
    useData.setState({ adapter })
    const s = show({ stage: 'watching', current_season: 1, status: 'Running', tvmaze_id: 9, episodes: season(1, 3, '2020-01-01') })
    useData.setState({ watch_shows: [s] })
    expect(finishSeason(s, 'avi')).toEqual({ kind: 'caught-up', next: null, airs: null })
  })
})

describe('rate', () => {
  it('writes one row per person per season, and updates it after', async () => {
    const { adapter, calls } = recorder()
    useData.setState({ adapter })
    rate('show-a', 1, 'avi', 8.5)
    await flush()
    rate('show-a', 1, 'avi', 9)
    await flush()
    expect(calls.map((c) => c.op)).toEqual(['insert', 'update'])
    const rows = useData.getState().watch_ratings
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({ id: ratingRowId('show-a', 1, 'avi'), score_x2: 18 })
  })

  it("turns into an update when the other phone saved the same person's score first", async () => {
    const { adapter, calls } = recorder({
      async insert(table, row) {
        calls.push({ op: 'insert', table, row })
        throw { code: '23505' }
      },
    })
    useData.setState({ adapter })
    rate('show-a', 0, 'jackie', 7)
    await flush()
    await flush()
    expect(calls.map((c) => c.op)).toEqual(['insert', 'update'])
    expect(useData.getState().watch_ratings).toHaveLength(1)
  })

  it('clears a score', async () => {
    const { adapter, calls } = recorder()
    useData.setState({ adapter })
    rate('show-a', 2, 'avi', 6)
    await flush()
    rate('show-a', 2, 'avi', null)
    await flush()
    expect(useData.getState().watch_ratings).toHaveLength(0)
    expect(calls.map((c) => c.op)).toEqual(['insert', 'remove'])
  })
})

describe('between', () => {
  it('finds a place between two neighbours, or past either end', () => {
    expect(between(10, 20)).toBe(15)
    expect(between(undefined, 20)).toBe(-980)
    expect(between(10, undefined)).toBe(1010)
  })
})

describe('the episode log', () => {
  const playing = () =>
    show({ id: 'sev', stage: 'watching', current_season: 1, current_episode: 2, episodes: season(1, 9, '2022-02-18', 50) })

  it('logs each episode ticked with the time, and moves the place in the season', async () => {
    const { adapter, calls } = recorder()
    const s = playing()
    useData.setState({ adapter, watch_shows: [s] })
    watchedEpisode(s, 3, 'avi')
    await flush()
    expect(useData.getState().watch_shows[0].current_episode).toBe(3)
    const [v] = useData.getState().watch_views
    expect(v).toMatchObject({ id: viewRowId('sev', 1, 3), season: 1, episode: 3, minutes: 50, created_by: 'avi' })
    expect(Date.now() - Date.parse(v.watched_at)).toBeLessThan(5000)
    expect(calls.map((c) => `${c.op}:${c.table}`)).toEqual(['update:watch_shows', 'insert:watch_views'])
  })

  it('takes an episode back out of the log when it is un-ticked', async () => {
    const { adapter, calls } = recorder()
    const s = playing()
    useData.setState({ adapter, watch_shows: [s] })
    watchedEpisode(s, 3, 'avi')
    await flush()
    unwatchedEpisode(useData.getState().watch_shows[0], 3, 'avi')
    await flush()
    expect(useData.getState().watch_shows[0].current_episode).toBe(2)
    expect(useData.getState().watch_views).toHaveLength(0)
    expect(calls.at(-1)).toMatchObject({ op: 'remove', table: 'watch_views', id: viewRowId('sev', 1, 3) })
  })

  it('spreads a batch over the days given', async () => {
    const { adapter } = recorder()
    const s = playing()
    useData.setState({ adapter, watch_shows: [s] })
    logEpisodes(s, 3, 4, '2026-10-03', '2026-10-05', 'avi')
    await flush()
    const views = [...useData.getState().watch_views].sort((a, b) => a.episode - b.episode)
    expect(views.map((v) => v.episode)).toEqual([3, 4, 5, 6])
    expect(views[0].watched_at).toBe(eveningOf('2026-10-03', 20))
    expect(views[3].watched_at).toBe(eveningOf('2026-10-05'))
    const times = views.map((v) => Date.parse(v.watched_at))
    expect(times[1] - times[0]).toBeCloseTo(times[2] - times[1], -3)
    expect(useData.getState().watch_shows[0].current_episode).toBe(6)
  })

  it('never logs past the end of the season', async () => {
    const { adapter } = recorder()
    const s = playing()
    useData.setState({ adapter, watch_shows: [s] })
    logEpisodes(s, 8, 5, today, today, 'avi')
    await flush()
    expect(useData.getState().watch_views.map((v) => v.episode).sort()).toEqual([8, 9])
    expect(useData.getState().watch_shows[0].current_episode).toBe(9)
  })

  it('works as before, without the log, when its table is not set up yet', async () => {
    const { adapter, calls } = recorder()
    const s = playing()
    useData.setState({ adapter, watch_shows: [s], missingTables: ['watch_views'] })
    watchedEpisode(s, 3, 'avi')
    await flush()
    expect(useData.getState().watch_shows[0].current_episode).toBe(3)
    expect(calls.map((c) => c.table)).toEqual(['watch_shows'])
  })
})

describe('finishing with dates', () => {
  it('records the season over the dates given', async () => {
    const { adapter } = recorder()
    const s = show({ id: 'sev', stage: 'watching', current_season: 1, status: 'Ended', episodes: season(1, 9, '2022-02-18', 50) })
    useData.setState({ adapter, watch_shows: [s] })
    const startedAt = eveningOf('2026-09-20', 20)
    const finishedAt = eveningOf('2026-09-27')
    expect(finishSeason(s, 'avi', { startedAt, finishedAt })).toEqual({ kind: 'finished' })
    await flush()
    const row = useData.getState().watch_seasons[0]
    expect([row.started_at, row.finished_at]).toEqual([startedAt, finishedAt])
    expect(useData.getState().watch_shows[0]).toMatchObject({ stage: 'watched', finished_at: finishedAt })
  })

  it('starts the next season now, not on the past finish date', async () => {
    const { adapter } = recorder()
    const s = show({ id: 'sev', stage: 'watching', current_season: 1, episodes: [...season(1, 9, '2022-02-18', 50), ...season(2, 10, '2025-01-17', 50)] })
    useData.setState({ adapter, watch_shows: [s] })
    expect(finishSeason(s, 'avi', { finishedAt: eveningOf('2026-09-27') })).toEqual({ kind: 'continued', season: 2 })
    await flush()
    await flush()
    const next = useData.getState().watch_seasons.find((r) => r.season === 2)!
    expect(Date.now() - Date.parse(next.started_at!)).toBeLessThan(5000)
  })

  it('never records a start after the finish', async () => {
    const { adapter } = recorder()
    const s = show({ id: 'sev', stage: 'watching', current_season: 1, status: 'Ended', episodes: season(1, 9, '2022-02-18', 50) })
    useData.setState({ adapter, watch_shows: [s] })
    finishSeason(s, 'avi', { startedAt: eveningOf('2026-09-29'), finishedAt: eveningOf('2026-09-27') })
    await flush()
    const row = useData.getState().watch_seasons[0]
    expect(row.started_at).toBe(row.finished_at)
  })
})

describe('taking it back', () => {
  const twoSeasons = () =>
    show({
      id: 'pitt',
      title: 'The Pitt',
      stage: 'watching',
      current_season: 1,
      current_episode: 11,
      progress_at: '2026-10-29T21:00:00.000Z',
      started_at: '2026-10-01T20:00:00.000Z',
      episodes: [...season(1, 15, '2025-01-09', 50), ...season(2, 15, '2026-01-08', 50)],
    })

  it('undoes "finished season": same season, same episode, and no finish on record', async () => {
    const { adapter, calls } = recorder()
    const s = twoSeasons()
    const startRow = { ...seasonRowFor(s.id, 1), started_at: '2026-10-01T20:00:00.000Z' }
    useData.setState({ adapter, watch_shows: [s], watch_seasons: [startRow] })
    const { outcome, undo } = finishWithUndo(s, 'avi')
    expect(outcome).toEqual({ kind: 'continued', season: 2 })
    await flush()
    await flush()
    expect(useData.getState().watch_shows[0].current_season).toBe(2)
    expect(useData.getState().watch_seasons).toHaveLength(2)

    restore(undo, 'avi')
    await flush()
    const back = useData.getState().watch_shows[0]
    expect([back.stage, back.current_season, back.current_episode]).toEqual(['watching', 1, 11])
    const seasons = useData.getState().watch_seasons
    expect(seasons).toHaveLength(1)
    expect(seasons[0].finished_at).toBeNull()
    expect(calls.some((c) => c.op === 'remove' && c.table === 'watch_seasons' && c.id === seasonRowId('pitt', 2))).toBe(true)
  })

  it('undoes finishing the whole show', async () => {
    const { adapter } = recorder()
    const s = { ...twoSeasons(), status: 'Ended', current_season: 2, current_episode: 14 }
    useData.setState({ adapter, watch_shows: [s], watch_seasons: [] })
    const { outcome, undo } = finishWithUndo(s, 'avi')
    expect(outcome.kind).toBe('finished')
    await flush()
    expect(useData.getState().watch_shows[0].stage).toBe('watched')
    restore(undo, 'avi')
    await flush()
    expect(useData.getState().watch_shows[0]).toMatchObject({ stage: 'watching', current_season: 2, current_episode: 14, finished_at: null })
    expect(useData.getState().watch_seasons).toHaveLength(0)
  })

  it('puts a finished show back on at the last episode logged', async () => {
    const { adapter } = recorder()
    const s = { ...twoSeasons(), stage: 'watched' as const, current_season: null, current_episode: 0, plan_to: 2, finished_at: '2026-10-29T21:00:00.000Z' }
    const views = [3, 4, 5].map((e) => ({
      id: viewRowId('pitt', 2, e), show_id: 'pitt', season: 2, episode: e, watched_at: '2026-10-28T21:00:00.000Z', minutes: 50, created_by: null, created_at: '', updated_at: '',
    }))
    const row = { ...seasonRowFor('pitt', 2), started_at: '2026-10-20T20:00:00.000Z', finished_at: '2026-10-29T21:00:00.000Z' }
    useData.setState({ adapter, watch_shows: [s], watch_seasons: [row], watch_views: views })
    reopenShow(s, 'avi')
    await flush()
    expect(useData.getState().watch_shows[0]).toMatchObject({ stage: 'watching', current_season: 2, current_episode: 5, finished_at: null })
    expect(useData.getState().watch_seasons[0].finished_at).toBeNull()
  })

  it('records dates for a season watched before (or whose record was lost)', async () => {
    const { adapter } = recorder()
    const s = twoSeasons()
    useData.setState({ adapter, watch_shows: [s], watch_seasons: [] })
    setSeasonDates(s, 1, eveningOf('2026-09-01', 20), eveningOf('2026-09-20'), 'avi')
    await flush()
    expect(useData.getState().watch_seasons[0]).toMatchObject({
      id: seasonRowId('pitt', 1),
      season: 1,
      started_at: eveningOf('2026-09-01', 20),
      finished_at: eveningOf('2026-09-20'),
      watched_before: false,
    })
  })

  it('brings a removed show back with its seasons, scores and episode log', async () => {
    const { adapter, calls } = recorder()
    const s = twoSeasons()
    const row = { ...seasonRowFor('pitt', 1), started_at: '2026-10-01T20:00:00.000Z' }
    const score = { id: ratingRowId('pitt', 1, 'avi'), show_id: 'pitt', season: 1, profile_id: 'avi', score_x2: 18, created_at: '', updated_at: '' }
    useData.setState({ adapter, watch_shows: [s], watch_seasons: [row], watch_ratings: [score] })
    const { toast } = await import('sonner')
    removeShow(s)
    await flush()
    expect(useData.getState().watch_shows).toHaveLength(0)
    const undo = (toast as unknown as { mock: { calls: [string, { action: { onClick: () => void } }][] } }).mock.calls.at(-1)![1].action
    undo.onClick()
    await flush()
    await flush()
    expect(useData.getState().watch_shows).toHaveLength(1)
    expect(useData.getState().watch_seasons).toHaveLength(1)
    expect(useData.getState().watch_ratings).toHaveLength(1)
    expect(calls.filter((c) => c.op === 'insert').map((c) => c.table)).toEqual(['watch_shows', 'watch_seasons', 'watch_ratings'])
  })
})

function seasonRowFor(showId: string, season: number) {
  return {
    id: seasonRowId(showId, season),
    show_id: showId,
    season,
    show_title: null,
    started_at: null as string | null,
    finished_at: null as string | null,
    watched_before: false,
    created_by: null,
    updated_by: null,
    created_at: '',
    updated_at: '',
  }
}
