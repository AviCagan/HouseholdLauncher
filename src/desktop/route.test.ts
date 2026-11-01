import { describe, expect, it } from 'vitest'
import { hashFor, parseHash } from './route'

describe('hash routes', () => {
  it('reads an empty or bare hash as the overview', () => {
    expect(parseHash('')).toEqual({ kind: 'home' })
    expect(parseHash('#')).toEqual({ kind: 'home' })
    expect(parseHash('#/')).toEqual({ kind: 'home' })
  })

  it('reads an app id, ignoring anything after it', () => {
    expect(parseHash('#/meals')).toEqual({ kind: 'app', appId: 'meals' })
    expect(parseHash('#meals')).toEqual({ kind: 'app', appId: 'meals' })
    expect(parseHash('#/meals/plan')).toEqual({ kind: 'app', appId: 'meals' })
    expect(parseHash('#/owe?x=1')).toEqual({ kind: 'app', appId: 'owe' })
  })

  it('round-trips', () => {
    for (const screen of [{ kind: 'home' } as const, { kind: 'app', appId: 'encyclopedia' } as const]) {
      expect(parseHash(hashFor(screen))).toEqual(screen)
    }
  })
})
