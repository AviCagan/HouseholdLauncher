import { describe, expect, it } from 'vitest'
import { parseWhen, parseRecurrence } from '../../supabase/functions/add/when'

/**
 * A deadline set to the wrong day is worse than no deadline, so the bar here
 * is: understand the short closed set people actually say, and return null for
 * everything else rather than guessing.
 *
 * `now` is pinned to a known Sunday so weekday maths is checkable rather than
 * dependent on the day the suite happens to run.
 */
const SUNDAY = new Date('2026-08-16T12:00:00')

const dayOf = (iso: string | null) => (iso ? new Date(iso).getDate() : null)
const weekdayOf = (iso: string | null) => (iso ? new Date(iso).getDay() : null)

describe('parseWhen', () => {
  it('understands today and tomorrow', () => {
    expect(dayOf(parseWhen('today', SUNDAY))).toBe(16)
    expect(dayOf(parseWhen('tomorrow', SUNDAY))).toBe(17)
    expect(dayOf(parseWhen('the day after tomorrow', SUNDAY))).toBe(18)
  })

  it('sets the deadline to the end of the day, not midnight', () => {
    // "by Friday" means the end of Friday; midnight would make it a day early.
    const d = new Date(parseWhen('tomorrow', SUNDAY)!)
    expect(d.getHours()).toBe(23)
    expect(d.getMinutes()).toBe(59)
  })

  it('counts forward in days, weeks and months', () => {
    expect(dayOf(parseWhen('in 3 days', SUNDAY))).toBe(19)
    expect(dayOf(parseWhen('in three days', SUNDAY))).toBe(19)
    expect(dayOf(parseWhen('in a week', SUNDAY))).toBe(23)
    expect(dayOf(parseWhen('next week', SUNDAY))).toBe(23)
    expect(new Date(parseWhen('in 2 months', SUNDAY)!).getMonth()).toBe(9) // October
  })

  it('picks the coming instance of a named weekday', () => {
    expect(weekdayOf(parseWhen('friday', SUNDAY))).toBe(5)
    expect(dayOf(parseWhen('friday', SUNDAY))).toBe(21)
    expect(weekdayOf(parseWhen('on wednesday', SUNDAY))).toBe(3)
    expect(weekdayOf(parseWhen('tue', SUNDAY))).toBe(2)
  })

  it('never resolves a weekday to today, which would already be half gone', () => {
    // Today is Sunday; "sunday" has to mean the next one.
    expect(dayOf(parseWhen('sunday', SUNDAY))).toBe(23)
  })

  it('returns null rather than guessing at anything else', () => {
    for (const s of ['', 'soon', 'whenever', 'later', 'next tuesdayish', 'in a bit']) {
      expect(parseWhen(s, SUNDAY), s).toBeNull()
    }
  })
})

describe('parseRecurrence', () => {
  it('understands the common words', () => {
    expect(parseRecurrence('daily')).toEqual({ count: 1, unit: 'days', days: null })
    expect(parseRecurrence('weekly')).toEqual({ count: 1, unit: 'weeks', days: null })
    expect(parseRecurrence('monthly')).toEqual({ count: 1, unit: 'months', days: null })
    expect(parseRecurrence('biweekly')).toEqual({ count: 2, unit: 'weeks', days: null })
  })

  it('understands an interval', () => {
    expect(parseRecurrence('every 3 days')).toEqual({ count: 3, unit: 'days', days: null })
    expect(parseRecurrence('every two weeks')).toEqual({ count: 2, unit: 'weeks', days: null })
  })

  it('understands a set of weekdays, in the 0-6 convention the DB uses', () => {
    expect(parseRecurrence('mondays and fridays')).toEqual({
      count: null,
      unit: 'weekdays',
      days: [1, 5],
    })
    expect(parseRecurrence('every monday')).toEqual({
      count: null,
      unit: 'weekdays',
      days: [1],
    })
    expect(parseRecurrence('tuesday, wednesday')).toEqual({
      count: null,
      unit: 'weekdays',
      days: [2, 3],
    })
  })

  it('de-duplicates and sorts repeated days', () => {
    expect(parseRecurrence('friday and monday and friday')?.days).toEqual([1, 5])
  })

  it('treats an explicit no as one-off', () => {
    for (const s of ['no', 'nope', 'once', 'one off', 'never']) {
      expect(parseRecurrence(s), s).toBeNull()
    }
  })

  it('returns null rather than inventing a schedule', () => {
    for (const s of ['', 'sometimes', 'a lot', 'every so often']) {
      expect(parseRecurrence(s), s).toBeNull()
    }
  })

  it('never produces a shape the recurrence_complete constraint would reject', () => {
    // The DB requires: weekdays mode has days and no count; every other mode
    // has a count and no days.
    for (const s of ['daily', 'every 3 days', 'mondays and fridays', 'monthly']) {
      const r = parseRecurrence(s)!
      if (r.unit === 'weekdays') {
        expect(r.count, s).toBeNull()
        expect(r.days!.length, s).toBeGreaterThan(0)
      } else {
        expect(r.count, s).toBeGreaterThan(0)
        expect(r.days, s).toBeNull()
      }
    }
  })
})
