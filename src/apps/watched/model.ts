import type { EpisodeTuple, SeasonInfo, WatchShow } from '@/data/types'

/**
 * The shape of a show, in the units the estimates work in: episodes, minutes,
 * and the day each episode becomes watchable.
 *
 * Pure. No store, no network — everything here is tested directly.
 */

/** What an episode is assumed to run when nobody says. A drama hour, roughly. */
export const DEFAULT_RUNTIME = 45

export interface Ep {
  season: number
  number: number
  minutes: number
  /** Local "YYYY-MM-DD", or null when nobody has dated it yet. */
  airdate: string | null
  /**
   * True when the episode isn't listed yet and was inferred from the season's
   * announced length — its date (if any) is extrapolated from the cadence of
   * the episodes that are.
   */
  inferred: boolean
}

/** Runtime for one episode, falling back to the show's average, then a default. */
export function runtimeOf(tuple: EpisodeTuple, show: Pick<WatchShow, 'avg_runtime'>): number {
  const own = tuple[2]
  if (own && own > 0) return own
  if (show.avg_runtime && show.avg_runtime > 0) return show.avg_runtime
  return DEFAULT_RUNTIME
}

/** "2026-10-12" + n days, as "YYYY-MM-DD", without a timezone ever touching it. */
export function addDaysIso(iso: string, days: number): string {
  const [y, m, d] = iso.split('-').map(Number)
  const t = Date.UTC(y, m - 1, d) + days * 86_400_000
  return new Date(t).toISOString().slice(0, 10)
}

/** Whole days from a to b, both "YYYY-MM-DD". */
export function daysBetweenIso(a: string, b: string): number {
  const [ay, am, ad] = a.split('-').map(Number)
  const [by, bm, bd] = b.split('-').map(Number)
  return Math.round((Date.UTC(by, bm - 1, bd) - Date.UTC(ay, am - 1, ad)) / 86_400_000)
}

/** The local calendar day of a Date, as "YYYY-MM-DD". */
export function isoDay(date: Date): string {
  const y = date.getFullYear()
  const m = String(date.getMonth() + 1).padStart(2, '0')
  const d = String(date.getDate()).padStart(2, '0')
  return `${y}-${m}-${d}`
}

/** Local midnight of a "YYYY-MM-DD". */
export function dayStart(iso: string): Date {
  const [y, m, d] = iso.split('-').map(Number)
  return new Date(y, m - 1, d)
}

function median(values: number[]): number {
  if (values.length === 0) return 7
  const sorted = [...values].sort((a, b) => a - b)
  const mid = Math.floor(sorted.length / 2)
  return sorted.length % 2 ? sorted[mid] : Math.round((sorted[mid - 1] + sorted[mid]) / 2)
}

/**
 * Every episode of the show, in order — listed ones, plus the ones a season
 * has announced but TVmaze hasn't listed yet.
 *
 * The inferred ones matter for anything airing. A new season is often
 * announced as "10 episodes" with only the first two listed; without filling
 * in the rest, "when will we finish it" would be answered as two weeks from
 * now. They are dated at the cadence the listed ones keep (weekly, usually;
 * all on one day for a streaming drop), and left undated when there is
 * nothing to go on — which the estimate then reports honestly as TBA.
 */
export function allEpisodes(show: Pick<WatchShow, 'episodes' | 'seasons' | 'avg_runtime'>): Ep[] {
  const listed: Ep[] = (show.episodes ?? [])
    .filter((t) => Array.isArray(t) && t[0] >= 1 && t[1] >= 1)
    .map((t) => ({
      season: t[0],
      number: t[1],
      minutes: runtimeOf(t, show),
      airdate: t[3] ?? null,
      inferred: false,
    }))
    .sort((a, b) => a.season - b.season || a.number - b.number)

  const bySeason = new Map<number, Ep[]>()
  for (const ep of listed) {
    const list = bySeason.get(ep.season)
    if (list) list.push(ep)
    else bySeason.set(ep.season, [ep])
  }

  const fallbackMinutes = show.avg_runtime && show.avg_runtime > 0 ? show.avg_runtime : DEFAULT_RUNTIME
  const out: Ep[] = []
  for (const n of seasonNumbers(show)) {
    const eps = bySeason.get(n) ?? []
    out.push(...eps)
    const info = (show.seasons ?? []).find((s) => s.n === n)
    const planned = info?.eps ?? null
    if (!planned || planned <= eps.length) continue

    // Cadence from the dated episodes of this season; the season's own
    // premiere when none are listed.
    const dated = eps.map((e) => e.airdate).filter((d): d is string => !!d)
    const gaps: number[] = []
    for (let i = 1; i < dated.length; i++) gaps.push(Math.max(0, daysBetweenIso(dated[i - 1], dated[i])))
    const cadence = dated.length >= 2 ? median(gaps) : 7
    const lastNumber = eps.length ? eps[eps.length - 1].number : 0
    let lastDate: string | null = dated.length ? dated[dated.length - 1] : null
    const firstFromPremiere = !lastDate && info?.premiere ? info.premiere : null

    for (let k = 1; k <= planned - eps.length; k++) {
      let airdate: string | null = null
      if (firstFromPremiere) airdate = addDaysIso(firstFromPremiere, (k - 1) * 7)
      else if (lastDate) {
        lastDate = addDaysIso(lastDate, cadence)
        airdate = lastDate
      }
      out.push({ season: n, number: lastNumber + k, minutes: fallbackMinutes, airdate, inferred: true })
    }
  }
  return out
}

/** Every season the show has or has announced, ascending. */
export function seasonNumbers(show: Pick<WatchShow, 'episodes' | 'seasons'>): number[] {
  const set = new Set<number>()
  for (const s of show.seasons ?? []) if (s.n >= 1) set.add(s.n)
  for (const t of show.episodes ?? []) if (Array.isArray(t) && t[0] >= 1) set.add(t[0])
  return [...set].sort((a, b) => a - b)
}

export interface SeasonStat {
  n: number
  /** Episodes in the season, counting announced-but-unlisted ones. */
  episodes: number
  minutes: number
  avgRuntime: number
  /** Episodes out by `today`. */
  aired: number
  premiere: string | null
  end: string | null
  /** Announced, but with no episode count or dates to go on. */
  tba: boolean
}

export function seasonStats(show: WatchShow, today: string): SeasonStat[] {
  const eps = allEpisodes(show)
  return seasonNumbers(show).map((n) => {
    const own = eps.filter((e) => e.season === n)
    const info: SeasonInfo | undefined = (show.seasons ?? []).find((s) => s.n === n)
    const minutes = own.reduce((t, e) => t + e.minutes, 0)
    const dated = own.map((e) => e.airdate).filter((d): d is string => !!d)
    return {
      n,
      episodes: own.length,
      minutes,
      avgRuntime: own.length ? Math.round(minutes / own.length) : (show.avg_runtime ?? DEFAULT_RUNTIME),
      aired: own.filter((e) => e.airdate !== null && e.airdate <= today).length,
      premiere: info?.premiere ?? dated[0] ?? null,
      end: info?.end ?? (dated.length === own.length && dated.length ? dated[dated.length - 1] : null),
      tba: own.length === 0 || own.some((e) => e.airdate === null && e.inferred),
    }
  })
}

/**
 * Seasons with at least one episode out by `today`. A season TVmaze lists as
 * announced — "Season 3, 8 episodes", no dates — isn't out, and counting it
 * would say a show has three seasons when you can watch two.
 */
export function seasonsOut(show: WatchShow, today: string): number[] {
  const out = new Set(
    allEpisodes(show)
      .filter((e) => e.airdate !== null && e.airdate <= today)
      .map((e) => e.season),
  )
  return seasonNumbers(show).filter((n) => out.has(n))
}

/** The last season with anything out — what "watched it all" means for a running show. */
export function lastSeasonOut(show: WatchShow, today: string): number | null {
  const out = seasonsOut(show, today)
  return out.length ? out[out.length - 1] : null
}

export interface ShowTotals {
  /** Seasons out, not counting ones only announced. */
  seasons: number
  /** Announced seasons with nothing out yet. */
  comingSeasons: number
  episodes: number
  minutes: number
  avgRuntime: number
  /** Average episodes per season, over seasons that have any. */
  avgEpisodesPerSeason: number
  airedEpisodes: number
  airedMinutes: number
}

export function showTotals(show: WatchShow, today: string): ShowTotals {
  const stats = seasonStats(show, today).filter((s) => s.episodes > 0)
  const episodes = stats.reduce((t, s) => t + s.episodes, 0)
  const minutes = stats.reduce((t, s) => t + s.minutes, 0)
  const aired = allEpisodes(show).filter((e) => e.airdate !== null && e.airdate <= today)
  const out = seasonsOut(show, today).length
  return {
    seasons: out,
    comingSeasons: seasonNumbers(show).length - out,
    episodes,
    minutes,
    avgRuntime: episodes ? Math.round(minutes / episodes) : (show.avg_runtime ?? DEFAULT_RUNTIME),
    avgEpisodesPerSeason: stats.length ? Math.round((episodes / stats.length) * 10) / 10 : 0,
    airedEpisodes: aired.length,
    airedMinutes: aired.reduce((t, e) => t + e.minutes, 0),
  }
}

/**
 * The episodes a lineup slot still has to get through, in order.
 *
 * Starts at the current position when there is one — the season being
 * watched and the episodes already done in it — otherwise at the first season
 * planned; ends at the planned last season, or the last season there is.
 */
export function remainingEpisodes(
  show: WatchShow,
  position: { season: number; done: number } | null = null,
): Ep[] {
  const eps = allEpisodes(show)
  const seasons = seasonNumbers(show)
  const firstSeason = seasons[0] ?? 1
  const fromSeason = position?.season ?? show.current_season ?? show.plan_from ?? firstSeason
  const done = position ? position.done : show.current_season ? show.current_episode : 0
  const toSeason = show.plan_to ?? Infinity

  let skipped = 0
  return eps.filter((e) => {
    if (e.season < fromSeason || e.season > toSeason) return false
    if (e.season === fromSeason && skipped < done) {
      skipped++
      return false
    }
    return true
  })
}

/** Episodes in one season, counting announced-but-unlisted ones. */
export function seasonLength(show: WatchShow, season: number): number {
  return allEpisodes(show).filter((e) => e.season === season).length
}

/** The highest season this slot covers that has at least one episode. */
export function lastPlannedSeason(show: WatchShow): number | null {
  const withEpisodes = [...new Set(allEpisodes(show).map((e) => e.season))]
  const capped = show.plan_to ? withEpisodes.filter((n) => n <= show.plan_to!) : withEpisodes
  return capped.length ? Math.max(...capped) : null
}

/** Has every episode of this season aired by `today`? */
export function seasonFullyAired(show: WatchShow, season: number, today: string): boolean {
  const eps = allEpisodes(show).filter((e) => e.season === season)
  return eps.length > 0 && eps.every((e) => e.airdate !== null && e.airdate <= today)
}

/** Are there episodes in the plan still to air? Decides "watch as it airs". */
export function hasUnairedEpisodes(show: WatchShow, today: string): boolean {
  return remainingEpisodes(show).some((e) => e.airdate === null || e.airdate > today)
}

/**
 * Is an episode they haven't seen out yet — something to put on tonight? A
 * show waiting in the lineup for its next season has nothing to start.
 */
export function hasEpisodeOut(show: WatchShow, today: string): boolean {
  return remainingEpisodes(show).some((e) => e.airdate !== null && e.airdate <= today)
}

// --- display ------------------------------------------------------------------

/** 75 → "1h 15m", 2000 → "33h 20m", 45 → "45m". */
export function formatMinutes(minutes: number): string {
  const m = Math.max(0, Math.round(minutes))
  const h = Math.floor(m / 60)
  const r = m % 60
  if (h === 0) return `${r}m`
  if (r === 0) return `${h}h`
  return `${h}h ${r}m`
}

/** Big totals read better in hours alone: 2000 → "33 hrs". */
export function formatHours(minutes: number): string {
  const h = minutes / 60
  if (h < 1) return `${Math.round(minutes)} min`
  if (h < 10) return `${Math.round(h * 10) / 10} hrs`
  return `${Math.round(h).toLocaleString('en-US')} hrs`
}

/** A span of days as people say it: "4 days", "3 weeks", "5 months", "2.5 years". */
export function formatSpan(days: number): string {
  if (!Number.isFinite(days)) return 'forever'
  const d = Math.max(0, Math.round(days))
  if (d <= 1) return d === 1 ? '1 day' : 'today'
  if (d < 14) return `${d} days`
  if (d < 63) return `${Math.round(d / 7)} weeks`
  if (d < 730) return `${Math.round(d / 30.44)} months`
  return `${Math.round((d / 365.25) * 10) / 10} years`
}

/** "5.6h a week" — hours, because that's how a person thinks about TV time. */
export const perWeek = (hours: number): string => `${hours < 10 ? Math.round(hours * 10) / 10 : Math.round(hours)}h a week`

/** "4h 10m a week". */
export const paceLabel = (minutesPerWeek: number): string => `${formatMinutes(minutesPerWeek)} a week`

/** "Apr 2029" — the precision an estimate months out actually has. */
export function formatMonth(date: Date): string {
  return date.toLocaleDateString('en-US', { month: 'short', year: 'numeric' })
}

/** "Fri, Oct 16" for something within the year; with the year when it isn't. */
export function formatDay(date: Date, now: Date = new Date()): string {
  const sameYear = date.getFullYear() === now.getFullYear()
  return date.toLocaleDateString('en-US', {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    ...(sameYear ? {} : { year: 'numeric' }),
  })
}

/** An estimate's date at the precision it deserves: a day when close, a month when far. */
export function formatWhen(date: Date, now: Date = new Date()): string {
  const days = (date.getTime() - now.getTime()) / 86_400_000
  if (days < 45) return formatDay(date, now)
  return formatMonth(date)
}

/** The years a show ran, the way a TV guide lists it: "2019–2023", "2022–". */
export function yearsLabel(show: Pick<WatchShow, 'premiered' | 'ended' | 'status'>): string {
  const from = show.premiered?.slice(0, 4)
  if (!from) return ''
  const to = show.ended?.slice(0, 4)
  if (to && to !== from) return `${from}–${to}`
  if (to) return from
  return show.status === 'Ended' ? from : `${from}–`
}
