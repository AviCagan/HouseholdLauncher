import { isNative, isStandalone } from './platform'

/**
 * Which page a browser should be on: the phone launcher or the laptop one.
 *
 * Opening the household's link on a laptop lands on the laptop page — that is
 * the version built for a pointer and a wide screen, and nobody should have
 * to know a second address exists. But it is a default, not a decision taken
 * away: the laptop page has a "Phone layout" button, and choosing it is
 * remembered in this browser until the laptop page is chosen again.
 *
 * Never redirected:
 *   - the Android APK (there is no browser to navigate, and no second page in
 *     the native build);
 *   - an installed web app — a Home Screen install on an iPhone or iPad has to
 *     keep opening exactly what was installed, or Web Push stops working;
 *   - anything that doesn't look like a laptop. A phone that is handed the
 *     laptop link keeps the phone page.
 */

const KEY = 'household:layout'

export type Layout = 'phone' | 'desktop'

export interface Device {
  native: boolean
  standalone: boolean
  /** A mouse or trackpad that can hover — not a finger. */
  finePointer: boolean
  width: number
  /** What was chosen in this browser, if anything. */
  chosen: Layout | null
}

/** Wide enough for the sidebar and two columns side by side. */
export const LAPTOP_MIN_WIDTH = 1024

export function shouldUseDesktop(d: Device): boolean {
  if (d.native || d.standalone) return false
  if (d.chosen === 'phone') return false
  return d.finePointer && d.width >= LAPTOP_MIN_WIDTH
}

function readChoice(): Layout | null {
  try {
    const v = localStorage.getItem(KEY)
    return v === 'phone' || v === 'desktop' ? v : null
  } catch {
    return null
  }
}

/** Record a deliberate choice of layout in this browser. */
export function rememberLayout(layout: Layout): void {
  try {
    localStorage.setItem(KEY, layout)
  } catch {
    /* private mode: the default applies next time, which is harmless */
  }
}

export function currentDevice(): Device {
  return {
    native: isNative(),
    standalone: isStandalone(),
    finePointer:
      typeof window !== 'undefined' && !!window.matchMedia?.('(hover: hover) and (pointer: fine)').matches,
    width: typeof window !== 'undefined' ? window.innerWidth : 0,
    chosen: readChoice(),
  }
}

/**
 * Called by the phone page before it renders anything. Returns true when it
 * has started navigating away, in which case the page should not render.
 *
 * `?phone` in the address forces the phone page and remembers it, so there is
 * always a way to reach it from a laptop by typing.
 */
export function redirectToDesktopIfLaptop(): boolean {
  if (typeof window === 'undefined') return false
  const params = new URLSearchParams(window.location.search)
  if (params.has('phone')) {
    rememberLayout('phone')
    return false
  }
  if (!shouldUseDesktop(currentDevice())) return false
  const target = `${import.meta.env.BASE_URL}desktop/${window.location.search}${window.location.hash}`
  window.location.replace(target)
  return true
}

/** The phone page's address, from the laptop one. */
export const phonePageUrl = (): string => `${import.meta.env.BASE_URL}?phone`
