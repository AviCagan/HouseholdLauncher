import { useEffect, useRef, useState } from 'react'
import '@fontsource/vt323/latin-400.css'
import './watched.css'
import { Icon } from '@/components/primitives/Icon'
import { useLauncher } from '@/store/useLauncher'
import { useData } from '@/store/useData'
import { fire } from '@/lib/haptics'
import { useDesktop } from '@/lib/useDesktop'
import { WatchedWordmark } from './Logo'
import { useWatchUI, type WatchTab } from './store'
import { NoSignal } from './ui'
import { OnAirTab } from './OnAirTab'
import { ShelfTab } from './ShelfTab'
import { WatchedTab } from './WatchedTab'
import { SearchSheet } from './SearchSheet'
import { ShowSheet } from './ShowSheet'
import { RateSheet } from './RateSheet'
import { DatesSheet, FinishSheet, LogSheet, ManualSheet, PaceSheet, PosterSheet, SlotSheet } from './sheets'
import { needsRefresh, refreshShow } from './actions'

/**
 * Watched (working title).
 *
 * The app is a television: the screen is where everything happens, the
 * three channel buttons along the bottom are the tabs, and changing channel
 * gives you a flash of static. See watched.css for the set itself.
 */

const CHANNELS: { id: WatchTab; n: number; label: string }[] = [
  { id: 'onair', n: 1, label: 'ON AIR' },
  { id: 'shelf', n: 2, label: 'TO BE WATCHED' },
  { id: 'watched', n: 3, label: 'WATCHED' },
]

export function WatchedApp() {
  const tab = useWatchUI((s) => s.tab)
  const setTab = useWatchUI((s) => s.setTab)
  const stack = useWatchUI((s) => s.stack)
  const open = useWatchUI((s) => s.open)
  const goHome = useLauncher((s) => s.goHome)
  const consumeDeepLink = useLauncher((s) => s.consumeDeepLink)
  const shows = useData((s) => s.watch_shows)
  // The server hasn't had 021_watched.sql yet: say so, rather than look empty
  // and fail on the first add.
  const notSetUp = useData((s) => s.missingTables.some((t) => t.startsWith('watch_')))
  const [staticKey, setStaticKey] = useState(0)
  const desktop = useDesktop()

  // A notification tap: the shelf, the lineup, or straight to a rating.
  useEffect(() => {
    const link = consumeDeepLink()
    if (!link) return
    const id = typeof link.id === 'string' ? link.id : null
    const where = typeof link.tab === 'string' ? link.tab : ''
    if (where.startsWith('rate:') && id) {
      const season = Number(where.slice(5)) || 0
      setTab('watched')
      open({ kind: 'rate', showId: id, seasons: season ? [season] : [], includeShow: season === 0 })
    } else if (where === 'shelf' || where === 'onair') {
      setTab(where)
      if (id) open({ kind: 'show', showId: id })
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [consumeDeepLink])

  // Leaving the app closes its sheets, so coming back lands on the screen.
  useEffect(() => () => useWatchUI.getState().closeAll(), [])

  /*
    Keep airing shows current: new episodes, new seasons, air dates. A few
    per visit, one at a time, so a big library never fires a burst at
    TVmaze's rate limit — and only for shows that can actually have changed.
  */
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

  function changeChannel(next: WatchTab) {
    if (next === tab) return
    fire('snap')
    setStaticKey((k) => k + 1)
    setTab(next)
  }

  const top = stack[stack.length - 1]

  return (
    <div className="tv flex h-full flex-col">
      <header className="tv-top flex shrink-0 items-center gap-2 px-3 pb-2 pt-[max(var(--safe-top),0.6rem)] lg:mx-auto lg:w-full lg:max-w-[1040px]">
        {/* The launcher's sidebar is the way back on a laptop. Not hidden
            with a utility: .tv-btn sets its own display, unlayered. */}
        {!desktop && (
          <button
            onClick={() => {
              fire('tap')
              goHome()
            }}
            aria-label="Back to the launcher"
            className="tv-btn grid h-10 w-10 shrink-0 place-items-center"
          >
            <Icon name="back" size={19} strokeWidth={2.4} />
          </button>
        )}
        <div className="flex min-w-0 flex-1 justify-center">
          <WatchedWordmark size={40} />
        </div>
        <button
          onClick={() => {
            fire('tap')
            open({ kind: 'search', preset: null })
          }}
          aria-label="Find a show"
          className="tv-btn tv-btn--yellow grid h-10 w-10 shrink-0 place-items-center"
        >
          <Icon name="plus" size={20} strokeWidth={2.6} />
        </button>
      </header>

      <div className="min-h-0 flex-1 px-3 pb-3 pt-1 lg:mx-auto lg:w-full lg:max-w-[1040px]">
        <div className="tv-screen tv-poweron h-full">
          <div key={tab} className="scroll-y relative z-0 h-full">
            {notSetUp ? (
              <NoSignal
                title="NOT SET UP YET"
                hint="Watched needs its tables on the server first. Run supabase/021_watched.sql in the Supabase SQL editor, then come back."
              />
            ) : (
              <>
                {tab === 'onair' && <OnAirTab />}
                {tab === 'shelf' && <ShelfTab />}
                {tab === 'watched' && <WatchedTab />}
              </>
            )}
          </div>
          {staticKey > 0 && <div key={staticKey} className="tv-static" aria-hidden />}
        </div>
      </div>

      <nav className="tv-panel safe-bottom shrink-0 px-3 pt-2.5" aria-label="Channels">
        <div className="flex items-center gap-1.5 pb-2.5 lg:mx-auto lg:max-w-[1040px]">
          <span className="tv-grille h-10 w-3.5 shrink-0" aria-hidden />
          {CHANNELS.map((c) => (
            <button
              key={c.id}
              onClick={() => changeChannel(c.id)}
              className="tv-btn tv-channel"
              data-on={tab === c.id}
              aria-current={tab === c.id ? 'page' : undefined}
            >
              <span className="tv-osd text-[12px]" style={{ color: tab === c.id ? 'var(--tv-red)' : 'var(--tv-faint)' }}>
                CH {c.n}
              </span>
              <span
                className="tv-osd w-full truncate text-[15px]"
                style={{ color: tab === c.id ? 'var(--tv-phosphor)' : 'var(--tv-dim)', letterSpacing: '0.01em' }}
              >
                {c.label}
              </span>
            </button>
          ))}
          <span className="flex shrink-0 flex-col items-center gap-1.5" aria-hidden>
            <span className="tv-led" data-on="true" />
            <span className="tv-grille h-6 w-3.5" />
          </span>
        </div>
      </nav>

      {top?.kind === 'search' && <SearchSheet key={stack.length} preset={top.preset} />}
      {top?.kind === 'show' && <ShowSheet key={`${stack.length}:${top.showId}`} showId={top.showId} />}
      {top?.kind === 'rate' && (
        <RateSheet
          key={`${stack.length}:${top.showId}`}
          showId={top.showId}
          seasons={top.seasons}
          includeShow={top.includeShow}
          outcome={top.outcome}
          backfill={top.backfill}
          undo={top.undo}
        />
      )}
      {top?.kind === 'pace' && <PaceSheet key={stack.length} />}
      {top?.kind === 'slot' && <SlotSheet key={stack.length} showId={top.showId} />}
      {top?.kind === 'posters' && <PosterSheet key={stack.length} showId={top.showId} />}
      {top?.kind === 'manual' && <ManualSheet key={stack.length} preset={top.preset} />}
      {top?.kind === 'finish' && <FinishSheet key={`${stack.length}:${top.showId}`} showId={top.showId} />}
      {top?.kind === 'dates' && <DatesSheet key={`${stack.length}:${top.showId}`} showId={top.showId} />}
      {top?.kind === 'log' && <LogSheet key={`${stack.length}:${top.showId}`} showId={top.showId} from={top.from} />}
    </div>
  )
}
