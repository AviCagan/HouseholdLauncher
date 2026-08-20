import { describe, expect, it, beforeEach } from 'vitest'
import { buildSteps } from './Tour'
import { useUI, TABS } from '@/store/useUI'

/**
 * The tour's copy and its effect on app state, tested without a DOM.
 *
 * Rendering it here would prove nothing: zustand hands server renders the
 * store's *initial* state, so a mounted component sees no profiles and no open
 * tour regardless of what the test set up. The script is a pure function and
 * the state changes are store calls, so both are testable directly.
 */

describe('buildSteps', () => {
  const steps = buildSteps('Avi', 'Jackie', true)

  it('addresses the person signing in', () => {
    expect(steps[0].title).toBe('Hi Avi')
  })

  it('names the other person rather than describing them', () => {
    const body = steps.map((s) => `${s.body} ${s.points?.map((p) => p.text).join(' ') ?? ''}`).join(' ')
    expect(body).toContain('Jackie')
  })

  it('swaps both names round for the other person', () => {
    const hers = buildSteps('Jackie', 'Avi', false)
    expect(hers[0].title).toBe('Hi Jackie')
    expect(hers.map((s) => s.body).join(' ')).toContain('Avi')
  })

  it('never renders an empty name', () => {
    const all = buildSteps('Avi', 'them', false)
      .map((s) => `${s.title} ${s.body}`)
      .join(' ')
    expect(all).not.toContain('undefined')
    expect(all).not.toMatch(/\s{2,}/)
  })

  it('only promises a buzz on hardware that has one', () => {
    const withHaptics = buildSteps('Avi', 'Jackie', true).map((s) => s.body).join(' ')
    const without = buildSteps('Jackie', 'Avi', false).map((s) => s.body).join(' ')
    expect(withHaptics).toContain('buzzes')
    expect(without).not.toContain('buzzes')
  })

  it('teaches all three row gestures, since none of them are visible', () => {
    const points = steps.flatMap((s) => s.points ?? []).map((p) => p.text.toLowerCase())
    expect(points.some((t) => t.includes('right'))).toBe(true)
    expect(points.some((t) => t.includes('left'))).toBe(true)
    expect(points.some((t) => t.includes('hold'))).toBe(true)
  })

  it('visits every tab', () => {
    const visited = new Set(steps.map((s) => s.tab))
    for (const t of TABS) expect(visited.has(t.key)).toBe(true)
  })

  it('walks the tabs forwards, never doubling back', () => {
    const order = steps.map((s) => TABS.findIndex((t) => t.key === s.tab))
    for (let i = 1; i < order.length; i++) {
      expect(order[i]).toBeGreaterThanOrEqual(order[i - 1])
    }
  })
})

describe('tour state', () => {
  beforeEach(() => {
    useUI.setState({ tour: false, tab: 'wishlist', sheet: { kind: 'settings' } })
  })

  it('starts from the first tab, whatever you were looking at', () => {
    useUI.getState().startTour()
    expect(useUI.getState().tour).toBe(true)
    expect(useUI.getState().tab).toBe('todos')
  })

  it('closes any open sheet, so the tour is never behind Settings', () => {
    useUI.getState().startTour()
    expect(useUI.getState().sheet.kind).toBe('none')
  })

  it('ends without touching where you are', () => {
    useUI.getState().startTour()
    useUI.setState({ tab: 'chores' })
    useUI.getState().endTour()
    expect(useUI.getState().tour).toBe(false)
    expect(useUI.getState().tab).toBe('chores')
  })
})
