import { SUPABASE_URL } from './env'
import type { Chore, RecurrenceUnit, Weekday } from '@/data/types'

/**
 * Two ways to get chores into Google Calendar, because neither one alone is
 * good enough:
 *
 *   1. **Subscribe to the feed** — an iCalendar URL served by the `calendar`
 *      Edge Function. Every recurring chore, kept in step automatically,
 *      reminders included. The catch is that Google refreshes subscribed feeds
 *      on its own cadence, often somewhere between a few hours and a day. A
 *      chore added this morning may not surface until tonight.
 *   2. **Add one chore now** — a Google "template" link that opens a pre-filled
 *      event, recurrence and all, which lands the moment you press save.
 *
 * So: subscribe once for the steady state, and use the per-chore link when you
 * want something on the calendar immediately.
 */

const FREQ: Record<Exclude<RecurrenceUnit, 'weekdays'>, string> = {
  hours: 'HOURLY',
  days: 'DAILY',
  weeks: 'WEEKLY',
  months: 'MONTHLY',
  years: 'YEARLY',
}

/** RFC 5545 BYDAY codes, indexed 0 (Sunday) .. 6 (Saturday) — same convention as everywhere else. */
const BYDAY = ['SU', 'MO', 'TU', 'WE', 'TH', 'FR', 'SA']

/** Chores have no duration; half an hour is a choice that reads well on a grid. */
export const EVENT_MINUTES = 30

export const ALARM_OPTIONS: { minutes: number; label: string }[] = [
  { minutes: 0, label: 'None' },
  { minutes: 10, label: '10 min' },
  { minutes: 30, label: '30 min' },
  { minutes: 60, label: '1 hour' },
  { minutes: 1440, label: '1 day' },
]

/**
 * "RRULE:FREQ=WEEKLY;INTERVAL=2", or "RRULE:FREQ=WEEKLY;BYDAY=TU,WE" for a
 * chore repeating on chosen weekdays. Null when the chore doesn't repeat.
 */
export function rruleFor(
  count: number | null,
  unit: RecurrenceUnit | null,
  days: Weekday[] | null = null,
): string | null {
  if (unit === 'weekdays') {
    if (!days?.length) return null
    const codes = [...days].sort((a, b) => a - b).map((d) => BYDAY[d])
    return `RRULE:FREQ=WEEKLY;BYDAY=${codes.join(',')}`
  }
  if (!count || !unit) return null
  const freq = FREQ[unit]
  if (!freq) return null
  return `RRULE:FREQ=${freq};INTERVAL=${Math.max(1, Math.round(count))}`
}

/**
 * The first date on or after `from` whose local weekday is in `days`. Used so
 * a never-completed weekday chore's calendar event always lands on one of the
 * chosen days rather than on whatever day "now" happens to be.
 */
function nextMatchingWeekday(from: Date, days: Weekday[]): Date {
  for (let step = 0; step < 7; step++) {
    const candidate = new Date(from.getTime() + step * 86_400_000)
    if (days.includes(candidate.getDay() as Weekday)) return candidate
  }
  return from
}

/** 2026-08-09T14:00:00.000Z → 20260809T140000Z (the only format Google takes). */
export function icsStamp(d: Date): string {
  return d.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '')
}

/**
 * When the next occurrence lands.
 *
 * `next_due_at` is null until a recurring chore is completed for the first
 * time, which is exactly the case where it is due right now — so "now" is the
 * right fallback rather than an error.
 */
export function nextOccurrence(chore: Chore, now = Date.now()): Date {
  const at = chore.next_due_at ? new Date(chore.next_due_at) : null
  return at && !Number.isNaN(at.getTime()) ? at : new Date(now)
}

/** A fresh, unguessable feed token. Regenerating one revokes the old URL. */
export function newCalendarToken(): string {
  return crypto.randomUUID().replace(/-/g, '')
}

/** The feed URL Google subscribes to. Empty until Supabase is configured. */
export function feedUrl(token: string | null): string {
  if (!token || !SUPABASE_URL) return ''
  return `${SUPABASE_URL}/functions/v1/calendar?key=${encodeURIComponent(token)}`
}

/**
 * `webcal:` is the same URL under a scheme that phones hand straight to a
 * calendar app — the one-tap path on iOS, where Google's web subscribe flow is
 * awkward.
 */
export function webcalUrl(token: string | null): string {
  const url = feedUrl(token)
  return url ? url.replace(/^https?:/, 'webcal:') : ''
}

/** Google Calendar's "add by URL" screen, pre-filled with the feed. */
export function googleSubscribeUrl(token: string | null): string {
  const url = feedUrl(token)
  return url
    ? `https://calendar.google.com/calendar/r?cid=${encodeURIComponent(url)}`
    : ''
}

/**
 * A pre-filled Google Calendar event for one chore, recurrence included.
 *
 * Returns null for chores that don't repeat — a one-off chore has no date to
 * put an event on.
 */
export function googleEventUrl(chore: Chore, now = Date.now()): string | null {
  const recur = rruleFor(chore.recurrence_count, chore.recurrence_unit, chore.recurrence_days)
  if (!chore.is_recurring || !recur) return null

  let start = nextOccurrence(chore, now)
  if (chore.recurrence_unit === 'weekdays' && !chore.next_due_at) {
    start = nextMatchingWeekday(start, chore.recurrence_days ?? [])
  }
  const end = new Date(start.getTime() + EVENT_MINUTES * 60_000)

  const params = new URLSearchParams({
    action: 'TEMPLATE',
    text: chore.title,
    dates: `${icsStamp(start)}/${icsStamp(end)}`,
    recur,
  })
  if (chore.notes) params.set('details', chore.notes)

  return `https://calendar.google.com/calendar/render?${params.toString()}`
}
