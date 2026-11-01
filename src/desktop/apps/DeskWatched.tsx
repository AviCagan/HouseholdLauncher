import { useEffect, useRef, useState } from 'react'
import '@fontsource/vt323/latin-400.css'
import '@/apps/watched/watched.css'
import { Icon } from '@/components/primitives/Icon'
import { useData } from '@/store/useData'
import { WatchedWordmark } from '@/apps/watched/Logo'
import { useWatchUI, type WatchTab } from '@/apps/watched/store'
import { NoSignal } from '@/apps/watched/ui'
import { OnAirTab } from '@/apps/watched/OnAirTab'
import { ShelfTab } from '@/apps/watched/ShelfTab'
import { WatchedTab } from '@/apps/watched/WatchedTab'
import { WatchedSheets } from '@/apps/watched/WatchedApp'
import { openWatchedLink, useKeepShowsCurrent } from '@/apps/watched/deepLink'
import { useKeys } from '../keys'
import { Kbd } from '../ui'
import { usePersisted } from '../persisted'
import { useDeepLink } from '../useDeepLink'

/**
 * Watched on a laptop: one cabinet, three screens.
 *
 * On the phone the set has one screen and three channel buttons, and you
 * flick between what's on, what's waiting and how it all rated. A laptop is
 * wide enough to be a wall of monitors, so by default all three channels play
 * side by side — the lineup next to the shelves it's drawn from, the ratings
 * next to both. "One screen" puts it back to a single set with the channel
 * buttons, for a narrow window or a closer look.
 *
 * The channels themselves are the phone's own, unchanged; only the cabinet
 * around them is new.
 */

const CHANNELS: { id: WatchTab; n: number; label: string }[] = [
  { id: 'onair', n: 1, label: 'ON AIR' },
  { id: 'shelf', n: 2, label: 'TO BE WATCHED' },
  { id: 'watched', n: 3, label: 'WATCHED' },
]

/** Below this the three screens are too narrow to read; fall back to one. */
const SPLIT_MIN_WIDTH = 1080

export function DeskWatched() {
  const tab = useWatchUI((s) => s.tab)
  const setTab = useWatchUI((s) => s.setTab)
  const open = useWatchUI((s) => s.open)
  const notSetUp = useData((s) => s.missingTables.some((t) => t.startsWith('watch_')))
  const [split, setSplit] = usePersisted('desk:watched:split', true)
  const [staticKey, setStaticKey] = useState(0)
  const rootRef = useRef<HTMLDivElement>(null)
  const width = useWidth(rootRef)
  const wall = split && width >= SPLIT_MIN_WIDTH

  useKeepShowsCurrent()
  useDeepLink('watched', openWatchedLink)
  // Leaving the app closes its sheets, so coming back lands on the screens.
  useEffect(() => () => useWatchUI.getState().closeAll(), [])

  function changeChannel(next: WatchTab) {
    if (next === tab) return
    if (!wall) setStaticKey((k) => k + 1)
    setTab(next)
  }

  useKeys([
    ...CHANNELS.map((c) => ({ keys: String(c.n), run: () => changeChannel(c.id), label: `Channel ${c.n}: ${c.label.toLowerCase()}`, group: 'Watched' })),
    { keys: 'a', run: () => open({ kind: 'search', preset: null }), label: 'Find a show to add', group: 'Watched' },
    { keys: 'p', run: () => open({ kind: 'pace' }), label: 'How fast we watch', group: 'Watched' },
    { keys: 'v', run: () => setSplit((s) => !s), label: 'Three screens, or one', group: 'Watched' },
  ])

  const screen = (id: WatchTab) =>
    notSetUp ? (
      <NoSignal title="NOT SET UP YET" hint="Watched needs its tables on the server first. Run supabase/021_watched.sql in the Supabase SQL editor, then come back." />
    ) : id === 'onair' ? (
      <OnAirTab />
    ) : id === 'shelf' ? (
      <ShelfTab />
    ) : (
      <WatchedTab />
    )

  return (
    <div ref={rootRef} className="tv flex h-full flex-col">
      <header className="tv-top flex shrink-0 items-center gap-3 px-5 pb-3 pt-4">
        <WatchedWordmark size={42} />

        {!wall && (
          <div className="ml-4 flex items-center gap-1.5" aria-label="Channels">
            {CHANNELS.map((c) => (
              <button key={c.id} onClick={() => changeChannel(c.id)} className="tv-btn tv-channel !min-w-[150px]" data-on={tab === c.id} aria-current={tab === c.id ? 'page' : undefined}>
                <span className="tv-osd text-[12px]" style={{ color: tab === c.id ? 'var(--tv-red)' : 'var(--tv-faint)' }}>
                  CH {c.n}
                </span>
                <span className="tv-osd w-full truncate text-[15px]" style={{ color: tab === c.id ? 'var(--tv-phosphor)' : 'var(--tv-dim)' }}>
                  {c.label}
                </span>
              </button>
            ))}
          </div>
        )}

        <div className="ml-auto flex items-center gap-2">
          {width >= SPLIT_MIN_WIDTH && (
            <button onClick={() => setSplit((s) => !s)} className="tv-btn tv-btn--ghost flex h-10 items-center gap-2 px-3" title="Three screens, or one (V)">
              <span className="tv-osd text-[15px]">{split ? 'ONE SCREEN' : 'THREE SCREENS'}</span>
            </button>
          )}
          <button onClick={() => open({ kind: 'pace' })} className="tv-btn flex h-10 items-center gap-2 px-3" title="How fast we watch (P)">
            <Icon name="clock" size={16} />
            <span className="tv-osd text-[15px]">PACE</span>
          </button>
          <button onClick={() => open({ kind: 'search', preset: null })} className="tv-btn tv-btn--yellow flex h-10 items-center gap-2 px-3.5" title="Find a show (A)">
            <Icon name="plus" size={17} strokeWidth={2.6} />
            <span className="tv-osd text-[16px]">ADD A SHOW</span>
            <Kbd combo="a" className="opacity-70" />
          </button>
        </div>
      </header>

      {wall ? (
        <div className="desk-screens grid min-h-0 flex-1 grid-cols-3 gap-4 px-5 pb-5">
          {CHANNELS.map((c) => (
            <section key={c.id} className="flex min-h-0 flex-col" aria-label={c.label}>
              <button onClick={() => setTab(c.id)} className="flex items-baseline gap-2 px-2 pb-2 text-left">
                <span className="tv-osd text-[13px]" style={{ color: 'var(--tv-red)' }}>
                  CH {c.n}
                </span>
                <span className="tv-osd text-[17px]" style={{ color: tab === c.id ? 'var(--tv-phosphor)' : 'var(--tv-dim)' }}>
                  {c.label}
                </span>
              </button>
              <div className="tv-screen tv-poweron min-h-0 flex-1">
                <div className="scroll-y relative z-0 h-full">{screen(c.id)}</div>
              </div>
            </section>
          ))}
        </div>
      ) : (
        <div className="min-h-0 flex-1 px-5 pb-5">
          <div className="tv-screen tv-poweron mx-auto h-full max-w-[880px]">
            <div key={tab} className="scroll-y relative z-0 h-full">
              {screen(tab)}
            </div>
            {staticKey > 0 && <div key={staticKey} className="tv-static" aria-hidden />}
          </div>
        </div>
      )}

      <WatchedSheets />
    </div>
  )
}

/** The element's own width, tracked, so the layout answers to the pane rather than the window. */
function useWidth(ref: React.RefObject<HTMLElement | null>): number {
  const [width, setWidth] = useState(() => window.innerWidth)
  useEffect(() => {
    const el = ref.current
    if (!el) return
    const ro = new ResizeObserver(([entry]) => setWidth(entry.contentRect.width))
    ro.observe(el)
    return () => ro.disconnect()
  }, [ref])
  return width
}
