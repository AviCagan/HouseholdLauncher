import { useEffect, useRef } from 'react'
import { useLauncher } from '@/store/useLauncher'

/**
 * Act on a deep link whenever one arrives — not only when the app mounts.
 *
 * On the phone an app is always opened fresh from the home grid or the
 * notification centre, so reading the link once on mount covers it. On the
 * laptop the app is usually already open when a notification is clicked or a
 * search result is picked, and a mount-only read would miss every one of
 * those. This watches the launcher's pending link for as long as the app is
 * on screen and consumes each one as it lands.
 */
export function useDeepLink(appId: string, handle: (link: Record<string, unknown>) => void): void {
  const pending = useLauncher((s) => s.pendingDeepLink)
  // Only the app on screen may take it. Switching apps fades the old one out
  // while the new one loads, and for those few frames both are mounted — an
  // unguarded hook in the outgoing app consumed the link meant for the
  // incoming one, so "Define…" from the palette landed on an empty page.
  const mine = useLauncher((s) => s.screen.kind === 'app' && s.screen.appId === appId)
  const ref = useRef(handle)
  ref.current = handle

  useEffect(() => {
    if (!pending || !mine) return
    const link = useLauncher.getState().consumeDeepLink()
    if (link) ref.current(link)
  }, [pending, mine])
}
