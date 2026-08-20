import { describe, expect, it } from 'vitest'
import {
  buildCalendar,
  esc,
  fold,
  type ChoreRow,
} from '../../supabase/functions/calendar/ics'

/**
 * Tests the exact module the Edge Function ships, not a copy of it. A feed a
 * calendar client silently refuses to parse is the kind of bug you notice a
 * week later, when nothing showed up.
 */

const row = (patch: Partial<ChoreRow> = {}): ChoreRow => ({
  id: 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee',
  title: 'Take the bins out',
  notes: null,
  is_recurring: true,
  recurrence_count: 1,
  recurrence_unit: 'weeks',
  recurrence_days: null,
  next_due_at: '2026-08-10T09:00:00.000Z',
  created_at: '2026-08-01T00:00:00.000Z',
  ...patch,
})

const NOW = new Date('2026-08-09T12:00:00.000Z')

describe('esc', () => {
  it('escapes the four characters that are structural in a value', () => {
    expect(esc('Bins, recycling; and "glass"\\ok')).toBe(
      'Bins\\, recycling\\; and "glass"\\\\ok',
    )
    expect(esc('one\ntwo')).toBe('one\\ntwo')
  })
})

describe('fold', () => {
  it('leaves short lines alone', () => {
    expect(fold('SUMMARY:Bins')).toBe('SUMMARY:Bins')
  })

  it('folds long lines with a leading space on continuations', () => {
    const folded = fold('SUMMARY:' + 'a'.repeat(200))
    const parts = folded.split('\r\n')
    expect(parts.length).toBeGreaterThan(1)
    for (const p of parts.slice(1)) expect(p.startsWith(' ')).toBe(true)
    // Unfolding must give the original back exactly.
    expect(parts[0] + parts.slice(1).map((p) => p.slice(1)).join('')).toBe(
      'SUMMARY:' + 'a'.repeat(200),
    )
  })

  it('measures bytes, not code units, so multi-byte text still fits', () => {
    const folded = fold('SUMMARY:' + '★'.repeat(60))
    for (const p of folded.split('\r\n')) {
      expect(new TextEncoder().encode(p).length).toBeLessThanOrEqual(75)
    }
  })
})

describe('buildCalendar', () => {
  it('wraps events in a well-formed VCALENDAR terminated with CRLF', () => {
    const ics = buildCalendar([row()], 0, NOW)
    expect(ics.startsWith('BEGIN:VCALENDAR\r\n')).toBe(true)
    expect(ics.endsWith('END:VCALENDAR\r\n')).toBe(true)
    expect(ics).not.toMatch(/[^\r]\n/)
  })

  it('anchors on next_due_at and gives the event a half-hour window', () => {
    const ics = buildCalendar([row()], 0, NOW)
    expect(ics).toContain('DTSTART:20260810T090000Z')
    expect(ics).toContain('DTEND:20260810T093000Z')
  })

  it('falls back to created_at when the chore has never been completed', () => {
    const ics = buildCalendar([row({ next_due_at: null })], 0, NOW)
    expect(ics).toContain('DTSTART:20260801T000000Z')
  })

  it('carries a stable UID so a re-poll updates rather than duplicates', () => {
    const ics = buildCalendar([row()], 0, NOW)
    expect(ics).toContain('UID:aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee@things')
  })

  it('maps each recurrence unit to its FREQ', () => {
    const of = (unit: ChoreRow['recurrence_unit'], count = 1) =>
      buildCalendar([row({ recurrence_unit: unit, recurrence_count: count })], 0, NOW)

    expect(of('hours')).toContain('RRULE:FREQ=HOURLY;INTERVAL=1')
    expect(of('days', 3)).toContain('RRULE:FREQ=DAILY;INTERVAL=3')
    expect(of('weeks')).toContain('RRULE:FREQ=WEEKLY;INTERVAL=1')
    expect(of('months')).toContain('RRULE:FREQ=MONTHLY;INTERVAL=1')
    expect(of('years')).toContain('RRULE:FREQ=YEARLY;INTERVAL=1')
  })

  it('adds a VALARM only when a reminder is configured', () => {
    expect(buildCalendar([row()], 0, NOW)).not.toContain('BEGIN:VALARM')
    const withAlarm = buildCalendar([row()], 30, NOW)
    expect(withAlarm).toContain('BEGIN:VALARM')
    expect(withAlarm).toContain('TRIGGER:-PT30M')
    expect(withAlarm).toContain('END:VALARM')
  })

  it('skips anything that cannot produce a valid recurring event', () => {
    const ics = buildCalendar(
      [
        row({ id: 'no-repeat', is_recurring: false }),
        row({ id: 'no-unit', recurrence_unit: null }),
        row({ id: 'no-count', recurrence_count: null }),
        row({ id: 'bad-date', next_due_at: 'not a date' }),
      ],
      0,
      NOW,
    )
    expect(ics).not.toContain('BEGIN:VEVENT')
  })

  it('escapes a title that would otherwise break the line', () => {
    const ics = buildCalendar([row({ title: 'Bins, recycling; glass' })], 0, NOW)
    expect(ics).toContain('SUMMARY:Bins\\, recycling\\; glass')
  })

  it('opens and closes exactly one VEVENT per chore', () => {
    const ics = buildCalendar([row({ id: 'a' }), row({ id: 'b' })], 15, NOW)
    expect(ics.match(/BEGIN:VEVENT/g)).toHaveLength(2)
    expect(ics.match(/END:VEVENT/g)).toHaveLength(2)
  })
})

describe('buildCalendar: weekday mode', () => {
  it('emits BYDAY ordered Sun→Sat, not selection order', () => {
    const ics = buildCalendar(
      [row({ recurrence_unit: 'weekdays', recurrence_count: null, recurrence_days: [5, 0, 4] })],
      0,
      NOW,
    )
    expect(ics).toContain('RRULE:FREQ=WEEKLY;BYDAY=SU,TH,FR')
  })

  it('anchors on next_due_at exactly like interval mode', () => {
    // 2026-08-11 is a Tuesday, matching the [2,3] selection — verified
    // separately against the actual Postgres trigger for this same case.
    const ics = buildCalendar(
      [
        row({
          recurrence_unit: 'weekdays',
          recurrence_count: null,
          recurrence_days: [2, 3],
          next_due_at: '2026-08-11T09:00:00.000Z',
        }),
      ],
      0,
      NOW,
    )
    expect(ics).toContain('DTSTART:20260811T090000Z')
    expect(ics).toContain('DTEND:20260811T093000Z')
  })

  it('rounds a never-completed chore forward to a matching weekday', () => {
    // created_at is a Saturday (2026-08-01); Tue/Wed selected, so DTSTART
    // must not be Saturday — it should land on the following Tuesday.
    const ics = buildCalendar(
      [
        row({
          recurrence_unit: 'weekdays',
          recurrence_count: null,
          recurrence_days: [2, 3],
          next_due_at: null,
          created_at: '2026-08-01T00:00:00.000Z',
        }),
      ],
      0,
      NOW,
    )
    expect(ics).toContain('DTSTART:20260804T000000Z')
  })

  it('is skipped entirely with no days chosen, rather than crashing', () => {
    const ics = buildCalendar(
      [row({ recurrence_unit: 'weekdays', recurrence_count: null, recurrence_days: [] })],
      0,
      NOW,
    )
    expect(ics).not.toContain('BEGIN:VEVENT')
  })

  it('describes the chosen days in the event body', () => {
    const ics = buildCalendar(
      [row({ recurrence_unit: 'weekdays', recurrence_count: null, recurrence_days: [0, 4, 5] })],
      0,
      NOW,
    )
    expect(ics).toContain('Repeats on Sundays\\, Thursdays\\, Fridays')
  })
})
