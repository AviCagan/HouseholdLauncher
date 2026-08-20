import { describe, expect, it } from 'vitest'
import {
  deadlineOptions,
  daysUntil,
  isOverdue,
  formatDeadline,
  toDateInput,
  fromDateInput,
  endOfDayIso,
} from './deadline'

// A Sunday, so weekday maths is checkable rather than dependent on the run day.
const SUNDAY = new Date('2026-08-16T12:00:00')

describe('endOfDayIso', () => {
  it('lands on the end of the day, not midnight', () => {
    // "by Friday" means any time up to Friday night. Midnight would make every
    // deadline a day early.
    const d = new Date(endOfDayIso(SUNDAY))
    expect(d.getHours()).toBe(23)
    expect(d.getMinutes()).toBe(59)
    expect(d.getDate()).toBe(16)
  })
})

describe('deadlineOptions', () => {
  it('offers today, tomorrow, the weekend and next week', () => {
    expect(deadlineOptions(SUNDAY).map((o) => o.key)).toEqual([
      'today',
      'tomorrow',
      'weekend',
      'week',
    ])
  })

  it('drops the weekend option when it would duplicate another button', () => {
    // Friday: "weekend" is tomorrow, so offering both is noise.
    const friday = new Date('2026-08-21T12:00:00')
    expect(deadlineOptions(friday).map((o) => o.key)).not.toContain('weekend')
    // Saturday is the weekend already.
    const saturday = new Date('2026-08-22T12:00:00')
    expect(deadlineOptions(saturday).map((o) => o.key)).not.toContain('weekend')
  })

  it('points every option at a real future end-of-day', () => {
    for (const o of deadlineOptions(SUNDAY)) {
      expect(o.at, o.key).toBeTruthy()
      expect(new Date(o.at!).getTime(), o.key).toBeGreaterThan(SUNDAY.getTime())
    }
  })
})

describe('daysUntil / isOverdue', () => {
  it('counts whole days regardless of time of day', () => {
    expect(daysUntil(endOfDayIso(SUNDAY), SUNDAY)).toBe(0)
    expect(daysUntil('2026-08-17T00:01:00', SUNDAY)).toBe(1)
    expect(daysUntil('2026-08-15T23:00:00', SUNDAY)).toBe(-1)
  })

  it('is overdue only once the moment has actually passed', () => {
    // Still today, so not late yet even though it is "today".
    expect(isOverdue(endOfDayIso(SUNDAY), SUNDAY)).toBe(false)
    expect(isOverdue('2026-08-16T09:00:00', SUNDAY)).toBe(true)
  })
})

describe('formatDeadline', () => {
  it('uses words for the near days', () => {
    expect(formatDeadline(endOfDayIso(SUNDAY), SUNDAY)).toBe('Today')
    expect(formatDeadline('2026-08-17T23:59:00', SUNDAY)).toBe('Tomorrow')
    expect(formatDeadline('2026-08-15T23:59:00', SUNDAY)).toBe('Yesterday')
  })

  it('says how late something is', () => {
    expect(formatDeadline('2026-08-13T23:59:00', SUNDAY)).toBe('3 days late')
  })

  it('uses a weekday inside the week and a date beyond it', () => {
    expect(formatDeadline('2026-08-21T23:59:00', SUNDAY)).toBe('Fri')
    expect(formatDeadline('2026-09-30T23:59:00', SUNDAY)).toMatch(/Sep/)
  })
})

describe('date input round-trip', () => {
  it('survives a round-trip without drifting a day', () => {
    // The bug this guards: new Date("2026-08-16") is parsed as UTC, which is
    // the previous evening in any western timezone — so a deadline picked as
    // the 16th would display as the 15th.
    const iso = fromDateInput('2026-08-16')!
    expect(toDateInput(iso)).toBe('2026-08-16')
    expect(new Date(iso).getDate()).toBe(16)
  })

  it('produces an end-of-day time from a date-only input', () => {
    const d = new Date(fromDateInput('2026-12-25')!)
    expect(d.getHours()).toBe(23)
    expect(d.getMonth()).toBe(11)
  })

  it('handles empty and malformed values', () => {
    expect(toDateInput(null)).toBe('')
    expect(toDateInput('nonsense')).toBe('')
    expect(fromDateInput('')).toBeNull()
    expect(fromDateInput('25/12/2026')).toBeNull()
  })
})
