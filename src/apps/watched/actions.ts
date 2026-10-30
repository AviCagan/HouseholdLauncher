import { toast } from 'sonner'
import { useData } from '@/store/useData'
import { newId, nowIso } from '@/data/adapter'
import { fire } from '@/lib/haptics'
import type { WatchRating, WatchSeason, WatchSettings, WatchShow, WatchView } from '@/data/types'
import { fetchShowDetail, type ShowDetail } from './tvmaze'
import { ratingRowId, seasonRowId, viewRowId } from './ids'
import { allEpisodes, isoDay, lastPlannedSeason, lastSeasonOut, seasonLength } from './model'
import { toX2 } from './ratings'

/**
 * Every write Watched makes.
 *
 * Optimistic like the rest of the launcher: the change is on screen before
 * the network is involved, and a failure puts the row back and says so.
 * Season records and ratings use ids derived from what they are (see ids.ts),
 * so both phones writing the same one is an update, never a duplicate.
 */

type WatchTable = 'watch_shows' | 'watch_seasons' | 'watch_ratings' | 'watch_settings' | 'watch_views'
type RowOf<T extends WatchTable> = T extends 'watch_shows'
  ? WatchShow
  : T extends 'watch_seasons'
    ? WatchSeason
    : T extends 'watch_ratings'
      ? WatchRating
      : T extends 'watch_views'
        ? WatchView
        : WatchSettings

const keyOf = (table: WatchTable, row: unknown): string =>
  table === 'watch_settings' ? 'singleton' : (row as { id: string }).id

function rows<T extends WatchTable>(table: T): RowOf<T>[] {
  return useData.getState()[table] as unknown as RowOf<T>[]
}

function put<T extends WatchTable>(table: T, row: RowOf<T>): void {
  const list = rows(table)
  const key = keyOf(table, row)
  const next = list.some((r) => keyOf(table, r) === key)
    ? list.map((r) => (keyOf(table, r) === key ? row : r))
    : [...list, row]
  useData.setState({ [table]: next } as never)
}

function drop(table: WatchTable, key: string): void {
  useData.setState({ [table]: rows(table).filter((r) => keyOf(table, r) !== key) } as never)
}

const adapter = () => useData.getState().adapter

const isDuplicate = (err: unknown): boolean => (err as { code?: string })?.code === '23505'

function failed(message: string, err: unknown): void {
  fire('error')
  toast.error(message)
  console.error('[watched]', err)
}

/** Patch one row, putting it back exactly as it was on failure. */
async function updateRow<T extends WatchTable>(
  table: T,
  before: RowOf<T>,
  patch: Partial<RowOf<T>>,
  failMessage = "Couldn't save that",
): Promise<boolean> {
  put(table, { ...before, ...patch, updated_at: nowIso() } as RowOf<T>)
  try {
    await adapter().update(table, keyOf(table, before), patch as never)
    return true
  } catch (err) {
    put(table, before)
    failed(failMessage, err)
    return false
  }
}

/**
 * Insert or update a row either phone might create. If the other phone got
 * there first, the insert fails on the unique key and becomes an update.
 */
async function upsertRow<T extends 'watch_seasons' | 'watch_ratings' | 'watch_settings' | 'watch_views'>(
  table: T,
  row: RowOf<T>,
  patch: Partial<RowOf<T>>,
  failMessage: string,
): Promise<boolean> {
  const existing = rows(table).find((r) => keyOf(table, r) === keyOf(table, row))
  if (existing) return updateRow(table, existing, patch, failMessage)
  put(table, row)
  try {
    await adapter().insert(table, row as never)
    return true
  } catch (err) {
    if (isDuplicate(err)) {
      try {
        await adapter().update(table, keyOf(table, row), patch as never)
        return true
      } catch (err2) {
        drop(table, keyOf(table, row))
        failed(failMessage, err2)
        return false
      }
    }
    drop(table, keyOf(table, row))
    failed(failMessage, err)
    return false
  }
}

// --- ordering -------------------------------------------------------------------

const GAP = 1000

const shelfOrders = (owner: string | null) =>
  rows('watch_shows')
    .filter((s) => s.stage === 'shelf' && s.shelf_owner === owner)
    .map((s) => s.shelf_order)

const lineupOrders = () =>
  rows('watch_shows')
    .filter((s) => s.stage === 'lineup' || s.stage === 'watching')
    .map((s) => s.lineup_order)

const endOf = (orders: number[]) => (orders.length ? Math.max(...orders) + GAP : Date.now())
const frontOf = (orders: number[]) => (orders.length ? Math.min(...orders) - GAP : Date.now())

/** A fractional order between two neighbours, so a move is one write. */
export function between(prev: number | undefined, next: number | undefined): number {
  if (prev === undefined && next === undefined) return Date.now()
  if (prev === undefined) return next! - GAP
  if (next === undefined) return prev + GAP
  return (prev + next) / 2
}

const today = () => isoDay(new Date())

/** The first season with anything to watch in it. */
export function firstSeason(show: WatchShow): number {
  return allEpisodes(show)[0]?.season ?? show.seasons[0]?.n ?? 1
}

/** Seasons in this slot's plan that have episodes, ascending. */
function plannedSeasons(show: WatchShow): number[] {
  const all = [...new Set(allEpisodes(show).map((e) => e.season))].sort((a, b) => a - b)
  return show.plan_to ? all.filter((n) => n <= show.plan_to!) : all
}

// --- adding ------------------------------------------------------------------------

export type ShowData = Omit<ShowDetail, 'posters' | 'tvmaze_id'> & { tvmaze_id: number | null }

export type Destination =
  | { kind: 'shelf'; owner: string | null }
  | { kind: 'lineup'; at: 'front' | 'end' }
  | { kind: 'watching' }
  | { kind: 'watched'; throughSeason: number | null }

export type AddResult = { status: 'added'; show: WatchShow } | { status: 'exists'; show: WatchShow }

/**
 * Put a show somewhere: a shelf, the lineup, on now, or straight into
 * Watched to be rated. A show already in the household is not added twice —
 * the caller is told where it is instead.
 */
export function addShow(data: ShowData, dest: Destination, profileId: string | null): AddResult {
  if (data.tvmaze_id !== null) {
    const existing = rows('watch_shows').find((s) => s.tvmaze_id === data.tvmaze_id)
    if (existing) return { status: 'exists', show: existing }
  }

  const now = nowIso()
  const base: WatchShow = {
    id: newId(),
    tvmaze_id: data.tvmaze_id,
    title: data.title.trim(),
    premiered: data.premiered,
    ended: data.ended,
    status: data.status,
    network: data.network,
    genres: data.genres,
    summary: data.summary,
    poster_url: data.poster_url,
    avg_runtime: data.avg_runtime,
    episodes: data.episodes,
    seasons: data.seasons,
    next_airdate: data.next_airdate,
    data_updated_at: data.tvmaze_id !== null ? now : null,
    stage: 'shelf',
    shelf_owner: null,
    shelf_order: Date.now(),
    lineup_order: Date.now(),
    live: false,
    plan_from: null,
    plan_to: null,
    current_season: null,
    current_episode: 0,
    progress_at: null,
    started_at: null,
    finished_at: null,
    watched_before: false,
    created_by: profileId,
    updated_by: null,
    created_at: now,
    updated_at: now,
  }

  let row: WatchShow
  if (dest.kind === 'shelf') {
    row = { ...base, shelf_owner: dest.owner, shelf_order: endOf(shelfOrders(dest.owner)) }
  } else if (dest.kind === 'lineup') {
    row = {
      ...base,
      stage: 'lineup',
      lineup_order: dest.at === 'front' ? frontOf(lineupOrders()) : endOf(lineupOrders()),
    }
    row.live = hasDatedFuture(row)
  } else if (dest.kind === 'watching') {
    row = {
      ...base,
      stage: 'watching',
      current_season: firstSeason(base),
      started_at: now,
      lineup_order: frontOf(lineupOrders()),
    }
    row.live = hasDatedFuture(row)
  } else {
    row = { ...base, stage: 'watched', watched_before: true, plan_to: dest.throughSeason }
  }

  fire('success')
  void (async () => {
    const saved = await insertShow(row)
    if (saved && row.stage === 'watching') await startSeasonRow(row, row.current_season!, now, profileId)
  })()
  return { status: 'added', show: row }
}

/** Is any planned episode dated in the future? Undated ones don't make a show "airing". */
function hasDatedFuture(show: WatchShow): boolean {
  const t = today()
  const position = show.current_season ? { season: show.current_season, done: show.current_episode } : null
  return allEpisodes(show).some(
    (e) =>
      e.airdate !== null &&
      e.airdate > t &&
      (!position || e.season >= position.season) &&
      (!show.plan_to || e.season <= show.plan_to),
  )
}

async function insertShow(row: WatchShow): Promise<boolean> {
  put('watch_shows', row)
  try {
    await adapter().insert('watch_shows', row)
    return true
  } catch (err) {
    drop('watch_shows', row.id)
    if (isDuplicate(err)) {
      fire('warning')
      toast(`${row.title} was just added from the other phone`)
    } else {
      failed(`Couldn't add ${row.title}`, err)
    }
    return false
  }
}

function startSeasonRow(show: WatchShow, season: number, at: string, profileId: string | null): Promise<boolean> {
  const id = seasonRowId(show.id, season)
  const existing = rows('watch_seasons').find((r) => r.id === id)
  if (existing?.started_at) return Promise.resolve(true)
  const row: WatchSeason = {
    id,
    show_id: show.id,
    season,
    show_title: show.title,
    started_at: at,
    finished_at: null,
    watched_before: false,
    created_by: profileId,
    updated_by: null,
    created_at: at,
    updated_at: at,
  }
  return upsertRow('watch_seasons', row, { started_at: at, updated_by: profileId }, "Couldn't save the season start")
}

// --- moving ---------------------------------------------------------------------------

export function moveToShelf(show: WatchShow, owner: string | null, profileId: string | null): void {
  fire('snap')
  void updateRow('watch_shows', show, {
    stage: 'shelf',
    shelf_owner: owner,
    shelf_order: endOf(shelfOrders(owner).filter((o) => o !== show.shelf_order)),
    updated_by: profileId,
  })
}

export function setShelfOrder(show: WatchShow, order: number): void {
  void updateRow('watch_shows', show, { shelf_order: order })
}

export function setLineupOrder(show: WatchShow, order: number): void {
  void updateRow('watch_shows', show, { lineup_order: order })
}

/**
 * Put a show into the lineup at a chosen place. Watching it as it airs is
 * the default for anything with dated episodes still to come — the user can
 * flip it to "binge when it's done" on the show.
 */
export function slotIntoLineup(
  show: WatchShow,
  order: number,
  profileId: string | null,
  opts: { live?: boolean; planFrom?: number | null; planTo?: number | null } = {},
): void {
  const planned: WatchShow = {
    ...show,
    plan_from: opts.planFrom !== undefined ? opts.planFrom : show.plan_from,
    plan_to: opts.planTo !== undefined ? opts.planTo : show.plan_to,
  }
  fire('success')
  void updateRow('watch_shows', show, {
    stage: 'lineup',
    lineup_order: order,
    plan_from: planned.plan_from,
    plan_to: planned.plan_to,
    live: opts.live ?? hasDatedFuture(planned),
    updated_by: profileId,
  })
}

/** Press play. Resumes where it left off when it was playing before. */
export function startWatching(show: WatchShow, profileId: string | null): void {
  const resuming = show.current_season !== null
  const season = show.current_season ?? show.plan_from ?? firstSeason(show)
  const now = nowIso()
  fire('success')
  void (async () => {
    const ok = await updateRow('watch_shows', show, {
      stage: 'watching',
      current_season: season,
      current_episode: resuming ? show.current_episode : 0,
      progress_at: resuming ? show.progress_at : null,
      started_at: show.started_at ?? now,
      updated_by: profileId,
    })
    if (ok) await startSeasonRow(show, season, now, profileId)
  })()
}

/** Set it aside without losing the place. It goes back in the lineup. */
export function pauseShow(show: WatchShow, profileId: string | null): void {
  fire('toggleOff')
  void updateRow('watch_shows', show, { stage: 'lineup', updated_by: profileId })
}

// --- the episode log ------------------------------------------------------------

/**
 * Is the episode log there? It arrived in a later migration (022) than the
 * rest of Watched; without it the app works exactly as before, learning only
 * from finished seasons.
 */
const viewsReady = () => !useData.getState().missingTables.includes('watch_views')

/** Record episodes as watched at the given moments — what the pace learns from. */
function logViews(show: WatchShow, season: number, episodes: { episode: number; at: string }[], profileId: string | null): void {
  if (!viewsReady()) return
  const lengths = new Map(allEpisodes(show).filter((e) => e.season === season).map((e) => [e.number, e.minutes]))
  for (const { episode, at } of episodes) {
    const now = nowIso()
    const minutes = lengths.get(episode) ?? show.avg_runtime ?? null
    void upsertRow(
      'watch_views',
      {
        id: viewRowId(show.id, season, episode),
        show_id: show.id,
        season,
        episode,
        watched_at: at,
        minutes,
        created_by: profileId,
        created_at: now,
        updated_at: now,
      },
      { watched_at: at, minutes },
      "Couldn't log that episode",
    )
  }
}

function unlogView(show: WatchShow, season: number, episode: number): void {
  if (!viewsReady()) return
  const id = viewRowId(show.id, season, episode)
  const before = rows('watch_views').find((v) => v.id === id)
  if (!before) return
  drop('watch_views', id)
  void adapter()
    .remove('watch_views', id)
    .catch((err) => {
      put('watch_views', before)
      failed("Couldn't undo that episode", err)
    })
}

/**
 * "We just watched episode 5." Moves the place in the season and logs the
 * episode with the time, so the pace hears about it now rather than at the
 * end of the season.
 */
export function watchedEpisode(show: WatchShow, episode: number, profileId: string | null): void {
  const season = show.current_season
  if (!season) return
  const ep = Math.max(1, Math.min(seasonLength(show, season), Math.round(episode)))
  fire('snap')
  void updateRow('watch_shows', show, { current_episode: ep, progress_at: nowIso(), updated_by: profileId })
  logViews(show, season, [{ episode: ep, at: nowIso() }], profileId)
}

/** "Not that one yet" — back an episode, and take it out of the log. */
export function unwatchedEpisode(show: WatchShow, episode: number, profileId: string | null): void {
  const season = show.current_season
  if (!season) return
  const ep = Math.max(1, Math.round(episode))
  fire('snap')
  void updateRow('watch_shows', show, { current_episode: ep - 1, progress_at: nowIso(), updated_by: profileId })
  unlogView(show, season, ep)
}

/** Evening of a local day, as an ISO string — when a past day's watching is assumed to happen. */
export function eveningOf(day: string, hour = 21): string {
  const [y, m, d] = day.split('-').map(Number)
  return new Date(y, m - 1, d, hour).toISOString()
}

/**
 * "We watched four episodes between Saturday and Monday." Logs the next
 * `count` episodes of the season spread evenly over those days and moves the
 * place in the season past them. A range ending today ends now.
 */
export function logEpisodes(
  show: WatchShow,
  from: number,
  count: number,
  fromDay: string,
  toDay: string,
  profileId: string | null,
): void {
  const season = show.current_season
  if (!season || count <= 0) return
  const len = seasonLength(show, season)
  const first = Math.max(1, from)
  const last = Math.min(len, first + count - 1)
  if (last < first) return
  const [a, b] = fromDay <= toDay ? [fromDay, toDay] : [toDay, fromDay]
  const start = Date.parse(eveningOf(a, 20))
  const end = b === today() ? Date.now() : Date.parse(eveningOf(b))
  const n = last - first + 1
  const episodes = Array.from({ length: n }, (_, i) => ({
    episode: first + i,
    at: new Date(n === 1 ? end : start + ((Math.max(start, end) - start) * i) / (n - 1)).toISOString(),
  }))
  fire('success')
  void updateRow('watch_shows', show, { current_episode: last, progress_at: nowIso(), updated_by: profileId })
  logViews(show, season, episodes, profileId)
}

export type FinishOutcome =
  | { kind: 'continued'; season: number }
  | { kind: 'caught-up'; next: number | null; airs: string | null }
  | { kind: 'finished' }

/**
 * "We finished the season."
 *
 * Records the season, then decides what happens to the show: on to the next
 * season if it's out; finished if that was the last one; or caught up, when
 * the next season hasn't aired (or hasn't been announced) — in which case the
 * caller asks whether to wait for it in the lineup or call it done for now.
 */
export function finishSeason(
  show: WatchShow,
  profileId: string | null,
  /** When it really happened, if not just now: what the pace learns from. */
  when: { startedAt?: string; finishedAt?: string } = {},
): FinishOutcome {
  const season = show.current_season
  if (!season) return { kind: 'finished' }
  const now = when.finishedAt ?? nowIso()
  const id = seasonRowId(show.id, season)
  const existing = rows('watch_seasons').find((r) => r.id === id)
  const recorded = existing?.started_at ?? show.started_at ?? now
  // A start after the finish is a clock or a typo; never a negative season.
  const startMs = Date.parse(when.startedAt ?? recorded)
  const startedAt = Number.isFinite(startMs) && startMs < Date.parse(now) ? new Date(startMs).toISOString() : now
  void upsertRow(
    'watch_seasons',
    {
      id,
      show_id: show.id,
      season,
      show_title: show.title,
      started_at: startedAt,
      finished_at: now,
      watched_before: false,
      created_by: profileId,
      updated_by: profileId,
      created_at: now,
      updated_at: now,
    },
    { finished_at: now, started_at: startedAt, updated_by: profileId },
    "Couldn't record the season",
  )

  const next = plannedSeasons(show).find((n) => n > season)
  const t = today()
  if (next !== undefined) {
    const firstEp = allEpisodes(show).find((e) => e.season === next)
    if (firstEp?.airdate && firstEp.airdate <= t) {
      fire('success')
      // The next season starts now, when they said so — not on a past
      // finish date, which would have it guessing they're episodes in.
      const startedNext = nowIso()
      void (async () => {
        const ok = await updateRow('watch_shows', show, {
          current_season: next,
          current_episode: 0,
          progress_at: startedNext,
          updated_by: profileId,
        })
        if (ok) await startSeasonRow(show, next, startedNext, profileId)
      })()
      return { kind: 'continued', season: next }
    }
    fire('success')
    return { kind: 'caught-up', next, airs: firstEp?.airdate ?? null }
  }

  // Nothing later with episodes. Over if the show is over (or was typed in
  // by hand, so there is nothing more to know), or the plan stopped here.
  const planEnds = show.plan_to !== null && season >= show.plan_to
  if (show.status === 'Ended' || show.tvmaze_id === null || planEnds) {
    markWatched({ ...show, current_season: season }, profileId, when.finishedAt)
    return { kind: 'finished' }
  }
  // Still running: maybe a season announced with nothing listed, maybe not.
  const nextAnnounced =
    show.seasons
      .map((s) => s.n)
      .filter((n) => n > season)
      .sort((a, b) => a - b)[0] ?? null
  fire('success')
  return { kind: 'caught-up', next: nextAnnounced, airs: null }
}

/** Caught up: keep it in the lineup, waiting for the next season to air. */
export function waitForSeason(show: WatchShow, next: number | null, profileId: string | null): void {
  const fromSeason = next ?? (show.current_season ?? 0) + 1
  void updateRow('watch_shows', show, {
    stage: 'lineup',
    plan_from: fromSeason,
    plan_to: null,
    current_season: null,
    current_episode: 0,
    progress_at: null,
    // Waiting for a season to air is watching it as it airs.
    live: true,
    updated_by: profileId,
  })
}

/** Done with it — finished, or caught up and calling it done for now. */
export function markWatched(show: WatchShow, profileId: string | null, at?: string): void {
  fire('success')
  void updateRow('watch_shows', show, {
    stage: 'watched',
    finished_at: at ?? nowIso(),
    plan_to: show.current_season ?? lastSeasonOut(show, today()) ?? lastPlannedSeason(show) ?? show.plan_to,
    updated_by: profileId,
  })
}

/**
 * "We've already seen this one" — from a shelf or the lineup, straight to
 * Watched for rating. No dates, so it never touches the pace.
 */
export function markWatchedBefore(show: WatchShow, profileId: string | null): void {
  fire('success')
  void updateRow('watch_shows', show, {
    stage: 'watched',
    watched_before: true,
    finished_at: null,
    current_season: null,
    current_episode: 0,
    progress_at: null,
    plan_from: null,
    plan_to: null,
    updated_by: profileId,
  })
}

/** Next in line — ahead of everything still queued. */
export function playNext(show: WatchShow, profileId: string | null): void {
  const queued = rows('watch_shows')
    .filter((s) => s.stage === 'lineup' && s.id !== show.id)
    .map((s) => s.lineup_order)
  fire('snap')
  void updateRow('watch_shows', show, {
    lineup_order: frontOf(queued),
    updated_by: profileId,
  })
}

export function dropShow(show: WatchShow, profileId: string | null): void {
  fire('toggleOff')
  void updateRow('watch_shows', show, { stage: 'dropped', finished_at: nowIso(), updated_by: profileId })
}

/**
 * A watched show back into the lineup for what came after: the season after
 * the last one they watched.
 */
export function queueNextSeason(show: WatchShow, profileId: string | null): void {
  const watchedThrough = show.plan_to ?? lastSeasonOut(show, today()) ?? 0
  const planned: WatchShow = { ...show, plan_from: watchedThrough + 1, plan_to: null, current_season: null }
  fire('success')
  void updateRow('watch_shows', show, {
    stage: 'lineup',
    plan_from: watchedThrough + 1,
    plan_to: null,
    current_season: null,
    current_episode: 0,
    progress_at: null,
    lineup_order: endOf(lineupOrders()),
    live: hasDatedFuture(planned),
    updated_by: profileId,
  })
}

// --- details --------------------------------------------------------------------

export function setPoster(show: WatchShow, url: string | null, profileId: string | null): void {
  fire('success')
  void updateRow('watch_shows', show, { poster_url: url, updated_by: profileId })
}

export function setLive(show: WatchShow, live: boolean, profileId: string | null): void {
  fire(live ? 'toggleOn' : 'toggleOff')
  void updateRow('watch_shows', show, { live, updated_by: profileId })
}

export function setPlan(show: WatchShow, from: number | null, to: number | null, profileId: string | null): void {
  if (from !== null && to !== null && from > to) return
  fire('snap')
  void updateRow('watch_shows', show, { plan_from: from, plan_to: to, updated_by: profileId })
}

/** For hand-entered shows (or TVmaze getting a runtime wrong). */
export function updateShowData(
  show: WatchShow,
  patch: Partial<Pick<WatchShow, 'title' | 'avg_runtime' | 'episodes' | 'seasons' | 'network' | 'premiered'>>,
  profileId: string | null,
): void {
  fire('success')
  void updateRow('watch_shows', show, { ...patch, updated_by: profileId })
}

export function removeShow(show: WatchShow): void {
  fire('delete')
  const seasons = rows('watch_seasons').filter((r) => r.show_id === show.id)
  const ratings = rows('watch_ratings').filter((r) => r.show_id === show.id)
  const views = rows('watch_views').filter((r) => r.show_id === show.id)
  drop('watch_shows', show.id)
  // The database cascades; the local copy has to follow or they linger here.
  for (const r of seasons) drop('watch_seasons', r.id)
  for (const r of ratings) drop('watch_ratings', r.id)
  for (const r of views) drop('watch_views', r.id)
  const putBack = () => {
    put('watch_shows', show)
    for (const r of seasons) put('watch_seasons', r)
    for (const r of ratings) put('watch_ratings', r)
    for (const r of views) put('watch_views', r)
  }
  void (async () => {
    try {
      await adapter().remove('watch_shows', show.id)
    } catch (err) {
      putBack()
      failed(`Couldn't remove ${show.title}`, err)
      return
    }
    // Removed for real. Undo puts back the show and everything hanging off
    // it — its seasons and their dates, the ratings, the episode log — so a
    // slip of the finger costs nothing.
    toast(`${show.title} removed`, {
      duration: 10_000,
      action: {
        label: 'Undo',
        onClick: () => {
          putBack()
          void (async () => {
            try {
              await adapter().insert('watch_shows', show)
              for (const r of seasons) await adapter().insert('watch_seasons', r)
              for (const r of ratings) await adapter().insert('watch_ratings', r)
              if (viewsReady()) for (const r of views) await adapter().insert('watch_views', r)
              fire('success')
            } catch (err) {
              failed(`Couldn't bring ${show.title} back`, err)
            }
          })()
        },
      },
    })
  })()
}

// --- undo ---------------------------------------------------------------------------

/** A show and its season records as they were, to put back after a mis-tap. */
export interface WatchSnapshot {
  show: WatchShow
  seasons: WatchSeason[]
}

export function snapshot(show: WatchShow): WatchSnapshot {
  const current = rows('watch_shows').find((s) => s.id === show.id) ?? show
  return { show: current, seasons: rows('watch_seasons').filter((r) => r.show_id === show.id) }
}

/**
 * Undo "finished": the show goes back exactly where it was — stage, season,
 * episode — and the season records go back to their old dates, so the pace
 * and the patterns never learn from a finish that didn't happen.
 */
export function restore(snap: WatchSnapshot, profileId: string | null): void {
  const current = rows('watch_shows').find((s) => s.id === snap.show.id)
  if (!current) return
  toast.dismiss(UNDO_TOAST)
  const { stage, current_season, current_episode, progress_at, started_at, finished_at, plan_from, plan_to, live, lineup_order } = snap.show
  fire('toggleOff')
  void updateRow(
    'watch_shows',
    current,
    { stage, current_season, current_episode, progress_at, started_at, finished_at, plan_from, plan_to, live, lineup_order, updated_by: profileId },
    "Couldn't undo that",
  )
  const before = new Map(snap.seasons.map((r) => [r.id, r]))
  for (const row of rows('watch_seasons').filter((r) => r.show_id === snap.show.id)) {
    const old = before.get(row.id)
    if (!old) {
      // Made by the finish (the next season's start): take it away again.
      drop('watch_seasons', row.id)
      void adapter()
        .remove('watch_seasons', row.id)
        .catch((err) => {
          put('watch_seasons', row)
          failed("Couldn't undo that", err)
        })
    } else if (old.started_at !== row.started_at || old.finished_at !== row.finished_at) {
      void updateRow('watch_seasons', row, { started_at: old.started_at, finished_at: old.finished_at, updated_by: profileId }, "Couldn't undo that")
    }
  }
}

/**
 * Finish the season and say so with an Undo — every finish button goes
 * through here, so every finish can be taken back.
 */
export function finishWithUndo(
  show: WatchShow,
  profileId: string | null,
  when: { startedAt?: string; finishedAt?: string } = {},
): { outcome: FinishOutcome; undo: WatchSnapshot } {
  const undo = snapshot(show)
  const outcome = finishSeason(show, profileId, when)
  offerUndo(outcome.kind === 'finished' ? `${show.title} finished` : `Season ${show.current_season} finished`, undo, profileId)
  return { outcome, undo }
}

const UNDO_TOAST = 'watched-undo'

/** A toast after a finish, with Undo — the quickest way back from a mis-tap. */
export function offerUndo(label: string, snap: WatchSnapshot, profileId: string | null): void {
  toast(label, { id: UNDO_TOAST, duration: 10_000, action: { label: 'Undo', onClick: () => restore(snap, profileId) } })
}

/**
 * "We didn't actually finish it" for a show already in Watched: back to
 * playing its last season, at the last episode they logged, and that
 * season's finish taken off the record.
 */
export function reopenShow(show: WatchShow, profileId: string | null): void {
  const t = today()
  const season = show.plan_to ?? lastSeasonOut(show, t) ?? lastPlannedSeason(show) ?? firstSeason(show)
  const logged = rows('watch_views').filter((v) => v.show_id === show.id && v.season === season)
  const at = logged.length ? Math.max(...logged.map((v) => v.episode)) : 0
  const len = seasonLength(show, season)
  fire('success')
  void updateRow('watch_shows', show, {
    stage: 'watching',
    current_season: season,
    current_episode: Math.min(at, Math.max(0, len - 1)),
    progress_at: nowIso(),
    finished_at: null,
    watched_before: false,
    started_at: show.started_at ?? nowIso(),
    updated_by: profileId,
  })
  const row = rows('watch_seasons').find((r) => r.id === seasonRowId(show.id, season))
  if (row?.finished_at) void updateRow('watch_seasons', row, { finished_at: null, updated_by: profileId })
  else if (!row) void startSeasonRow(show, season, nowIso(), profileId)
}

/** When the season playing now really started — the only date it has yet. */
export function setSeasonStart(show: WatchShow, season: number, startedAt: string, profileId: string | null): void {
  const row = rows('watch_seasons').find((r) => r.id === seasonRowId(show.id, season))
  fire('success')
  if (row) void updateRow('watch_seasons', row, { started_at: startedAt, updated_by: profileId }, "Couldn't save that date")
  else void startSeasonRow(show, season, startedAt, profileId)
  if (!show.started_at || Date.parse(startedAt) < Date.parse(show.started_at)) {
    void updateRow('watch_shows', show, { started_at: startedAt, updated_by: profileId })
  }
}

/**
 * Put real dates on a season — one finished before the app knew, or one
 * whose record was lost. The pace and the patterns learn from it as if it
 * had been timed.
 */
export function setSeasonDates(show: WatchShow, season: number, startedAt: string, finishedAt: string, profileId: string | null): void {
  const [start, end] = Date.parse(startedAt) <= Date.parse(finishedAt) ? [startedAt, finishedAt] : [finishedAt, startedAt]
  const now = nowIso()
  fire('success')
  void upsertRow(
    'watch_seasons',
    {
      id: seasonRowId(show.id, season),
      show_id: show.id,
      season,
      show_title: show.title,
      started_at: start,
      finished_at: end,
      watched_before: false,
      created_by: profileId,
      updated_by: profileId,
      created_at: now,
      updated_at: now,
    },
    { started_at: start, finished_at: end, watched_before: false, updated_by: profileId },
    "Couldn't save those dates",
  )
}

// --- ratings ------------------------------------------------------------------------

/** One person's score for a season (or the whole show, season 0). Null clears it. */
export function rate(showId: string, season: number, profileId: string, score: number | null): void {
  const id = ratingRowId(showId, season, profileId)
  const existing = rows('watch_ratings').find((r) => r.id === id)
  if (score === null) {
    if (!existing) return
    fire('toggleOff')
    drop('watch_ratings', id)
    void (async () => {
      try {
        await adapter().remove('watch_ratings', id)
      } catch (err) {
        put('watch_ratings', existing)
        failed("Couldn't clear that score", err)
      }
    })()
    return
  }
  const score_x2 = toX2(score)
  if (existing?.score_x2 === score_x2) return
  const now = nowIso()
  void upsertRow(
    'watch_ratings',
    { id, show_id: showId, season, profile_id: profileId, score_x2, created_at: now, updated_at: now },
    { score_x2 },
    "Couldn't save that score",
  )
}

// --- settings ----------------------------------------------------------------------

export function updatePace(patch: Partial<Pick<WatchSettings, 'pace_mode' | 'pace_minutes'>>, profileId: string | null): void {
  const now = nowIso()
  const current: WatchSettings = rows('watch_settings')[0] ?? {
    singleton: true,
    pace_mode: 'auto',
    pace_minutes: 240,
    updated_by: null,
    updated_at: now,
  }
  const row: WatchSettings = { ...current, ...patch, updated_by: profileId, updated_at: now }
  void upsertRow('watch_settings', row, { ...patch, updated_by: profileId }, "Couldn't save the pace")
}

// --- keeping show data fresh ----------------------------------------------------

const REFRESH_AFTER_MS = 3 * 24 * 60 * 60 * 1000

/**
 * Worth asking TVmaze again? Anything still airing (or not yet aired) that
 * hasn't been looked at in a few days. Ended shows don't change; dropped
 * ones don't matter.
 */
export function needsRefresh(show: WatchShow, now: Date): boolean {
  if (show.tvmaze_id === null || show.stage === 'dropped') return false
  if (!show.data_updated_at) return true
  if (show.status === 'Ended' && show.stage !== 'lineup' && show.stage !== 'watching') return false
  return now.getTime() - Date.parse(show.data_updated_at) > REFRESH_AFTER_MS
}

/** Pull new seasons, episodes and air dates. Never touches the chosen picture. */
export async function refreshShow(show: WatchShow): Promise<boolean> {
  if (show.tvmaze_id === null) return false
  try {
    const d = await fetchShowDetail(show.tvmaze_id)
    const latest = rows('watch_shows').find((s) => s.id === show.id)
    if (!latest) return false
    await updateRow(
      'watch_shows',
      latest,
      {
        status: d.status,
        ended: d.ended,
        premiered: d.premiered,
        network: d.network ?? latest.network,
        genres: d.genres,
        summary: d.summary ?? latest.summary,
        avg_runtime: d.avg_runtime ?? latest.avg_runtime,
        episodes: d.episodes,
        seasons: d.seasons,
        next_airdate: d.next_airdate,
        data_updated_at: nowIso(),
        poster_url: latest.poster_url ?? d.poster_url,
      },
      "Couldn't refresh the show",
    )
    return true
  } catch (err) {
    console.warn('[watched] refresh failed', err)
    return false
  }
}
