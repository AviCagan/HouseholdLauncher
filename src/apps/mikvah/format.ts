import { civilDayIn, civilOf, hebrewLabel, type Zmanim } from './engine'

/**
 * Times and dates as she reads them: in the time zone of wherever she was at
 * that moment, so a trip shows its own clock.
 */

const cache = new Map<string, Intl.DateTimeFormat>()
function fmt(key: string, opts: Intl.DateTimeFormatOptions): Intl.DateTimeFormat {
  let f = cache.get(key)
  if (!f) {
    f = new Intl.DateTimeFormat('en-US', opts)
    cache.set(key, f)
  }
  return f
}

export function time(t: number, tz: string): string {
  if (!Number.isFinite(t)) return '—'
  return fmt(`t|${tz}`, { timeZone: tz, hour: 'numeric', minute: '2-digit' }).format(new Date(t)).toLowerCase().replace(' ', ' ')
}

export function day(t: number, tz: string): string {
  if (!Number.isFinite(t)) return '—'
  return fmt(`d|${tz}`, { timeZone: tz, weekday: 'short', month: 'short', day: 'numeric' }).format(new Date(t))
}

/** "Thu Nov 26, 4:12 pm" where she was then. */
export function when(t: number, z: Zmanim | null): string {
  if (!Number.isFinite(t)) return '—'
  const tz = z ? z.placeAt(t).tz : Intl.DateTimeFormat().resolvedOptions().timeZone
  return `${day(t, tz)}, ${time(t, tz)}`
}

export const tzAt = (t: number, z: Zmanim | null): string => (z ? z.placeAt(t).tz : Intl.DateTimeFormat().resolvedOptions().timeZone)

/** A civil 'YYYY-MM-DD' as "Thu Nov 26". */
export function civilLabel(d: string): string {
  const [y, m, dd] = d.split('-').map(Number)
  return fmt('c', { timeZone: 'UTC', weekday: 'short', month: 'short', day: 'numeric' }).format(new Date(Date.UTC(y, m - 1, dd, 12)))
}

/** The Hebrew date and the civil day it mostly falls on: "16 Kislev · Thu Nov 26". */
export const dateBoth = (abs: number): string => `${hebrewLabel(abs, false)} · ${civilLabel(civilOf(abs))}`

export const hebrew = (abs: number): string => hebrewLabel(abs, false)

/** A Hebrew date's night, by the evening it begins: "14 Kislev · Mon, Nov 23, evening". */
export const nightBoth = (abs: number): string => `${hebrewLabel(abs, false)} · ${civilLabel(civilOf(abs - 1))}, evening`

/** "in 2d 4h", "in 3h 12m", "in 12m", "now". */
export function countdown(ms: number): string {
  if (!Number.isFinite(ms)) return ''
  if (ms <= 30_000) return 'now'
  const m = Math.round(ms / 60_000)
  const d = Math.floor(m / 1440)
  const h = Math.floor((m % 1440) / 60)
  const mm = m % 60
  if (d > 0) return `in ${d}d ${h}h`
  if (h > 0) return `in ${h}h ${mm}m`
  return `in ${mm}m`
}

/** Today's civil date where she is. */
export const today = (now: number, z: Zmanim | null): string => civilDayIn(now, tzAt(now, z))

/** 'YYYY-MM-DDTHH:mm' for an <input type="datetime-local">, in a zone. */
export function toLocalInput(t: number, tz: string): string {
  const parts = fmt(`i|${tz}`, {
    timeZone: tz,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(new Date(t))
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? '00'
  return `${get('year')}-${get('month')}-${get('day')}T${get('hour')}:${get('minute')}`
}

/** The instant an <input type="datetime-local"> value means in a zone. */
export function fromLocalInput(v: string, tz: string): number {
  const [d, hm] = v.split('T')
  const [hh, mm] = (hm ?? '00:00').split(':').map(Number)
  // Guess as UTC, then correct by the zone's offset at that moment (twice, for DST edges).
  let t = Date.parse(`${d}T${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}:00Z`)
  for (let i = 0; i < 2; i++) {
    const shown = toLocalInput(t, tz)
    const diff = Date.parse(`${shown}:00Z`) - Date.parse(`${v}:00Z`)
    t -= diff
  }
  return t
}
