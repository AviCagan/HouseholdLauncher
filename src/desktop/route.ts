import { useLauncher, type Screen } from '@/store/useLauncher'

/**
 * The address bar, on the laptop page.
 *
 * The phone launcher deliberately has no URLs (see useLauncher.ts): it runs in
 * a WebView with no address bar, and history entries there only made the
 * Android back button slower. A browser tab is the opposite case. Back and
 * forward are expected to move between apps, a refresh is expected to land
 * where you were, and a bookmark to Meals should open Meals.
 *
 * So the launcher store stays the source of truth for what is on screen, and
 * this keeps `#/meals` in step with it in both directions. A hash rather than
 * a path because the site is static on GitHub Pages: there is no server to
 * answer `/desktop/meals` with the page.
 */

export function parseHash(hash: string): Screen {
  const path = hash.replace(/^#\/?/, '').split(/[/?]/)[0]?.trim() ?? ''
  if (!path) return { kind: 'home' }
  return { kind: 'app', appId: decodeURIComponent(path) }
}

export function hashFor(screen: Screen): string {
  return screen.kind === 'home' ? '#/' : `#/${encodeURIComponent(screen.appId)}`
}

const sameScreen = (a: Screen, b: Screen): boolean =>
  a.kind === b.kind && (a.kind === 'home' || (b.kind === 'app' && a.appId === b.appId))

let installed = false

/** Start syncing. Idempotent; the page calls it once before the first render. */
export function syncRouteWithHash(): void {
  if (installed || typeof window === 'undefined') return
  installed = true

  const fromHash = parseHash(window.location.hash)
  if (fromHash.kind === 'app') useLauncher.getState().openApp(fromHash.appId)

  useLauncher.subscribe((state, prev) => {
    if (sameScreen(state.screen, prev.screen)) return
    const next = hashFor(state.screen)
    if (window.location.hash !== next) window.location.hash = next
  })

  window.addEventListener('hashchange', () => {
    const wanted = parseHash(window.location.hash)
    const { screen, openApp, goHome } = useLauncher.getState()
    if (sameScreen(wanted, screen)) return
    if (wanted.kind === 'home') goHome()
    else openApp(wanted.appId)
  })
}
