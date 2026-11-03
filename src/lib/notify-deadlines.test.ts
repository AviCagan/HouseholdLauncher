import { describe, expect, it } from 'vitest'
import { addCalendarDays, deadlineReminder, showCalendarDay } from '../../supabase/functions/notify/classify'

/** Med School's hard-deadline reminders, as the notify function decides them. */
describe('deadline reminders', () => {
  const task = (due_on: string | null, early: string | null = null, day: string | null = null) => ({
    due_on,
    reminded_early_for: early,
    reminded_day_for: day,
  })

  it('reminds three days before and on the day, and not otherwise', () => {
    expect(deadlineReminder(task('2027-02-01'), '2027-01-29')).toBe('early')
    expect(deadlineReminder(task('2027-02-01'), '2027-02-01')).toBe('day')
    expect(deadlineReminder(task('2027-02-01'), '2027-01-30')).toBeNull()
    expect(deadlineReminder(task('2027-02-01'), '2027-02-02')).toBeNull()
    expect(deadlineReminder(task(null), '2027-02-01')).toBeNull()
  })

  it('sends each once per date, and again when the date moves', () => {
    expect(deadlineReminder(task('2027-02-01', '2027-02-01'), '2027-01-29')).toBeNull()
    expect(deadlineReminder(task('2027-02-01', '2027-02-01', '2027-02-01'), '2027-02-01')).toBeNull()
    // Reminded for the old date; the deadline has moved since.
    expect(deadlineReminder(task('2027-05-13', '2027-05-07'), '2027-05-10')).toBe('early')
  })

  it('counts days on the calendar, across month ends and clock changes', () => {
    expect(addCalendarDays('2027-01-29', 3)).toBe('2027-02-01')
    expect(addCalendarDays('2027-03-12', 3)).toBe('2027-03-15')
    expect(addCalendarDays('2026-10-30', 3)).toBe('2026-11-02')
    expect(addCalendarDays('2027-12-30', 3)).toBe('2028-01-02')
    expect(showCalendarDay('2027-05-07')).toBe('Fri, May 7')
  })
})
