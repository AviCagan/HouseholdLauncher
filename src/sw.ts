/// <reference lib="webworker" />
import { precacheAndRoute, cleanupOutdatedCaches } from 'workbox-precaching'

declare const self: ServiceWorkerGlobalScope

/**
 * Custom service worker.
 *
 * This is the reason the build uses `injectManifest` instead of the default
 * `generateSW`: a generated worker cannot carry `push` / `notificationclick`
 * handlers, and those handlers *are* Web Push. Choosing the other strategy
 * would mean discovering at the end that notifications can't be added without
 * reworking the build.
 */

cleanupOutdatedCaches()
// Shell assets only. API calls (Supabase, OSRM, Photon) are never cached —
// a stale grocery list is worse than a spinner.
precacheAndRoute(self.__WB_MANIFEST)

self.addEventListener('install', () => {
  void self.skipWaiting()
})

self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim())
})

interface PushPayload {
  title?: string
  body?: string
  tab?: string
  itemId?: string
  tag?: string
}

self.addEventListener('push', (event) => {
  let payload: PushPayload = {}
  try {
    payload = (event.data?.json() as PushPayload) ?? {}
  } catch {
    payload = { body: event.data?.text() }
  }

  const title = payload.title ?? 'Things'
  event.waitUntil(
    self.registration.showNotification(title, {
      body: payload.body ?? '',
      icon: 'icons/icon-192.png',
      badge: 'icons/icon-192.png',
      // Re-using a tag collapses repeats instead of stacking them.
      tag: payload.tag ?? 'things',
      data: { tab: payload.tab, itemId: payload.itemId },
    }),
  )
})

self.addEventListener('notificationclick', (event) => {
  event.notification.close()
  const data = (event.notification.data ?? {}) as { tab?: string; itemId?: string }

  event.waitUntil(
    (async () => {
      const all = await self.clients.matchAll({
        type: 'window',
        includeUncontrolled: true,
      })
      // Focus an existing window rather than opening a duplicate.
      for (const client of all) {
        if ('focus' in client) {
          await client.focus()
          client.postMessage({ type: 'notification-open', ...data })
          return
        }
      }
      const url = new URL(self.registration.scope)
      if (data.tab) url.searchParams.set('tab', data.tab)
      await self.clients.openWindow(url.href)
    })(),
  )
})
