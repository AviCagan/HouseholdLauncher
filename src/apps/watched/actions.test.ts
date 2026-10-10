import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useData } from '@/store/useData'
import type { DataAdapter } from '@/data/adapter'
import type { WatchShow } from '@/data/types'
import { addShow, between, finishSeason, rate, type ShowData } from './actions'
import { ratingRowId, seasonRowId } from './ids'
import { addDaysIso, isoDay } from './model'
import { season, seasonsInfo, show } from './testkit'

vi.mock('sonner', () => ({ toast: Object.assign(vi.fn(), { error: vi.fn(), success: vi.fn() }) }))

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
  useData.setState({ watch_shows: [], watch_seasons: [], watch_ratings: [], watch_settings: [] })
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
