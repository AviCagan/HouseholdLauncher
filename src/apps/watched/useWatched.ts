import { useEffect, useMemo, useState } from 'react'
import { useData } from '@/store/useData'
import type { WatchShow } from '@/data/types'
import { effectivePace, measurePace } from './pace'
import { projectLineup } from './schedule'

/**
 * Everything the screens derive from the four tables, computed once per
 * change rather than per card: the pace, and the projection of the whole
 * lineup, which is the expensive part.
 *
 * "Now" moves when the app comes back to the foreground, so estimates made
 * last night don't still say "today" this morning.
 */
export function useWatched() {
  const shows = useData((s) => s.watch_shows)
  const log = useData((s) => s.watch_seasons)
  const ratings = useData((s) => s.watch_ratings)
  const settings = useData((s) => s.watch_settings)[0]
  const [now, setNow] = useState(() => new Date())

  useEffect(() => {
    const onVisible = () => {
      if (!document.hidden) setNow(new Date())
    }
    document.addEventListener('visibilitychange', onVisible)
    const timer = setInterval(() => setNow(new Date()), 15 * 60 * 1000)
    return () => {
      document.removeEventListener('visibilitychange', onVisible)
      clearInterval(timer)
    }
  }, [])

  const sample = useMemo(() => measurePace(log, shows, now), [log, shows, now])
  const pace = useMemo(() => effectivePace(settings, sample), [settings, sample])
  const projections = useMemo(
    () => projectLineup(shows, log, pace.minutesPerWeek, now),
    [shows, log, pace.minutesPerWeek, now],
  )

  const lineup = useMemo(
    () => shows.filter((s) => s.stage === 'lineup').sort((a, b) => a.lineup_order - b.lineup_order),
    [shows],
  )
  const playing = useMemo(
    () => shows.filter((s) => s.stage === 'watching').sort((a, b) => a.lineup_order - b.lineup_order),
    [shows],
  )

  return { shows, log, ratings, settings, sample, pace, projections, lineup, playing, now }
}

export const byId = (shows: WatchShow[], id: string): WatchShow | undefined => shows.find((s) => s.id === id)
