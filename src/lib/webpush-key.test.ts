import { beforeEach, describe, expect, it, vi } from 'vitest'
import { VAPID_PUBLIC_KEY } from './env'

/**
 * Two things that were each, on their own, enough to make an iPhone silently
 * unreachable.
 *
 * The first is that the key was missing at all. Web Push cannot work without a
 * VAPID public key in the bundle, and this repository is not the one Things was
 * deployed from — secrets do not follow a repo, nobody set it here, and the
 * build went out with an empty string. Everything downstream behaved as though
 * the phone were at fault. So the key is committed and asserted rather than
 * hoped for.
 *
 * The second only appears the moment a key changes: a push subscription is
 * permanently bound to the key it was created with, and reusing one across a
 * rotation produces a registration that looks healthy from every angle and
 * cannot receive anything.
 */

describe('the VAPID public key that ships in the bundle', () => {
  it('is present, so a build cannot go out unable to register anyone', () => {
    expect(VAPID_PUBLIC_KEY).not.toBe('')
  })

  it('is a well-formed uncompressed P-256 point', () => {
    // Not a formality: an almost-right key is accepted by subscribe() and
    // fails later at the push service, which is exactly the class of failure
    // this file exists to stop.
    const bytes = Uint8Array.from(
      atob(VAPID_PUBLIC_KEY.replace(/-/g, '+').replace(/_/g, '/')),
      (c) => c.charCodeAt(0),
    )
    expect(bytes).toHaveLength(65)
    expect(bytes[0]).toBe(0x04)
  })
})

const subscribe = vi.fn()
const getSubscription = vi.fn()
const unsubscribe = vi.fn(() => Promise.resolve(true))
const upsert = vi.fn(() => Promise.resolve({ error: null }))

vi.mock('@capacitor/push-notifications', () => ({ PushNotifications: {} }))
vi.mock('@capacitor/local-notifications', () => ({
  LocalNotifications: { requestPermissions: vi.fn(() => Promise.resolve()) },
}))
vi.mock('./supabase', () => ({ supabase: () => ({ from: () => ({ upsert }) }) }))
vi.mock('./build', () => ({ FCM_CONFIGURED: false }))
vi.mock('./platform', () => ({
  isNative: () => false,
  isIOS: () => true,
  isStandalone: () => true,
  supportsWebPush: () => true,
  webPushBlockedByInstall: () => false,
}))

/** A subscription reporting the key it was created with, as the browser does. */
function subscriptionWith(key: Uint8Array | null) {
  return {
    options: { applicationServerKey: key ? key.buffer : null },
    unsubscribe,
    toJSON: () => ({ endpoint: 'https://web.push.apple.com/x', keys: { p256dh: 'p', auth: 'a' } }),
  }
}

function currentKeyBytes(): Uint8Array {
  return Uint8Array.from(
    atob(VAPID_PUBLIC_KEY.replace(/-/g, '+').replace(/_/g, '/')),
    (c) => c.charCodeAt(0),
  )
}

describe('subscribing when a VAPID key has changed underneath us', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.stubGlobal('Notification', {
      permission: 'granted',
      requestPermission: () => Promise.resolve('granted'),
    })
    vi.stubGlobal('navigator', {
      userAgent: 'test',
      serviceWorker: { ready: Promise.resolve({ pushManager: { getSubscription, subscribe } }) },
    })
    subscribe.mockResolvedValue(subscriptionWith(currentKeyBytes()))
  })

  it('keeps a subscription that already matches the current key', async () => {
    getSubscription.mockResolvedValue(subscriptionWith(currentKeyBytes()))

    const { enablePush } = await import('./notifications')
    expect(await enablePush('jackie')).toBe('granted')
    expect(unsubscribe).not.toHaveBeenCalled()
    expect(subscribe).not.toHaveBeenCalled()
  })

  it('tears down and replaces one bound to a different key', async () => {
    // The failure this prevents: reused, saved without error, reported as a
    // registered device, and undeliverable forever.
    getSubscription.mockResolvedValue(subscriptionWith(new Uint8Array(65).fill(9)))

    const { enablePush } = await import('./notifications')
    expect(await enablePush('jackie')).toBe('granted')
    expect(unsubscribe).toHaveBeenCalled()
    expect(subscribe).toHaveBeenCalled()
  })

  it('subscribes from scratch when there is nothing yet', async () => {
    getSubscription.mockResolvedValue(null)

    const { enablePush } = await import('./notifications')
    expect(await enablePush('jackie')).toBe('granted')
    expect(unsubscribe).not.toHaveBeenCalled()
    expect(subscribe).toHaveBeenCalled()
  })

  it('leaves a subscription alone when the browser will not say which key it used', async () => {
    // Safari has historically left this null. Re-subscribing on that alone
    // would throw away a working registration on every launch.
    getSubscription.mockResolvedValue(subscriptionWith(null))

    const { enablePush } = await import('./notifications')
    expect(await enablePush('jackie')).toBe('granted')
    expect(unsubscribe).not.toHaveBeenCalled()
    expect(subscribe).not.toHaveBeenCalled()
  })
})
