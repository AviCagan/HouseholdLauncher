import { describe, expect, it } from 'vitest'
import { amount, scorePlan } from './labels'

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
