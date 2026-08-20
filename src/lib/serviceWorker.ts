import { isNative } from './platform'

/*
  The service worker exists for exactly one reason: Web Push on Jackie's iOS
  home-screen install. Push handlers *are* the service worker there, which is
  why the build uses injectManifest rather than generateSW.

  Inside the Android APK it is not just unnecessary, it is actively harmful,
  and it is what made three consecutive "here's the new APK" round-trips look
  like stale downloads:

    Capacitor serves the app from https://localhost/, so the service worker
    precaches index.html and the hashed JS bundle into Cache Storage. That
    cache lives in the WebView's data directory, which SURVIVES an APK
    update — only an uninstall or "clear storage" removes it. So a new APK
    installs correctly, with completely new files on disk, and then the old
    service worker intercepts the request for "/" and serves the previous
    index.html straight back out of cache, which references the previous
    bundle's filenames, which are also cached. New APK, old app, no error.

    registerType: 'autoUpdate' is supposed to cover this, but it depends on
    the WebView noticing a byte-changed sw.js and then activating and
    reloading — which is unreliable there and, at best, lands one launch
    late. That's indistinguishable from "the build didn't take".

  Android gets its push through FCM and loads its assets from the APK, so it
  needs none of this. Registration is now explicit and web-only, and on native
  we tear down anything a previous build left behind — which is what lets a
  phone already stuck in this state fix itself on next launch instead of
  needing an uninstall.
*/

/** The SW lives at the app's base: "/" in the APK, "/Things/" on Pages. */
const swUrl = `${import.meta.env.BASE_URL}sw.js`

async function purgeNativeServiceWorker(): Promise<void> {
  try {
    const registrations = await navigator.serviceWorker.getRegistrations()
    await Promise.all(registrations.map((r) => r.unregister()))

    // Unregistering stops future interception but leaves the cached responses
    // behind, and those are the actual stale app. Both have to go.
    if ('caches' in window) {
      const keys = await caches.keys()
      await Promise.all(keys.map((k) => caches.delete(k)))
    }

    if (registrations.length > 0) {
      // The page is still being controlled by the worker we just removed, so
      // what's on screen is the old bundle. One reload lands on the real one.
      console.info('[sw] removed a stale service worker from a previous build')
      window.location.reload()
    }
  } catch (err) {
    console.error('[sw] could not clean up', err)
  }
}

export function setupServiceWorker(): void {
  if (!('serviceWorker' in navigator)) return

  if (isNative()) {
    void purgeNativeServiceWorker()
    return
  }

  // The build only emits sw.js for real builds (devOptions.enabled is false),
  // so registering during `npm run dev` just 404s and logs a MIME-type error
  // on every reload. The plugin's own injected script never had this problem
  // because it only ever existed in built output; registering from app code
  // means opting out of dev explicitly.
  if (import.meta.env.DEV) return

  window.addEventListener('load', () => {
    navigator.serviceWorker
      .register(swUrl, { scope: import.meta.env.BASE_URL })
      .catch((err) => console.error('[sw] registration failed', err))
  })
}
