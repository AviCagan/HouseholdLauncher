import { HDate, HebrewCalendar, Location, Zmanim as HebcalZmanim, flags } from '@hebcal/core'

/**
 * Hebrew dates and zmanim, and nothing else: the two things every rule in
 * the engine is measured in.
 *
 * A Hebrew date is carried as its absolute day number (`abs`, the R.D. count
 * hebcal uses), so "the same date next month" and "day 30" are arithmetic on
 * integers rather than on Date objects that drift with time zones. An onah is
 * a Hebrew date plus which half: the night comes first, because the Hebrew
 * date changes at shkiah.
 *
 * Zmanim are computed on the device by @hebcal/core (pinned), with the Baal
 * HaTanya methods Chabad.org publishes. Nothing about where she is or when
 * leaves the phone.
 */

export type Half = 'night' | 'day'

export interface Onah {
  abs: number
  half: Half
}

/** Night before day, one apart: so onot sort and compare as plain numbers. */
export const onahIndex = (o: Onah): number => o.abs * 2 + (o.half === 'day' ? 1 : 0)
export const fromIndex = (i: number): Onah => ({ abs: Math.floor(i / 2), half: i % 2 === 0 ? 'night' : 'day' })
export const sameOnah = (a: Onah, b: Onah): boolean => a.abs === b.abs && a.half === b.half

// --- Hebrew dates ---------------------------------------------------------------

export const hdate = (abs: number): HDate => new HDate(abs)

/** The civil day ('YYYY-MM-DD') whose daytime is this Hebrew date. */
export function civilOf(abs: number): string {
  const g = hdate(abs).greg()
  return `${g.getFullYear()}-${pad(g.getMonth() + 1)}-${pad(g.getDate())}`
}

export function absOfCivil(day: string): number {
  const [y, m, d] = day.split('-').map(Number)
  return new HDate(new Date(y, m - 1, d)).abs()
}

export const addCivilDays = (day: string, n: number): string => civilOf(absOfCivil(day) + n)

/** Day of the Hebrew month, 1–30. */
export const dayOfMonth = (abs: number): number => hdate(abs).getDate()

/** 0 = Sunday … 6 = Shabbat, for the civil day of this Hebrew date. */
export const weekday = (abs: number): number => hdate(abs).getDay()

function monthLength(abs: number): number {
  const h = hdate(abs)
  return HDate.daysInMonth(h.getMonth(), h.getFullYear())
}

/**
 * The same day of the month, one month on — following the real order of
 * months, so Shevat → Adar I → Adar II → Nisan in a leap year (V4), across
 * Elul → Tishrei into the next year. Null when that month is too short: the
 * 30th has no match in a 29-day month (V3).
 */
export function sameDayNextMonth(abs: number): number | null {
  const d = dayOfMonth(abs)
  const firstOfNext = abs - (d - 1) + monthLength(abs)
  if (d > monthLength(firstOfNext)) return null
  return firstOfNext + d - 1
}

/** "12 Kislev 5787". */
export function hebrewLabel(abs: number, withYear = true): string {
  const h = hdate(abs)
  return `${h.getDate()} ${monthName(abs)}${withYear ? ` ${h.getFullYear()}` : ''}`
}

/** hebcal's month names with the spellings the Chabad guides use ("Shevat", not "Sh'vat"). */
export function monthName(abs: number): string {
  const n = hdate(abs).getMonthName()
  return n === "Sh'vat" ? 'Shevat' : n
}

export const isMonth = (abs: number, name: string, day: number): boolean => {
  const h = hdate(abs)
  return h.getDate() === day && monthName(abs) === name
}

// --- places -----------------------------------------------------------------------

export interface Place {
  /** A label she chose; never shipped as a default. */
  name: string
  lat: number
  lng: number
  tz: string
  elevation?: number
}

/** Where she was over a range of civil days (inclusive, in the place's own zone). */
export interface Stay {
  from: string
  to: string
  place: Place
}

const fmtCache = new Map<string, Intl.DateTimeFormat>()

/** The civil day of an instant, in a time zone. */
export function civilDayIn(t: number, tz: string): string {
  let f = fmtCache.get(tz)
  if (!f) {
    f = new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' })
    fmtCache.set(tz, f)
  }
  return f.format(new Date(t))
}

// --- zmanim -----------------------------------------------------------------------

/** One civil day's times, as epoch milliseconds. Null when the sun doesn't do it there that day. */
export interface DayTimes {
  netz: number | null
  shkiah: number | null
  shkiahAmitis: number | null
  minchaKetanah: number | null
  plag: number | null
  tzeit: number | null
  tzeitShabbat: number | null
}

export interface Zmanim {
  /** Where she was at this instant (trips, else home). */
  placeAt(t: number): Place
  /** Where she was on this civil day. */
  placeOn(day: string): Place
  times(day: string, place?: Place): DayTimes
  /** Nightfall at another angle (M1's "other tzeit angle"). */
  tzeitAt(day: string, angle: number): number | null
  /** Shabbat or Yom Tov — a day melacha is forbidden — at the place she was. */
  isRestDay(day: string): boolean
}

const ms = (d: Date | null | undefined): number | null => {
  if (!d) return null
  const t = d.getTime()
  return Number.isFinite(t) ? t : null
}

/**
 * The zmanim provider the app uses: hebcal's Baal HaTanya methods —
 * published netz and shkiah (0.833°), shkiah amitis (1.583°), mincha ketanah
 * and plag by the Baal HaTanya's hours, tzeit at 6° and Shabbat's end at
 * 8.5° (Chabad.org, "About Our Zmanim Calculations").
 */
export function hebcalZmanim(home: Place, stays: Stay[] = []): Zmanim {
  const cache = new Map<string, DayTimes>()
  const placeOn = (day: string): Place => stays.find((s) => s.from <= day && day <= s.to)?.place ?? home
  return {
    placeOn,
    placeAt(t) {
      for (const s of stays) {
        const day = civilDayIn(t, s.place.tz)
        if (s.from <= day && day <= s.to) return s.place
      }
      return home
    },
    times(day, place = placeOn(day)) {
      const key = `${day}|${place.lat}|${place.lng}|${place.tz}|${place.elevation ?? 0}`
      const hit = cache.get(key)
      if (hit) return hit
      const [y, m, d] = day.split('-').map(Number)
      const loc = new Location(place.lat, place.lng, false, place.tz, place.name, undefined, undefined, place.elevation ?? 0)
      const z = new HebcalZmanim(loc, new Date(y, m - 1, d), false)
      const out: DayTimes = {
        netz: ms(z.sunrise()),
        shkiah: ms(z.sunset()),
        shkiahAmitis: ms(z.timeAtAngle(1.583, false)),
        minchaKetanah: ms(z.minchaKetanaBaalHatanya()),
        plag: ms(z.plagHaminchaBaalHatanya()),
        tzeit: ms(z.tzeit(6)),
        tzeitShabbat: ms(z.tzeit(8.5)),
      }
      cache.set(key, out)
      return out
    },
    tzeitAt(day, angle) {
      const place = placeOn(day)
      const [y, m, d] = day.split('-').map(Number)
      const loc = new Location(place.lat, place.lng, false, place.tz, place.name, undefined, undefined, place.elevation ?? 0)
      return ms(new HebcalZmanim(loc, new Date(y, m - 1, d), false).tzeit(angle))
    },
    isRestDay(day) {
      const [y, m, d] = day.split('-').map(Number)
      const date = new Date(y, m - 1, d)
      if (date.getDay() === 6) return true
      const il = placeOn(day).tz === 'Asia/Jerusalem'
      const evs = HebrewCalendar.getHolidaysOnDate(new HDate(date), il) ?? []
      return evs.some((e) => (e.getFlags() & flags.CHAG) !== 0)
    },
  }
}

const pad = (n: number) => String(n).padStart(2, '0')

/** "16:33" in a zone — for labels and tests. */
export function clock(t: number, tz: string): string {
  return new Intl.DateTimeFormat('en-GB', { timeZone: tz, hour: '2-digit', minute: '2-digit', hour12: false }).format(new Date(t))
}
