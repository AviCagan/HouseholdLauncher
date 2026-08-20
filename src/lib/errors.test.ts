import { describe, expect, it } from 'vitest'
import { errorMessage, isTransient, isClockSkew } from './errors'

describe('errorMessage', () => {
  it('reads Supabase-style plain objects', () => {
    // The bug this exists for: these are not Error instances, so the usual
    // instanceof check rendered "[object Object]" on screen.
    expect(errorMessage({ message: 'JWT issued at future' })).toBe('JWT issued at future')
    expect(errorMessage({ error_description: 'bad grant' })).toBe('bad grant')
    expect(errorMessage({ details: 'column missing' })).toBe('column missing')
  })

  it('never returns [object Object]', () => {
    for (const input of [{}, { weird: 1 }, [], null, undefined, 0]) {
      expect(errorMessage(input)).not.toContain('[object Object]')
    }
  })

  it('prefers message over other fields', () => {
    expect(errorMessage({ message: 'real', hint: 'other' })).toBe('real')
  })

  it('handles Error instances and strings', () => {
    expect(errorMessage(new Error('boom'))).toBe('boom')
    expect(errorMessage('plain')).toBe('plain')
  })
})

describe('isClockSkew', () => {
  it('recognises the future-dated token the API rejects', () => {
    expect(isClockSkew({ message: 'JWT issued at future' })).toBe(true)
    expect(isClockSkew({ message: 'Token used before issued' })).toBe(true)
  })

  it('leaves genuine auth failures alone', () => {
    expect(isClockSkew({ message: 'Invalid login credentials' })).toBe(false)
  })
})

describe('isTransient', () => {
  it('retries network blips and clock skew', () => {
    expect(isTransient({ message: 'Failed to fetch' })).toBe(true)
    expect(isTransient({ message: 'JWT issued at future' })).toBe(true)
  })

  it('does not retry a wrong PIN — it never becomes right', () => {
    expect(isTransient({ message: 'Invalid login credentials' })).toBe(false)
  })
})
