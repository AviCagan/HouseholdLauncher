import { useSyncExternalStore } from 'react'

/**
 * Whether the window is wide enough for the laptop layout.
 *
 * One query, shared by this hook and by every `lg:` utility in the markup —
 * Tailwind's `lg` is 64rem, so the two can never disagree about which side of
 * the line a window is on. Width alone decides it: an iPad in landscape gets
 * the sidebar too, and should. The phone layout is the one every app was
 * built for and stays exactly as it was below the line.
 */
export const DESKTOP_QUERY = '(min-width: 64rem)'

function media(): MediaQueryList | null {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return null
  return window.matchMedia(DESKTOP_QUERY)
}

function subscribe(onChange: () => void): () => void {
  const m = media()
  if (!m) return () => {}
  m.addEventListener('change', onChange)
  return () => m.removeEventListener('change', onChange)
}

export const isDesktop = (): boolean => media()?.matches ?? false

export function useDesktop(): boolean {
  return useSyncExternalStore(subscribe, isDesktop, () => false)
}
