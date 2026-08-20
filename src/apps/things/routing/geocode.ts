export interface LatLng {
  lat: number
  lng: number
}

export interface GeocodeResult extends LatLng {
  displayName: string
  provider: 'photon' | 'nominatim'
}

/**
 * Address → coordinates, without an API key.
 *
 * Photon is primary rather than Nominatim for a decisive reason: `User-Agent`
 * is a forbidden header in browser `fetch`, so a web app physically *cannot*
 * comply with Nominatim's usage policy, and it returns 403 to datacenter and
 * unidentified traffic. Photon is OSM-backed, keyless, and POI-aware, which
 * also makes it much better at "Costco Brooklyn" than a strict address parser.
 *
 * Nominatim stays as a secondary for well-formed street addresses, and manual
 * coordinate entry is the guaranteed floor.
 *
 * Every call must run on the user's device. Geocoding from CI or a server is
 * exactly what gets these free endpoints to block you.
 */

const PHOTON = 'https://photon.komoot.io/api/'
const NOMINATIM = 'https://nominatim.openstreetmap.org/search'

/** ≥1 req/s satisfies Nominatim's policy and is polite to Photon regardless. */
const MIN_GAP_MS = 1100
let queue: Promise<unknown> = Promise.resolve()

function serialize<T>(task: () => Promise<T>): Promise<T> {
  const run = queue.then(async () => {
    const result = await task()
    await new Promise((r) => setTimeout(r, MIN_GAP_MS))
    return result
  })
  // Keep the chain alive even when a link rejects.
  queue = run.catch(() => undefined)
  return run as Promise<T>
}

export const normalizeQuery = (q: string): string =>
  q.trim().toLowerCase().replace(/\s+/g, ' ')

async function fetchJson(url: string, timeoutMs = 8000): Promise<unknown> {
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), timeoutMs)
  try {
    const res = await fetch(url, { signal: ctrl.signal })
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    return await res.json()
  } finally {
    clearTimeout(timer)
  }
}

interface PhotonResponse {
  features?: Array<{
    geometry?: { coordinates?: [number, number] }
    properties?: Record<string, string | undefined>
  }>
}

async function viaPhoton(query: string): Promise<GeocodeResult | null> {
  const url = `${PHOTON}?q=${encodeURIComponent(query)}&limit=1`
  const json = (await fetchJson(url)) as PhotonResponse
  const f = json.features?.[0]
  const coords = f?.geometry?.coordinates
  if (!coords) return null

  // GeoJSON is [lng, lat] — the reverse of everything else here.
  const [lng, lat] = coords
  const p = f.properties ?? {}
  const displayName = [p.name, p.street, p.city, p.state]
    .filter(Boolean)
    .join(', ')

  return { lat, lng, displayName: displayName || query, provider: 'photon' }
}

interface NominatimEntry {
  lat: string
  lon: string
  display_name: string
}

async function viaNominatim(query: string): Promise<GeocodeResult | null> {
  const url = `${NOMINATIM}?q=${encodeURIComponent(query)}&format=jsonv2&limit=1`
  const json = (await fetchJson(url)) as NominatimEntry[]
  const first = json?.[0]
  if (!first) return null
  return {
    lat: parseFloat(first.lat),
    lng: parseFloat(first.lon),
    displayName: first.display_name,
    provider: 'nominatim',
  }
}

/**
 * Cache lookups are injected so this module stays free of store imports and
 * can be unit tested without a database.
 */
export interface GeocodeCache {
  get(key: string): Promise<GeocodeResult | null>
  put(key: string, value: GeocodeResult): Promise<void>
}

export async function geocode(
  query: string,
  cache?: GeocodeCache,
): Promise<GeocodeResult | null> {
  const key = normalizeQuery(query)
  if (!key) return null

  const cached = await cache?.get(key)
  if (cached) return cached

  return serialize(async () => {
    let result: GeocodeResult | null = null
    try {
      result = await viaPhoton(key)
    } catch {
      /* fall through to the secondary */
    }
    if (!result) {
      try {
        result = await viaNominatim(key)
      } catch {
        // 403 here is expected, not exceptional — see the note above.
      }
    }
    if (result) await cache?.put(key, result)
    return result
  })
}

export interface PlaceSuggestion extends LatLng {
  /**
   * One-line label for the dropdown, name included — that's what makes two
   * branches of the same chain tellable apart while picking.
   */
  label: string
  /**
   * The postal address ONLY — never prefixed with the place's name. A store's
   * address field is shown beneath its name, so including the name here
   * rendered as "Taster's Market — Taster's Market, 330 Bradley Avenue".
   */
  address: string
  /**
   * Just the place's own name, e.g. "Taster's Market".
   *
   * Kept separate from `address` so a name field can be filled with a name
   * rather than the entire postal address.
   */
  name: string | null
}

/**
 * Type-ahead search for the address fields.
 *
 * Separate from `geocode()` on purpose: that one is serialised at ≥1.1s to
 * respect the free geocoders' rate limits, which would make typing feel
 * broken. Suggestions go straight out, debounced by the caller instead, and
 * are abortable so an in-flight request for older text can't overwrite newer
 * results.
 */
export async function searchPlaces(
  query: string,
  signal?: AbortSignal,
  limit = 5,
): Promise<PlaceSuggestion[]> {
  const q = query.trim()
  if (q.length < 3) return []

  const url = `${PHOTON}?q=${encodeURIComponent(q)}&limit=${limit}`
  const res = await fetch(url, { signal })
  if (!res.ok) return []
  const json = (await res.json()) as PhotonResponse

  return (json.features ?? [])
    .map((f) => {
      const c = f.geometry?.coordinates
      if (!c) return null
      const p = f.properties ?? {}
      const street = [p.housenumber, p.street].filter(Boolean).join(' ')
      const locality = [p.city, p.state, p.postcode].filter(Boolean).join(', ')
      const name = p.name && p.name !== street ? p.name : null
      // Address stays name-free. The label keeps the name so the dropdown can
      // still distinguish two branches of the same chain.
      const address = [street, locality].filter(Boolean).join(', ')
      const label = [name, address].filter(Boolean).join(' — ')
      return {
        lat: c[1],
        lng: c[0],
        label: label || name || q,
        address: address || '',
        name,
      }
    })
    .filter((x): x is PlaceSuggestion => x !== null)
}

/** "40.7128, -74.0060" — the manual-entry escape hatch. */
export function parseCoordinates(input: string): LatLng | null {
  const m = input.trim().match(/^(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)$/)
  if (!m) return null
  const lat = parseFloat(m[1])
  const lng = parseFloat(m[2])
  if (Math.abs(lat) > 90 || Math.abs(lng) > 180) return null
  return { lat, lng }
}
