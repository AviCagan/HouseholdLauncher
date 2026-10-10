import { tvmazeGet, type TvmShow } from './tvmaze'
import { addDaysIso, isoDay } from './model'

/**
 * Premieres in the next week or so — new shows and new seasons — for slotting
 * something in before it airs.
 *
 * TVmaze's schedule is per day: one call for broadcast TV in the US and one
 * for streaming. Each day is about 200 KB of every episode airing anywhere,
 * so this only runs when someone opens "Coming soon", keeps just the
 * premieres, and caches the boiled-down list per day so the next open costs
 * nothing.
 */

export interface Upcoming {
  tvmazeId: number
  title: string
  season: number
  airdate: string
  network: string | null
  poster: string | null
  /** A brand-new show rather than a returning one. */
  isNew: boolean
  type: string | null
}

interface ScheduleEntry {
  season?: number
  number?: number | null
  airdate?: string | null
  show?: TvmShow
  _embedded?: { show?: TvmShow }
}

/**
 * The kinds of show worth suggesting. Talk shows, news, sports and game
 * shows premiere "seasons" constantly and would bury everything else.
 */
const KEEP_TYPES = new Set(['Scripted', 'Animation', 'Documentary', 'Reality'])

export function premieresFrom(entries: unknown): Upcoming[] {
  if (!Array.isArray(entries)) return []
  const best = new Map<number, Upcoming>()
  for (const raw of entries as ScheduleEntry[]) {
    const show = raw.show ?? raw._embedded?.show
    if (!show || typeof show.id !== 'number' || !show.name) continue
    if (raw.number !== 1 || !raw.season || !raw.airdate) continue
    if (show.language && show.language !== 'English') continue
    if (show.type && !KEEP_TYPES.has(show.type)) continue
    const item: Upcoming = {
      tvmazeId: show.id,
      title: show.name.trim(),
      season: raw.season,
      airdate: raw.airdate.slice(0, 10),
      network: show.network?.name ?? show.webChannel?.name ?? null,
      poster: show.image?.medium ?? null,
      isNew: raw.season === 1,
      type: show.type ?? null,
    }
    const existing = best.get(show.id)
    if (!existing || item.airdate < existing.airdate) best.set(show.id, item)
  }
  return [...best.values()]
}

const CACHE_PREFIX = 'watched:soon:'
/** A day's premieres don't change much; half a day is fresh enough. */
const CACHE_TTL_MS = 12 * 60 * 60 * 1000

interface Cached {
  at: number
  items: Upcoming[]
}

function readCache(date: string, now: number): Upcoming[] | null {
  try {
    const raw = localStorage.getItem(CACHE_PREFIX + date)
    if (!raw) return null
    const parsed = JSON.parse(raw) as Cached
    return now - parsed.at < CACHE_TTL_MS ? parsed.items : null
  } catch {
    return null
  }
}

function writeCache(date: string, items: Upcoming[], now: number): void {
  try {
    localStorage.setItem(CACHE_PREFIX + date, JSON.stringify({ at: now, items } satisfies Cached))
    // Old days are dead weight; drop anything before today.
    const today = isoDay(new Date(now))
    for (let i = localStorage.length - 1; i >= 0; i--) {
      const key = localStorage.key(i)
      if (key?.startsWith(CACHE_PREFIX) && key.slice(CACHE_PREFIX.length) < today) localStorage.removeItem(key)
    }
  } catch {
    // Storage full or unavailable: the list still shows, it just isn't kept.
  }
}

/** What's already cached for the next `days` days, without asking TVmaze — or null if any day is missing. */
export function peekComingSoon(days = 7, now: Date = new Date()): Upcoming[] | null {
  const today = isoDay(now)
  const seen = new Map<number, Upcoming>()
  for (let i = 0; i < days; i++) {
    const items = readCache(addDaysIso(today, i), now.getTime())
    if (!items) return null
    for (const item of items) {
      const existing = seen.get(item.tvmazeId)
      if (!existing || item.airdate < existing.airdate) seen.set(item.tvmazeId, item)
    }
  }
  return [...seen.values()].sort((a, b) => a.airdate.localeCompare(b.airdate) || a.title.localeCompare(b.title))
}

/**
 * The next `days` days of premieres, soonest first. `onProgress` gets the
 * list so far after each day lands, so the screen fills in as it loads
 * instead of waiting on all of it.
 */
export async function loadComingSoon(
  days = 7,
  opts: { signal?: AbortSignal; now?: Date; onProgress?: (items: Upcoming[]) => void } = {},
): Promise<Upcoming[]> {
  const now = opts.now ?? new Date()
  const today = isoDay(now)
  const seen = new Map<number, Upcoming>()
  const emit = () => {
    const list = [...seen.values()].sort((a, b) => a.airdate.localeCompare(b.airdate) || a.title.localeCompare(b.title))
    opts.onProgress?.(list)
    return list
  }

  for (let i = 0; i < days; i++) {
    const date = addDaysIso(today, i)
    let items = readCache(date, now.getTime())
    if (!items) {
      const [broadcast, streaming] = await Promise.all([
        tvmazeGet<unknown[]>(`/schedule?country=US&date=${date}`, opts.signal).catch(() => []),
        tvmazeGet<unknown[]>(`/schedule/web?date=${date}`, opts.signal).catch(() => []),
      ])
      items = premieresFrom([...broadcast, ...streaming])
      writeCache(date, items, now.getTime())
    }
    for (const item of items) {
      const existing = seen.get(item.tvmazeId)
      if (!existing || item.airdate < existing.airdate) seen.set(item.tvmazeId, item)
    }
    emit()
  }
  return emit()
}
