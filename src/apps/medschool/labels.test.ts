import { describe, expect, it } from 'vitest'
import { amount, hoursBetween, scorePlan, timeRange } from './labels'

describe('scorePlan', () => {
  it('splits a note into plans A, B and C', () => {
    expect(scorePlan('A: on target, go ahead. B: a little short, widen the list. C: well short, wait a year.')).toEqual([
      { letter: 'A', text: 'on target, go ahead.' },
      { letter: 'B', text: 'a little short, widen the list.' },
      { letter: 'C', text: 'well short, wait a year.' },
    ])
  })

  it('leaves a note without plans alone', () => {
    expect(scorePlan('Send the score the same day.')).toBeNull()
    expect(scorePlan(null)).toBeNull()
  })
})

describe('amount', () => {
  it('says hours and meetings the way people do', () => {
    expect(amount(20.75, 'h')).toBe('20.75 h')
    expect(amount(1, 'meetings')).toBe('1 meeting')
    expect(amount(7, 'meetings')).toBe('7 meetings')
  })
})

describe('hours from times', () => {
  it('works out the hours between a start and an end', () => {
    expect(hoursBetween('07:30', '12:00')).toBe(4.5)
    expect(hoursBetween('09:15', '15:30')).toBe(6.25)
    expect(hoursBetween('07:30', '14:00')).toBe(6.5)
    expect(hoursBetween('13:10', '14:00')).toBe(0.83)
  })

  it('runs past midnight when the end is earlier than the start', () => {
    expect(hoursBetween('22:00', '02:00')).toBe(4)
  })

  it('has nothing to say about a missing or zero-length stretch', () => {
    expect(hoursBetween('', '12:00')).toBeNull()
    expect(hoursBetween('08:00', '08:00')).toBeNull()
    expect(hoursBetween('25:00', '08:00')).toBeNull()
  })

  it('writes the range the way the log notes do', () => {
    expect(timeRange('07:30', '14:00')).toBe('7:30–2:00')
    expect(timeRange('09:15', '12:00')).toBe('9:15–12:00')
    expect(timeRange('00:30', '13:05')).toBe('12:30–1:05')
  })
})
