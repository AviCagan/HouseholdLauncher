import { describe, expect, it } from 'vitest'
import { googleEventUrl, icsStamp, nextOccurrence, rruleFor } from './calendar'
import type { Chore } from '@/data/types'

const chore = (patch: Partial<Chore> = {}): Chore => ({
  id: 'c1',
  title: 'Take the bins out',
  urgency: 0,
  claimed_by: null,
  created_by: null,
  updated_by: null,
  sort_order: 0,
  created_at: '2026-08-01T00:00:00.000Z',
  updated_at: '2026-08-01T00:00:00.000Z',
  notes: null,
  is_recurring: true,
  recurrence_count: 1,
  recurrence_unit: 'weeks',
  recurrence_days: null,
  last_completed_at: null,
  last_completed_by: null,
  next_due_at: null,
  cooldown_notified_at: null,
  is_done: false,
  ...patch,
})

describe('rruleFor', () => {
  it('maps every unit the app can store', () => {
    expect(rruleFor(1, 'hours')).toBe('RRULE:FREQ=HOURLY;INTERVAL=1')
    expect(rruleFor(2, 'days')).toBe('RRULE:FREQ=DAILY;INTERVAL=2')
    expect(rruleFor(1, 'weeks')).toBe('RRULE:FREQ=WEEKLY;INTERVAL=1')
    expect(rruleFor(3, 'months')).toBe('RRULE:FREQ=MONTHLY;INTERVAL=3')
    expect(rruleFor(1, 'years')).toBe('RRULE:FREQ=YEARLY;INTERVAL=1')
  })

  it('is null when there is nothing to repeat', () => {
    expect(rruleFor(null, 'days')).toBeNull()
    expect(rruleFor(2, null)).toBeNull()
  })

  it('never emits INTERVAL=0, which every calendar rejects', () => {
    expect(rruleFor(0.4, 'days')).toBe('RRULE:FREQ=DAILY;INTERVAL=1')
  })

  it('builds BYDAY for weekday mode, ordered Sun→Sat', () => {
    expect(rruleFor(null, 'weekdays', [2, 3])).toBe('RRULE:FREQ=WEEKLY;BYDAY=TU,WE')
    expect(rruleFor(null, 'weekdays', [5, 0, 4])).toBe('RRULE:FREQ=WEEKLY;BYDAY=SU,TH,FR')
  })

  it('is null for weekday mode with no days chosen', () => {
    expect(rruleFor(null, 'weekdays', [])).toBeNull()
    expect(rruleFor(null, 'weekdays', null)).toBeNull()
  })
})

describe('icsStamp', () => {
  it('strips separators and milliseconds', () => {
    expect(icsStamp(new Date('2026-08-09T14:05:00.000Z'))).toBe('20260809T140500Z')
  })
})

describe('nextOccurrence', () => {
  it('uses next_due_at when the chore is resting', () => {
    const at = '2026-09-01T09:00:00.000Z'
    expect(nextOccurrence(chore({ next_due_at: at })).toISOString()).toBe(at)
  })

  it('falls back to now, because a never-completed chore is due now', () => {
    const now = Date.parse('2026-08-09T12:00:00.000Z')
    expect(nextOccurrence(chore({ next_due_at: null }), now).getTime()).toBe(now)
  })
})

describe('googleEventUrl', () => {
  it('carries the title, window and recurrence', () => {
    const now = Date.parse('2026-08-09T12:00:00.000Z')
    const url = googleEventUrl(chore({ recurrence_count: 2, recurrence_unit: 'days' }), now)!
    const params = new URL(url).searchParams

    expect(params.get('action')).toBe('TEMPLATE')
    expect(params.get('text')).toBe('Take the bins out')
    expect(params.get('dates')).toBe('20260809T120000Z/20260809T123000Z')
    expect(params.get('recur')).toBe('RRULE:FREQ=DAILY;INTERVAL=2')
  })

  it('is null for a chore that does not repeat', () => {
    expect(googleEventUrl(chore({ is_recurring: false }))).toBeNull()
    expect(googleEventUrl(chore({ recurrence_unit: null }))).toBeNull()
  })

  it('is null for weekday mode with no days chosen', () => {
    expect(
      googleEventUrl(chore({ recurrence_unit: 'weekdays', recurrence_count: null, recurrence_days: [] })),
    ).toBeNull()
  })

  it('carries BYDAY for weekday mode', () => {
    const now = Date.parse('2026-08-09T12:00:00.000Z') // a Sunday
    const url = googleEventUrl(
      chore({
        recurrence_unit: 'weekdays',
        recurrence_count: null,
        recurrence_days: [2, 3],
        next_due_at: '2026-08-11T09:00:00.000Z',
      }),
      now,
    )!
    const params = new URL(url).searchParams
    expect(params.get('recur')).toBe('RRULE:FREQ=WEEKLY;BYDAY=TU,WE')
    expect(params.get('dates')).toBe('20260811T090000Z/20260811T093000Z')
  })

  it('rounds a never-completed weekday chore forward to a matching day', () => {
    // 2026-08-06 is a Thursday; Tue/Wed selected means the nearest match is
    // the following Tuesday, 2026-08-11 — the same date the DB trigger
    // computes for an identical case (verified separately against Postgres).
    const now = Date.parse('2026-08-06T12:00:00.000Z')
    const url = googleEventUrl(
      chore({
        recurrence_unit: 'weekdays',
        recurrence_count: null,
        recurrence_days: [2, 3],
        next_due_at: null,
      }),
      now,
    )!
    expect(new URL(url).searchParams.get('dates')).toBe('20260811T120000Z/20260811T123000Z')
  })
})
