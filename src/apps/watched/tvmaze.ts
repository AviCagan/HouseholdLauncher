import type { EpisodeTuple, SeasonInfo } from '@/data/types'

/**
 * TVmaze — where every show, season, runtime, air date and picture comes from.
 *
 * Chosen over the bigger databases for one reason: it needs no key. No
 * account to make, no secret to keep, nothing to set up, and it answers the
 * browser directly (it sends `Access-Control-Allow-Origin: *`), so search
 * works from the phone with no server in between. The data is CC BY-SA, and
 * the app says where it came from.
 *
 * Rate limited at 20 requests per 10 seconds per address; a 429 here waits
 * and retries rather than failing the search someone is typing.
 *
 * The mapping functions are pure and tested against real response shapes.
 */

export const TVMAZE = 'https://api.tvmaze.com'

// --- response shapes (only the fields used) -----------------------------------

interface TvmImage {
  medium?: string | null
  original?: string | null
}

export interface TvmShow {
  id: number
  name: string
  type?: string | null
  language?: string | null
  genres?: string[] | null
  status?: string | null
  runtime?: number | null
  averageRuntime?: number | null
  premiered?: string | null
  ended?: string | null
  network?: { name?: string | null } | null
  webChannel?: { name?: string | null } | null
  image?: TvmImage | null
  summary?: string | null
  _embedded?: {
    seasons?: TvmSeason[]
    episodes?: TvmEpisode[]
    nextepisode?: TvmEpisode | null
    images?: TvmGalleryImage[]
  }
}

interface TvmSeason {
  number: number
  episodeOrder?: number | null
  premiereDate?: string | null
  endDate?: string | null
}

interface TvmEpisode {
  season: number
  number: number | null
  runtime?: number | null
  airdate?: string | null
  type?: string | null
}

interface TvmGalleryImage {
  type?: string | null
  main?: boolean
  resolutions?: {
    original?: { url: string; width?: number; height?: number }
    medium?: { url: string; width?: number; height?: number }
  }
}

// --- what the app uses -----------------------------------------------------------

export interface SearchHit {
  tvmazeId: number
  title: string
  premiered: string | null
  ended: string | null
  status: string | null
  network: string | null
  poster: string | null
  averageRuntime: number | null
  genres: string[]
  language: string | null
  type: string | null
  summary: string | null
}

export interface PosterOption {
  url: string
  thumb: string
  kind: 'poster' | 'background' | 'banner' | 'other'
  width: number | null
  height: number | null
}

export interface ShowDetail {
  tvmaze_id: number
  title: string
  premiered: string | null
  ended: string | null
  status: string | null
  network: string | null
  genres: string[]
  summary: string | null
  poster_url: string | null
  avg_runtime: number | null
  episodes: EpisodeTuple[]
  seasons: SeasonInfo[]
  next_airdate: string | null
  posters: PosterOption[]
}

const ENTITIES: Record<string, string> = {
  '&amp;': '&', '&lt;': '<', '&gt;': '>', '&quot;': '"', '&#39;': "'", '&apos;': "'", '&nbsp;': ' ',
}

/** TVmaze summaries are HTML fragments. Text only, trimmed to a readable length. */
export function stripHtml(html: string | null | undefined, max = 600): string | null {
  if (!html) return null
  const text = html
    .replace(/<br\s*\/?>/gi, ' ')
    .replace(/<\/p>/gi, ' ')
    .replace(/<[^>]*>/g, '')
    .replace(/&[a-z#0-9]+;/gi, (m) => ENTITIES[m.toLowerCase()] ?? m)
    .replace(/\s+/g, ' ')
    .trim()
  if (!text) return null
  return text.length > max ? `${text.slice(0, max - 1).trimEnd()}…` : text
}

const day = (s: string | null | undefined): string | null =>
  s && /^\d{4}-\d{2}-\d{2}/.test(s) ? s.slice(0, 10) : null

const networkOf = (show: TvmShow): string | null =>
  show.network?.name?.trim() || show.webChannel?.name?.trim() || null

export function mapSearch(json: unknown): SearchHit[] {
  if (!Array.isArray(json)) return []
  return json
    .map((r) => (r as { show?: TvmShow }).show)
    .filter((s): s is TvmShow => !!s && typeof s.id === 'number' && !!s.name)
    .map((s) => ({
      tvmazeId: s.id,
      title: s.name.trim(),
      premiered: day(s.premiered),
      ended: day(s.ended),
      status: s.status ?? null,
      network: networkOf(s),
      poster: s.image?.medium ?? s.image?.original ?? null,
      averageRuntime: s.averageRuntime ?? s.runtime ?? null,
      genres: s.genres ?? [],
      language: s.language ?? null,
      type: s.type ?? null,
      summary: stripHtml(s.summary, 220),
    }))
}

export function mapPosters(images: TvmGalleryImage[] | undefined): PosterOption[] {
  const order: Record<PosterOption['kind'], number> = { poster: 0, background: 1, banner: 2, other: 3 }
  return (images ?? [])
    .map((img) => {
      const original = img.resolutions?.original
      const medium = img.resolutions?.medium
      if (!original?.url && !medium?.url) return null
      const kind: PosterOption['kind'] =
        img.type === 'poster' || img.type === 'background' || img.type === 'banner' ? img.type : 'other'
      return {
        url: (original?.url ?? medium?.url)!,
        thumb: (medium?.url ?? original?.url)!,
        kind,
        width: original?.width ?? null,
        height: original?.height ?? null,
        main: img.main === true,
      }
    })
    .filter((p): p is PosterOption & { main: boolean } => p !== null)
    .sort((a, b) => order[a.kind] - order[b.kind] || Number(b.main) - Number(a.main))
    .map(({ main: _main, ...p }) => p)
}

/** Full detail from `/shows/:id?embed[]=seasons&embed[]=episodes&embed[]=nextepisode&embed[]=images`. */
export function mapShowDetail(json: TvmShow): ShowDetail {
  const embedded = json._embedded ?? {}
  const episodes: EpisodeTuple[] = (embedded.episodes ?? [])
    // Specials have no number and sit outside the season count; leave them out.
    .filter((e) => typeof e.number === 'number' && e.number >= 1 && e.season >= 1)
    .map((e) => [e.season, e.number as number, e.runtime && e.runtime > 0 ? e.runtime : null, day(e.airdate)])
  const seasons: SeasonInfo[] = (embedded.seasons ?? [])
    .filter((s) => typeof s.number === 'number' && s.number >= 1)
    .map((s) => ({
      n: s.number,
      eps: s.episodeOrder && s.episodeOrder > 0 ? s.episodeOrder : null,
      premiere: day(s.premiereDate),
      end: day(s.endDate),
    }))
  return {
    tvmaze_id: json.id,
    title: json.name.trim(),
    premiered: day(json.premiered),
    ended: day(json.ended),
    status: json.status ?? null,
    network: networkOf(json),
    genres: json.genres ?? [],
    summary: stripHtml(json.summary),
    poster_url: json.image?.medium ?? json.image?.original ?? null,
    avg_runtime: json.averageRuntime ?? json.runtime ?? null,
    episodes,
    seasons,
    next_airdate: day(embedded.nextepisode?.airdate),
    posters: mapPosters(embedded.images),
  }
}

/**
 * The large version of a TVmaze picture, for the one place a poster is big.
 * Their URLs differ only in the size segment, so lists can carry the small
 * one and the detail view can still look sharp on a dense screen.
 */
export function largePoster(url: string | null): string | null {
  if (!url) return null
  return url.includes('static.tvmaze.com') ? url.replace('/medium_portrait/', '/original_untouched/') : url
}

// --- network ------------------------------------------------------------------------

const sleep = (ms: number, signal?: AbortSignal) =>
  new Promise<void>((resolve, reject) => {
    const timer = setTimeout(resolve, ms)
    signal?.addEventListener('abort', () => {
      clearTimeout(timer)
      reject(new DOMException('Aborted', 'AbortError'))
    })
  })

export class TvmazeError extends Error {
  readonly status: number

  constructor(message: string, status: number) {
    super(message)
    this.status = status
  }
}

export async function tvmazeGet<T>(path: string, signal?: AbortSignal): Promise<T> {
  for (let attempt = 0; attempt < 3; attempt++) {
    const res = await fetch(`${TVMAZE}${path}`, { signal })
    if (res.status === 429) {
      await sleep(1200 * (attempt + 1), signal)
      continue
    }
    if (!res.ok) throw new TvmazeError(`TVmaze answered ${res.status}`, res.status)
    return (await res.json()) as T
  }
  throw new TvmazeError('TVmaze is busy — try again in a moment', 429)
}

export async function searchShows(query: string, signal?: AbortSignal): Promise<SearchHit[]> {
  const q = query.trim()
  if (!q) return []
  return mapSearch(await tvmazeGet(`/search/shows?q=${encodeURIComponent(q)}`, signal))
}

export async function fetchShowDetail(tvmazeId: number, signal?: AbortSignal): Promise<ShowDetail> {
  const json = await tvmazeGet<TvmShow>(
    `/shows/${tvmazeId}?embed[]=seasons&embed[]=episodes&embed[]=nextepisode&embed[]=images`,
    signal,
  )
  return mapShowDetail(json)
}

export async function fetchPosters(tvmazeId: number, signal?: AbortSignal): Promise<PosterOption[]> {
  return mapPosters(await tvmazeGet<TvmGalleryImage[]>(`/shows/${tvmazeId}/images`, signal))
}
