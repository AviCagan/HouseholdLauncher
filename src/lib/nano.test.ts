import { describe, expect, it } from 'vitest'
import { HEARTBEAT_STALE_MS, nanoOnline, pickedUp } from './nano'
import { describeChange, relativeTime } from '@/launcher/settings/nanoText'
import { isLow } from '@/apps/things/features/shopping/stock'

const now = new Date('2026-11-26T12:00:00.000Z').getTime()
const iso = (msAgo: number) => new Date(now - msAgo).toISOString()

describe('the Nano button', () => {
  it('calls her away once the heartbeat is two minutes old', () => {
    expect(nanoOnline(undefined, now)).toBe(false)
    expect(nanoOnline({ singleton: true, last_seen_at: null, version: null, updated_at: iso(0) }, now)).toBe(false)
    expect(nanoOnline({ singleton: true, last_seen_at: iso(30_000), version: null, updated_at: iso(0) }, now)).toBe(true)
    expect(nanoOnline({ singleton: true, last_seen_at: iso(HEARTBEAT_STALE_MS + 1), version: null, updated_at: iso(0) }, now)).toBe(false)
  })

  it('counts any write to the request as picked up', () => {
    const fresh = { status: 'waiting' as const, answer: null, created_at: iso(5000), updated_at: iso(5000) }
    expect(pickedUp(fresh)).toBe(false)
    expect(pickedUp({ ...fresh, status: 'working' })).toBe(true)
    expect(pickedUp({ ...fresh, answer: 'Working on it' })).toBe(true)
    expect(pickedUp({ ...fresh, updated_at: iso(1000) })).toBe(true)
  })
})

describe("Nano's change list", () => {
  it('says what changed in words', () => {
    expect(describeChange({ op: 'insert', table_name: 'shopping_items', before: null, after: { title: 'Milk' } })).toBe(
      'Added shopping item “Milk”',
    )
    expect(describeChange({ op: 'delete', table_name: 'dishes', before: { name: 'Soup' }, after: null })).toBe(
      'Deleted dish “Soup”',
    )
    expect(describeChange({ op: 'update', table_name: 'ms_tasks', before: {}, after: {} })).toBe('Changed Med School record')
  })

  it('says when, roughly', () => {
    expect(relativeTime(iso(10_000), now)).toBe('just now')
    expect(relativeTime(iso(5 * 60_000), now)).toBe('5 minutes ago')
    expect(relativeTime(iso(3 * 3_600_000), now)).toBe('3 hours ago')
    expect(relativeTime(iso(30 * 3_600_000), now)).toBe('yesterday')
  })
})

describe('stock counts', () => {
  it('are low at or below their level, and never without one', () => {
    expect(isLow({ on_hand: 1, low_at: 1 })).toBe(true)
    expect(isLow({ on_hand: 2, low_at: 1 })).toBe(false)
    expect(isLow({ on_hand: 0, low_at: null })).toBe(false)
  })
})

describe('the authenticator setup key', () => {
  it('takes the key typed, or the secret out of an otpauth link', async () => {
    const { setupKeyFrom } = await import('@/launcher/settings/NanoSettings')
    expect(setupKeyFrom('jbsw y3dp ehpk 3pxp')).toBe('JBSW Y3DP EHPK 3PXP')
    expect(setupKeyFrom('otpauth://totp/Nano:Avi?secret=jbswy3dpehpk3pxp&issuer=Nano')).toBe('JBSWY3DPEHPK3PXP')
    expect(setupKeyFrom('otpauth://totp/Nano?issuer=Nano')).toBe('')
  })
})
