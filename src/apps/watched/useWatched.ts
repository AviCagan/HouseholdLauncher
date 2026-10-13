import { useEffect, useMemo, useState } from 'react'
import { useData } from '@/store/useData'
import type { WatchShow } from '@/data/types'
import { effectivePace, measurePace } from './pace'
import { HORIZON_DAYS, projectLineup } from './schedule'
import { ratingPace, seasonRuns, speedFactors } from './insights'

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
  const views = useData((s) => s.watch_views)
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

  // Every episode logged moves this, so the dates follow how they watch now.
  const sample = useMemo(() => measurePace(log, shows, views, now), [log, shows, views, now])
  const pace = useMemo(() => effectivePace(settings, sample), [settings, sample])
  // How long each season took against how they rated it, and so how much
  // faster a show they're rating highly is likely to go.
  const runs = useMemo(() => seasonRuns(shows, log, ratings), [shows, log, ratings])
  const pattern = useMemo(() => ratingPace(runs), [runs])
  const speed = useMemo(() => speedFactors(shows, ratings, pattern), [shows, ratings, pattern])
  const projections = useMemo(
    () => projectLineup(shows, log, pace.minutesPerWeek, now, HORIZON_DAYS, speed),
    [shows, log, pace.minutesPerWeek, now, speed],
  )

  const lineup = useMemo(
    () => shows.filter((s) => s.stage === 'lineup').sort((a, b) => a.lineup_order - b.lineup_order),
    [shows],
  )
  const playing = useMemo(
    () => shows.filter((s) => s.stage === 'watching').sort((a, b) => a.lineup_order - b.lineup_order),
    [shows],
  )

  return { shows, log, views, ratings, settings, sample, runs, pattern, speed, pace, projections, lineup, playing, now }
}

export const byId = (shows: WatchShow[], id: string): WatchShow | undefined => shows.find((s) => s.id === id)
