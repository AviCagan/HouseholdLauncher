import { describe, expect, it } from 'vitest'
import { deriveRecurrenceUI, describeRecurrence, describeWeekdays } from './time'
import type { Weekday } from '@/data/types'

describe('describeWeekdays', () => {
  it('names a single day', () => {
    expect(describeWeekdays([2])).toBe('Tue')
  })

  it('joins two days with &', () => {
    expect(describeWeekdays([2, 3])).toBe('Tue & Wed')
  })

  it('joins three or more with commas and a trailing &', () => {
    expect(describeWeekdays([0, 4, 5])).toBe('Sun, Thu & Fri')
  })

  it('orders Sunday through Saturday regardless of pick order', () => {
    // The user picks Friday then Sunday then Thursday — the label should
    // still read in week order, not selection order.
    expect(describeWeekdays([5, 0, 4] as Weekday[])).toBe('Sun, Thu & Fri')
  })
})

describe('describeRecurrence: weekday mode', () => {
  it('describes the chosen days, ignoring count', () => {
    expect(describeRecurrence(null, 'weekdays', [2, 3])).toBe('Tue & Wed')
  })

  it('is empty with no days chosen, rather than throwing', () => {
    expect(describeRecurrence(null, 'weekdays', [])).toBe('')
    expect(describeRecurrence(null, 'weekdays', null)).toBe('')
  })
})

describe('describeRecurrence: interval mode', () => {
  it('names a known preset', () => {
    expect(describeRecurrence(1, 'weeks', null)).toBe('Weekly')
    expect(describeRecurrence(3, 'months', null)).toBe('Every 3 months')
  })

  it('falls back to a generic phrase off-preset', () => {
    expect(describeRecurrence(5, 'days', null)).toBe('Every 5 days')
    expect(describeRecurrence(1, 'hours', null)).toBe('Every hour')
  })

  it('is empty without a count or a unit', () => {
    expect(describeRecurrence(null, 'days', null)).toBe('')
    expect(describeRecurrence(2, null, null)).toBe('')
  })
})

describe('deriveRecurrenceUI', () => {
  it('defaults to Quick mode for a non-recurring chore', () => {
    const ui = deriveRecurrenceUI({
      is_recurring: false,
      recurrence_count: null,
      recurrence_unit: null,
      recurrence_days: null,
    })
    expect(ui.mode).toBe('presets')
    expect(ui.days.size).toBe(0)
  })

  it('lands on Quick mode with the matching preset selected', () => {
    const ui = deriveRecurrenceUI({
      is_recurring: true,
      recurrence_count: 1,
      recurrence_unit: 'weeks',
      recurrence_days: null,
    })
    expect(ui.mode).toBe('presets')
    expect(ui.preset.label).toBe('Weekly')
  })

  it('falls to Every mode for an interval with no matching preset', () => {
    const ui = deriveRecurrenceUI({
      is_recurring: true,
      recurrence_count: 5,
      recurrence_unit: 'days',
      recurrence_days: null,
    })
    expect(ui.mode).toBe('every')
    expect(ui.custom).toEqual({ count: '5', unit: 'days' })
  })

  it('lands on Days mode with the stored weekdays preselected', () => {
    const ui = deriveRecurrenceUI({
      is_recurring: true,
      recurrence_count: null,
      recurrence_unit: 'weekdays',
      recurrence_days: [2, 3],
    })
    expect(ui.mode).toBe('days')
    expect([...ui.days].sort()).toEqual([2, 3])
  })

  it('round-trips through describeRecurrence for every mode', () => {
    // The point of this helper is that re-opening the editor shows the same
    // thing the row already displays — check that holds for all three modes.
    const cases = [
      { is_recurring: true, recurrence_count: 3, recurrence_unit: 'months' as const, recurrence_days: null },
      { is_recurring: true, recurrence_count: 5, recurrence_unit: 'days' as const, recurrence_days: null },
      { is_recurring: true, recurrence_count: null, recurrence_unit: 'weekdays' as const, recurrence_days: [0, 4, 5] as Weekday[] },
    ]
    for (const chore of cases) {
      const before = describeRecurrence(chore.recurrence_count, chore.recurrence_unit, chore.recurrence_days)
      const ui = deriveRecurrenceUI(chore)
      const after =
        ui.mode === 'days'
          ? describeRecurrence(null, 'weekdays', [...ui.days])
          : ui.mode === 'every'
            ? describeRecurrence(parseInt(ui.custom.count), ui.custom.unit)
            : describeRecurrence(ui.preset.count, ui.preset.unit)
      expect(after).toBe(before)
    }
  })
})
