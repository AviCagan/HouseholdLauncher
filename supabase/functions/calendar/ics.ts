// iCalendar serialisation for the chores feed.
//
// Kept apart from index.ts on purpose: nothing in here touches Deno, Supabase
// or the network, so the app's own test suite imports this exact file rather
// than a copy of it. A calendar feed that a client silently refuses to parse is
// the kind of bug you only notice a week later, so it is worth testing the
// bytes that actually ship.

export type Unit = 'hours' | 'days' | 'weeks' | 'months' | 'years' | 'weekdays'

export const FREQ: Record<Exclude<Unit, 'weekdays'>, string> = {
  hours: 'HOURLY',
  days: 'DAILY',
  weeks: 'WEEKLY',
  months: 'MONTHLY',
  years: 'YEARLY',
}

/**
 * RFC 5545 §3.3.10 BYDAY codes, indexed 0 (Sunday) .. 6 (Saturday) — the same
 * convention used everywhere else in the app, so no reordering is needed to
 * use this table.
 */
export const BYDAY = ['SU', 'MO', 'TU', 'WE', 'TH', 'FR', 'SA']

export interface ChoreRow {
  id: string
  title: string
  notes: string | null
  is_recurring: boolean
  recurrence_count: number | null
  recurrence_unit: Unit | null
  /** Only set when recurrence_unit is 'weekdays'. 0 (Sunday) .. 6 (Saturday). */
  recurrence_days: number[] | null
  next_due_at: string | null
  created_at: string
}

/** Chores have no duration; half an hour is a choice that reads well on a grid. */
export const EVENT_MINUTES = 30

/** 2026-08-09T14:00:00.000Z → 20260809T140000Z */
export function stamp(d: Date): string {
  return d.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '')
}

/**
 * The first date on or after `from` whose UTC weekday is in `days`. Used so
 * DTSTART for a never-completed weekday chore always lands on one of the
 * chosen days rather than on `created_at`'s own — arbitrary — weekday. RFC
 * 5545 permits a DTSTART that BYDAY doesn't match, but not every calendar
 * client renders that cleanly, and once the chore is completed once,
 * `next_due_at` will already be a matching day regardless — so events are
 * consistent from the very first one.
 */
export function nextMatchingWeekday(from: Date, days: number[]): Date {
  for (let step = 0; step < 7; step++) {
    const candidate = new Date(from.getTime() + step * 86_400_000)
    if (days.includes(candidate.getUTCDay())) return candidate
  }
  return from
}

/**
 * RFC 5545 §3.3.11. Backslash, semicolon and comma are structural inside a
 * property value, and a raw newline would end the line — all four have to be
 * escaped or a chore titled "Bins, recycling" silently truncates the event.
 */
export function esc(text: string): string {
  return text
    .replace(/\\/g, '\\\\')
    .replace(/;/g, '\\;')
    .replace(/,/g, '\\,')
    .replace(/\r?\n/g, '\\n')
}

/**
 * RFC 5545 §3.1: no line may exceed 75 octets, and continuations begin with a
 * single space. Counting UTF-16 code units would under-count emoji and
 * accented characters, so this measures encoded bytes.
 */
export function fold(line: string): string {
  const enc = new TextEncoder()
  if (enc.encode(line).length <= 75) return line

  const parts: string[] = []
  let current = ''
  let size = 0
  for (const ch of line) {
    const chSize = enc.encode(ch).length
    // Continuation lines carry a leading space, so their budget is one smaller.
    const limit = parts.length === 0 ? 75 : 74
    if (size + chSize > limit) {
      parts.push(current)
      current = ''
      size = 0
    }
    current += ch
    size += chSize
  }
  parts.push(current)
  return parts[0] + parts.slice(1).map((s) => `\r\n ${s}`).join('')
}

/** "RRULE:FREQ=WEEKLY;BYDAY=TU,WE" or "RRULE:FREQ=DAILY;INTERVAL=2" — or null. */
export function rrule(c: Pick<ChoreRow, 'recurrence_unit' | 'recurrence_count' | 'recurrence_days'>): string | null {
  if (c.recurrence_unit === 'weekdays') {
    if (!c.recurrence_days?.length) return null
    const days = [...c.recurrence_days].sort((a, b) => a - b).map((d) => BYDAY[d])
    return `RRULE:FREQ=WEEKLY;BYDAY=${days.join(',')}`
  }
  if (!c.recurrence_unit || !c.recurrence_count) return null
  const freq = FREQ[c.recurrence_unit]
  if (!freq) return null
  return `RRULE:FREQ=${freq};INTERVAL=${Math.max(1, Math.round(c.recurrence_count))}`
}

function describe(c: Pick<ChoreRow, 'recurrence_unit' | 'recurrence_count' | 'recurrence_days'>): string {
  if (c.recurrence_unit === 'weekdays' && c.recurrence_days?.length) {
    const names = [...c.recurrence_days]
      .sort((a, b) => a - b)
      .map((d) => ['Sundays', 'Mondays', 'Tuesdays', 'Wednesdays', 'Thursdays', 'Fridays', 'Saturdays'][d])
    return `Repeats on ${names.join(', ')}`
  }
  if (!c.recurrence_unit || !c.recurrence_count) return ''
  return c.recurrence_count === 1
    ? `Repeats every ${c.recurrence_unit.slice(0, -1)}`
    : `Repeats every ${c.recurrence_count} ${c.recurrence_unit}`
}

export function buildCalendar(
  chores: ChoreRow[],
  alarmMinutes: number,
  now = new Date(),
): string {
  const lines: string[] = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Things//Household chores//EN',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    'X-WR-CALNAME:Things — Chores',
    'X-WR-CALDESC:Recurring chores from your Things app',
    // Hints only. Google honours neither reliably.
    'REFRESH-INTERVAL;VALUE=DURATION:PT1H',
    'X-PUBLISHED-TTL:PT1H',
  ]

  for (const c of chores) {
    if (!c.is_recurring) continue
    const rule = rrule(c)
    if (!rule) continue

    // A chore that has never been completed is due now, and next_due_at stays
    // null until the first completion — so the creation time is the anchor.
    let start = new Date(c.next_due_at ?? c.created_at)
    if (Number.isNaN(start.getTime())) continue
    if (c.recurrence_unit === 'weekdays' && !c.next_due_at) {
      start = nextMatchingWeekday(start, c.recurrence_days ?? [])
    }
    const end = new Date(start.getTime() + EVENT_MINUTES * 60_000)

    lines.push(
      'BEGIN:VEVENT',
      // Stable per chore, so a re-poll updates the event instead of duplicating
      // it, and deleting the chore removes it from the calendar.
      `UID:${c.id}@things`,
      `DTSTAMP:${stamp(now)}`,
      `DTSTART:${stamp(start)}`,
      `DTEND:${stamp(end)}`,
      rule,
      `SUMMARY:${esc(c.title)}`,
      `DESCRIPTION:${esc([describe(c), c.notes ?? ''].filter(Boolean).join('\n\n'))}`,
      'TRANSP:TRANSPARENT',
    )

    if (alarmMinutes > 0) {
      lines.push(
        'BEGIN:VALARM',
        'ACTION:DISPLAY',
        `TRIGGER:-PT${Math.round(alarmMinutes)}M`,
        `DESCRIPTION:${esc(c.title)}`,
        'END:VALARM',
      )
    }

    lines.push('END:VEVENT')
  }

  lines.push('END:VCALENDAR')
  // CRLF is required by RFC 5545, and some clients genuinely reject LF-only.
  return lines.map(fold).join('\r\n') + '\r\n'
}
