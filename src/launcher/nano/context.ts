import { useEffect } from 'react'
import { create } from 'zustand'

/**
 * What's open, for the Nano button: the screen and the item, so a request
 * like "add two more of these" means something to her.
 *
 * Apps report it with the two hooks below; the launcher adds the app. Both
 * clear themselves when the screen or sheet that set them goes away, so the
 * context is never stale.
 */
export interface NanoItem {
  table: string
  id: string
  title: string | null
}

interface NanoContextState {
  screen: string | null
  item: NanoItem | null
}

export const useNanoContext = create<NanoContextState>(() => ({ screen: null, item: null }))

/** The screen (tab) an app is showing. */
export function useNanoScreen(screen: string | null) {
  useEffect(() => {
    useNanoContext.setState({ screen })
    return () => {
      if (useNanoContext.getState().screen === screen) useNanoContext.setState({ screen: null })
    }
  }, [screen])
}

/** The item open in a sheet or detail view, while it's open. */
export function useNanoItem(item: NanoItem | null) {
  const key = item ? `${item.table}:${item.id}:${item.title ?? ''}` : null
  useEffect(() => {
    if (!item) return
    useNanoContext.setState({ item })
    return () => {
      if (useNanoContext.getState().item?.id === item.id) useNanoContext.setState({ item: null })
    }
    // `key` captures everything about the item that matters.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key])
}
