import { useEffect, useRef } from 'react'
import { useData } from '@/store/useData'
import { useWatchUI } from './store'
import { needsRefresh, refreshShow } from './actions'

/**
 * Act on a deep link into Watched: {tab: 'rate:N', id}, {tab: 'shelf' |
 * 'onair', id}, or just {id}. Shared with the laptop page, which calls it
 * whenever a link arrives rather than on mount.
 */
export function openWatchedLink(link: Record<string, unknown>): void {
  const { setTab, open } = useWatchUI.getState()
  const id = typeof link.id === 'string' ? link.id : null
  const where = typeof link.tab === 'string' ? link.tab : ''
  if (where.startsWith('rate:') && id) {
    const season = Number(where.slice(5)) || 0
    setTab('watched')
    open({ kind: 'rate', showId: id, seasons: season ? [season] : [], includeShow: season === 0 })
  } else if (where === 'shelf' || where === 'onair') {
    setTab(where)
    if (id) open({ kind: 'show', showId: id })
  } else if (id) {
    open({ kind: 'show', showId: id })
  }
}

/**
 * Keep airing shows current: new episodes, new seasons, air dates. A few
 * per visit, one at a time, so a big library never fires a burst at
 * TVmaze's rate limit — and only for shows that can actually have changed.
 */
export function useKeepShowsCurrent(): void {
  const shows = useData((s) => s.watch_shows)
  const refreshed = useRef(false)
  const alive = useRef(true)
  useEffect(() => {
    alive.current = true
    return () => {
      alive.current = false
    }
  }, [])
  useEffect(() => {
    // Once per visit, as soon as there are shows. Not cancelled by the
    // shows changing — each refresh changes them.
    if (refreshed.current || shows.length === 0) return
    refreshed.current = true
    const now = new Date()
    const rank = (s: (typeof shows)[number]) =>
      s.stage === 'watching' ? 0 : s.stage === 'lineup' ? 1 : s.stage === 'shelf' ? 2 : 3
    const stale = shows.filter((s) => needsRefresh(s, now)).sort((a, b) => rank(a) - rank(b)).slice(0, 6)
    void (async () => {
      for (const show of stale) {
        if (!alive.current) return
        await refreshShow(show)
        await new Promise((r) => setTimeout(r, 600))
      }
    })()
  }, [shows])
}
