import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * The guard that stops the app dying when you ask for notifications.
 *
 * Worth a test precisely because the failure it prevents cannot be caught at
 * runtime. `PushNotifications.register()` calls `FirebaseMessaging.getInstance()`,
 * which throws when the APK was built with no google-services.json — and
 * Capacitor's bridge rethrows anything a plugin method throws as an uncaught
 * RuntimeException on its own thread. The process is gone before any promise
 * settles, so no try/catch on this side can help and no amount of error
 * handling would have made it survivable. The only defence is not making the
 * call, which is a thing a test can hold in place.
 *
 * Mocked at the module boundary rather than run against a device: the whole
 * assertion is "this plugin was never touched", which is exactly what a spy
 * answers and what an emulator would answer by crashing.
 */

const register = vi.fn()
const checkPermissions = vi.fn()
const requestPermissions = vi.fn()

vi.mock('@capacitor/push-notifications', () => ({
  PushNotifications: {
    register,
    checkPermissions,
    requestPermissions,
    addListener: vi.fn(() => Promise.resolve({ remove: vi.fn() })),
  },
}))
vi.mock('@capacitor/local-notifications', () => ({
  LocalNotifications: { requestPermissions: vi.fn(() => Promise.resolve()) },
}))
vi.mock('./supabase', () => ({ supabase: () => null }))

const isNative = vi.fn(() => true)
vi.mock('./platform', () => ({
  isNative: () => isNative(),
  isIOS: () => false,
  isStandalone: () => false,
  supportsWebPush: () => false,
  webPushBlockedByInstall: () => false,
}))

const fcmConfigured = vi.fn(() => false)
vi.mock('./build', () => ({
  get FCM_CONFIGURED() {
    return fcmConfigured()
  },
}))

async function load() {
  vi.resetModules()
  return import('./notifications')
}

describe('native push with no Firebase credentials', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    isNative.mockReturnValue(true)
    fcmConfigured.mockReturnValue(false)
  })

  it('never reaches the call that would crash the app', async () => {
    const { enablePush } = await load()
    const state = await enablePush('avi')

    expect(state).toBe('needs-fcm')
    expect(register).not.toHaveBeenCalled()
    // Not even the permission prompt: asking someone to allow notifications
    // this build cannot deliver is a dialog with no honest outcome.
    expect(checkPermissions).not.toHaveBeenCalled()
    expect(requestPermissions).not.toHaveBeenCalled()
  })

  it('reports the state before anything is tapped, so the button is never offered', async () => {
    const { pushState } = await load()
    expect(pushState()).toBe('needs-fcm')
  })

  it('leaves the boot-time re-registration alone', async () => {
    // ensurePushRegistered runs on every launch. It bails on any state that
    // is not 'granted', so a build with no credentials must never look
    // granted — otherwise the crash moves from a button tap to app start.
    const { ensurePushRegistered } = await load()
    await ensurePushRegistered('avi')
    expect(register).not.toHaveBeenCalled()
  })

  it('goes through to Firebase once the credentials are there', async () => {
    fcmConfigured.mockReturnValue(true)
    checkPermissions.mockResolvedValue({ receive: 'denied' })

    const { enablePush, pushState } = await load()
    expect(pushState()).toBe('default')

    // Stops at the permission check here, which is the point: the guard is
    // out of the way and the normal flow has taken over.
    await enablePush('avi')
    expect(checkPermissions).toHaveBeenCalled()
  })
})
