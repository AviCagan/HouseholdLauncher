import type { NavApp } from '@/data/types'
import type { LatLng } from './geocode'

/**
 * Hand-off to a maps app.
 *
 * The important asymmetry: Google Maps and Apple Maps accept a whole multi-stop
 * route in one URL, and **Waze does not** — its URL scheme takes exactly one
 * destination, with no waypoints parameter and no workaround. So a Waze user's
 * trip is inherently leg-by-leg, which is why `legByLeg` is a first-class flow
 * rather than a fallback.
 */

const coord = (p: LatLng) => `${p.lat},${p.lng}`

/** Google caps the URL API at 9 waypoints. */
export const GOOGLE_MAX_WAYPOINTS = 9

/**
 * `api=1` deliberately does NOT reorder waypoints — which is what we want,
 * since the solver already found the optimal order.
 */
export function googleMultiStop(home: LatLng, stops: LatLng[]): string {
  const waypoints = stops.slice(0, GOOGLE_MAX_WAYPOINTS).map(coord).join('|')
  const params = new URLSearchParams({
    api: '1',
    origin: coord(home),
    destination: coord(home),
    travelmode: 'driving',
  })
  if (waypoints) params.set('waypoints', waypoints)
  return `https://www.google.com/maps/dir/?${params.toString()}`
}

/**
 * Apple's documented multi-stop syntax chains destinations with `+to:`.
 * Support has regressed between iOS versions and sometimes only the first
 * destination is honoured, so this is never the only option offered.
 */
export function appleMultiStop(home: LatLng, stops: LatLng[]): string {
  const daddr = [...stops.map(coord), coord(home)].join('+to:')
  return `https://maps.apple.com/?saddr=${coord(home)}&daddr=${daddr}&dirflg=d`
}

/** Single-destination links — the only thing Waze can do. */
export function singleStopUrl(app: NavApp, to: LatLng): string {
  switch (app) {
    case 'waze':
      return `https://waze.com/ul?ll=${to.lat}%2C${to.lng}&navigate=yes`
    case 'apple':
      return `https://maps.apple.com/?daddr=${coord(to)}&dirflg=d`
    case 'google':
    default:
      return `https://www.google.com/maps/dir/?api=1&destination=${coord(to)}&travelmode=driving`
  }
}

export interface NavOption {
  app: NavApp
  label: string
  url: string
  /** True when this link carries the entire route in one go. */
  multiStop: boolean
  note?: string
}

/**
 * Every option, for every platform — no user-agent sniffing. The profile's
 * preferred app is simply listed first.
 */
export function navOptions(
  home: LatLng,
  stops: LatLng[],
  preferred: NavApp,
): NavOption[] {
  const options: NavOption[] = [
    {
      app: 'google',
      label: 'Google Maps',
      url: googleMultiStop(home, stops),
      multiStop: true,
      note:
        stops.length > GOOGLE_MAX_WAYPOINTS
          ? `Only the first ${GOOGLE_MAX_WAYPOINTS} stops fit in one link`
          : undefined,
    },
    {
      app: 'waze',
      label: 'Waze',
      url: stops.length > 0 ? singleStopUrl('waze', stops[0]) : '',
      multiStop: false,
      note: 'One stop at a time — Waze has no multi-stop links',
    },
    {
      app: 'apple',
      label: 'Apple Maps',
      url: appleMultiStop(home, stops),
      multiStop: true,
      note: 'Multi-stop can be unreliable on some iOS versions',
    },
  ]

  return options.sort((a, b) =>
    a.app === preferred ? -1 : b.app === preferred ? 1 : 0,
  )
}

/**
 * Open externally. `window.open` routes to the system handler on Capacitor;
 * @capacitor/browser is deliberately NOT used, since an in-app tab is exactly
 * wrong for a maps hand-off.
 */
export function openExternal(url: string): void {
  window.open(url, '_blank', 'noopener,noreferrer')
}

export function copyToClipboard(text: string): Promise<void> {
  if (navigator.clipboard?.writeText) return navigator.clipboard.writeText(text)
  return Promise.reject(new Error('Clipboard unavailable'))
}
