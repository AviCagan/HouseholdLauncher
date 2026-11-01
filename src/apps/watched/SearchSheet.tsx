import { useEffect, useMemo, useRef, useState } from 'react'
import { motion } from 'motion/react'
import { toast } from 'sonner'
import { Sheet } from '@/components/primitives/Sheet'
import { fire } from '@/lib/haptics'
import { useData } from '@/store/useData'
import type { WatchShow } from '@/data/types'
import { addShow, type Destination } from './actions'
import { fetchShowDetail, searchShows, type SearchHit } from './tvmaze'
import { loadComingSoon, peekComingSoon, type Upcoming } from './comingSoon'
import { OURS_JACK, shelfName, useMe, usePeople, useWatchUI } from './store'
import { Chip, Poster } from './ui'
import { formatDay, yearsLabel } from './model'

/**
 * Finding a show and putting it somewhere, in as few taps as possible:
 * type, tap the right result, tap where it goes. Results come as you type;
 * the picture, seasons and runtimes come with the show.
 */

interface Pickable {
  tvmazeId: number
  title: string
  poster: string | null
  sub: string
}

const fromHit = (h: SearchHit): Pickable => ({
  tvmazeId: h.tvmazeId,
  title: h.title,
  poster: h.poster,
  sub: [yearsLabel({ premiered: h.premiered, ended: h.ended, status: h.status }), h.network].filter(Boolean).join(' · '),
})

const fromUpcoming = (u: Upcoming, now: Date): Pickable => ({
  tvmazeId: u.tvmazeId,
  title: u.title,
  poster: u.poster,
  sub: `${u.isNew ? 'Premieres' : `Season ${u.season}`} ${formatDay(new Date(`${u.airdate}T12:00:00`), now)}${u.network ? ` · ${u.network}` : ''}`,
})

function statusChip(status: string | null) {
  if (status === 'Running') return <Chip color="var(--tv-red)">AIRING</Chip>
  if (status === 'In Development') return <Chip color="var(--tv-cyan)">COMING</Chip>
  if (status === 'To Be Determined') return <Chip>TBD</Chip>
  if (status === 'Ended') return <Chip>ENDED</Chip>
  return null
}

export function SearchSheet({ preset }: { preset: Destination | null }) {
  const close = useWatchUI((s) => s.close)
  const replace = useWatchUI((s) => s.replace)
  const open = useWatchUI((s) => s.open)
  const library = useData((s) => s.watch_shows)
  const [query, setQuery] = useState('')
  const [hits, setHits] = useState<SearchHit[]>([])
  const [state, setState] = useState<'idle' | 'loading' | 'error'>('idle')
  const [picked, setPicked] = useState<Pickable | null>(null)
  const now = useMemo(() => new Date(), [])

  const q = query.trim()
  useEffect(() => {
    if (q.length < 2) {
      setHits([])
      setState('idle')
      return
    }
    const ctrl = new AbortController()
    setState('loading')
    const timer = setTimeout(() => {
      searchShows(q, ctrl.signal)
        .then((r) => {
          setHits(r)
          setState('idle')
        })
        .catch((err) => {
          if ((err as { name?: string })?.name === 'AbortError') return
          setState('error')
        })
    }, 280)
    return () => {
      clearTimeout(timer)
      ctrl.abort()
    }
  }, [q])

  const inLibrary = (id: number) => library.find((s) => s.tvmaze_id === id)

  return (
    <Sheet
      open
      onClose={close}
      title={<span className="tv-osd tv-yellow text-[22px]">{presetTitle(preset)}</span>}
      maxHeight="92vh"
      height="92vh"
    >
      {picked ? (
        <Placement
          item={picked}
          preset={preset}
          existing={inLibrary(picked.tvmazeId) ?? null}
          onBack={() => setPicked(null)}
          onDone={(result) => {
            if (result.kind === 'stay') setPicked(null)
            else if (result.kind === 'close') close()
            else replace(result.sheet)
          }}
          onOpenExisting={(show) => replace({ kind: 'show', showId: show.id })}
        />
      ) : (
        <div className="flex flex-col gap-3 pb-4">
          <div className="relative">
            <input
              autoFocus
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search for a show…"
              aria-label="Search for a show"
              enterKeyHint="search"
              autoCapitalize="off"
              autoCorrect="off"
              spellCheck={false}
              className="tv-input text-[17px]"
            />
            {state === 'loading' && (
              <span className="tv-osd tv-green absolute right-3 top-1/2 -translate-y-1/2 text-[15px]">TUNING…</span>
            )}
          </div>

          {state === 'error' && (
            <p className="tv-osd tv-red text-[16px]">CAN'T REACH THE GUIDE — CHECK THE CONNECTION</p>
          )}

          {q.length >= 2 && state === 'idle' && hits.length === 0 && (
            <p className="tv-osd text-[16px]" style={{ color: 'var(--tv-dim)' }}>
              NOTHING ON THAT CHANNEL. TRY ANOTHER SPELLING.
            </p>
          )}

          {hits.length > 0 && (
            <div className="flex flex-col gap-2">
              {hits.map((h) => {
                const have = inLibrary(h.tvmazeId)
                return (
                  <motion.button
                    key={h.tvmazeId}
                    initial={{ opacity: 0, y: 6 }}
                    animate={{ opacity: 1, y: 0 }}
                    onClick={() => {
                      fire('tap')
                      setPicked(fromHit(h))
                    }}
                    className="tv-card flex items-center gap-3 p-2 text-left"
                  >
                    <Poster url={h.poster} title={h.title} className="h-[72px] w-[48px] shrink-0" />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-[15px] font-bold">{h.title}</span>
                      <span className="block truncate text-[12px]" style={{ color: 'var(--tv-dim)' }}>
                        {fromHit(h).sub}
                      </span>
                      <span className="mt-1 flex flex-wrap gap-1">
                        {statusChip(h.status)}
                        {h.averageRuntime ? <Chip>{h.averageRuntime}M</Chip> : null}
                        {have && <Chip color="var(--tv-osd)">ADDED</Chip>}
                      </span>
                    </span>
                  </motion.button>
                )
              })}
            </div>
          )}

          {q.length < 2 && (
            <>
              {preset?.kind === 'lineup' && <FromShelves />}
              <ComingSoon now={now} onPick={(u) => setPicked(fromUpcoming(u, now))} />
            </>
          )}

          <button
            onClick={() => {
              fire('tap')
              open({ kind: 'manual', preset })
            }}
            className="tv-osd mt-2 text-center text-[15px]"
            style={{ color: 'var(--tv-dim)' }}
          >
            CAN'T FIND IT? TYPE IT IN YOURSELF
          </button>
          <p className="text-center text-[10.5px]" style={{ color: 'var(--tv-faint)' }}>
            Show info and pictures from TVmaze (CC BY-SA)
          </p>
        </div>
      )}
    </Sheet>
  )
}

function presetTitle(preset: Destination | null): string {
  if (!preset) return 'FIND A SHOW'
  if (preset.kind === 'shelf') return 'ADD TO SHELF'
  if (preset.kind === 'lineup') return 'SLOT A SHOW IN'
  if (preset.kind === 'watched') return 'ADD A PAST SHOW'
  return 'START WATCHING'
}

type PlacementResult =
  | { kind: 'stay' }
  | { kind: 'close' }
  | { kind: 'sheet'; sheet: Parameters<ReturnType<typeof useWatchUI.getState>['replace']>[0] }

/** The second tap: where does it go? */
function Placement({
  item,
  preset,
  existing,
  onBack,
  onDone,
  onOpenExisting,
}: {
  item: Pickable
  preset: Destination | null
  existing: WatchShow | null
  onBack: () => void
  onDone: (result: PlacementResult) => void
  onOpenExisting: (show: WatchShow) => void
}) {
  const people = usePeople()
  const me = useMe()
  const setTab = useWatchUI((s) => s.setTab)
  const setShelf = useWatchUI((s) => s.setShelf)
  const [busy, setBusy] = useState<string | null>(null)
  const alive = useRef(true)
  // Set in the effect, not only at creation: StrictMode mounts twice, and a
  // flag cleared by the first unmount would otherwise stay cleared.
  useEffect(() => {
    alive.current = true
    return () => {
      alive.current = false
    }
  }, [])

  async function place(dest: Destination, key: string) {
    if (busy) return
    setBusy(key)
    try {
      const detail = await fetchShowDetail(item.tvmazeId)
      if (!alive.current) return
      const result = addShow({ ...detail }, dest, me)
      if (result.status === 'exists') {
        toast(`${result.show.title} is already here`)
        onOpenExisting(result.show)
        return
      }
      const show = result.show
      if (dest.kind === 'shelf') {
        toast.success(`${show.title} → ${shelfName(dest.owner, people, me)}`)
        setShelf(dest.owner)
        onDone({ kind: 'stay' })
      } else if (dest.kind === 'watching') {
        toast.success(`Now playing: ${show.title}`)
        setTab('onair')
        onDone({ kind: 'close' })
      } else if (dest.kind === 'lineup') {
        toast.success(`${show.title} is in the lineup`)
        setTab('onair')
        onDone({ kind: 'close' })
      } else {
        onDone({ kind: 'sheet', sheet: { kind: 'rate', showId: show.id, seasons: [], includeShow: true, backfill: true } })
      }
    } catch (err) {
      console.error('[watched] add', err)
      fire('error')
      toast.error("Couldn't reach TVmaze — try again")
    } finally {
      if (alive.current) setBusy(null)
    }
  }

  const ownerOrder = [
    ...people.filter((p) => p.id === me),
    null,
    ...people.filter((p) => p.id !== me),
  ] as (typeof people[number] | null)[]

  const shelfPreset = preset?.kind === 'shelf' ? preset.owner : undefined

  return (
    <div className="flex flex-col gap-4 pb-6">
      <button onClick={onBack} className="tv-osd self-start text-[16px]" style={{ color: 'var(--tv-dim)' }}>
        ◂ BACK TO RESULTS
      </button>

      <div className="flex items-center gap-3">
        <Poster url={item.poster} title={item.title} className="h-[108px] w-[72px] shrink-0" />
        <div className="min-w-0">
          <p className="tv-glow text-[19px] font-bold leading-tight">{item.title}</p>
          <p className="mt-0.5 text-[12.5px]" style={{ color: 'var(--tv-dim)' }}>
            {item.sub}
          </p>
          {busy && <p className="tv-osd tv-green mt-2 text-[17px]">TUNING IN…</p>}
        </div>
      </div>

      {existing ? (
        <div className="tv-card flex flex-col gap-2 p-3">
          <p className="tv-osd tv-amber text-[18px]">ALREADY ON THE SET</p>
          <p className="text-[13px]" style={{ color: 'var(--tv-dim)' }}>
            {existing.stage === 'shelf'
              ? `It's on ${shelfName(existing.shelf_owner, people, me).toLowerCase()}.`
              : existing.stage === 'watching'
                ? "You're watching it."
                : existing.stage === 'lineup'
                  ? "It's in the lineup."
                  : existing.stage === 'watched'
                    ? "You've watched it."
                    : 'You dropped it.'}
          </p>
          <button onClick={() => onOpenExisting(existing)} className="tv-btn tv-btn--yellow tv-osd py-2.5 text-[17px]">
            OPEN IT
          </button>
        </div>
      ) : (
        <>
          <div>
            <p className="tv-osd px-1 pb-2 text-[15px]" style={{ color: 'var(--tv-faint)' }}>
              PUT IT ON A SHELF
            </p>
            <div className="flex gap-2">
              {ownerOrder.map((p) => {
                const owner = p ? p.id : null
                const key = `shelf:${owner ?? 'ours'}`
                const highlighted = shelfPreset !== undefined && shelfPreset === owner
                return (
                  <button
                    key={key}
                    disabled={!!busy}
                    onClick={() => place({ kind: 'shelf', owner }, key)}
                    className={`tv-btn flex flex-1 flex-col items-center gap-1.5 px-1 py-2.5 ${highlighted ? 'tv-btn--cream' : ''}`}
                  >
                    <span className="tv-jack" data-on={busy === key} style={{ ['--jack' as string]: p ? p.jack : OURS_JACK, width: 30, height: 30 }} />
                    <span className="tv-osd max-w-full truncate text-[15px]">
                      {p ? (p.id === me ? 'MINE' : p.name.toUpperCase()) : 'OURS'}
                    </span>
                  </button>
                )
              })}
            </div>
          </div>

          <div className="grid grid-cols-2 gap-2">
            <DestButton
              label="▶ WATCH NOW"
              hint="Start it today"
              busy={busy === 'watching'}
              disabled={!!busy}
              highlighted={preset?.kind === 'watching'}
              onClick={() => place({ kind: 'watching' }, 'watching')}
            />
            <DestButton
              label="⏭ PLAY NEXT"
              hint="Front of the lineup"
              busy={busy === 'front'}
              disabled={!!busy}
              highlighted={false}
              onClick={() => place({ kind: 'lineup', at: 'front' }, 'front')}
            />
            <DestButton
              label="+ LINEUP"
              hint="End of the lineup"
              busy={busy === 'end'}
              disabled={!!busy}
              highlighted={preset?.kind === 'lineup'}
              onClick={() => place({ kind: 'lineup', at: 'end' }, 'end')}
            />
            <DestButton
              label="✓ WATCHED IT"
              hint="Add it and rate it"
              busy={busy === 'watched'}
              disabled={!!busy}
              highlighted={preset?.kind === 'watched'}
              onClick={() => place({ kind: 'watched', throughSeason: null }, 'watched')}
            />
          </div>
        </>
      )}
    </div>
  )
}

function DestButton({
  label,
  hint,
  busy,
  disabled,
  highlighted,
  onClick,
}: {
  label: string
  hint: string
  busy: boolean
  disabled: boolean
  highlighted: boolean
  onClick: () => void
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className={`tv-btn flex flex-col items-start gap-0.5 px-3 py-2.5 text-left ${highlighted ? 'tv-btn--yellow' : ''}`}
    >
      <span className="tv-osd text-[18px]">{busy ? 'TUNING…' : label}</span>
      <span className="text-[11.5px] opacity-75">{hint}</span>
    </button>
  )
}

/** Shows already on a shelf, for slotting straight into the lineup. */
function FromShelves() {
  const shows = useData((s) => s.watch_shows)
  const people = usePeople()
  const me = useMe()
  const replace = useWatchUI((s) => s.replace)
  const onShelves = shows.filter((s) => s.stage === 'shelf').sort((a, b) => a.shelf_order - b.shelf_order)
  if (onShelves.length === 0) return null
  return (
    <div>
      <p className="tv-osd tv-amber px-1 pb-2 text-[17px]">FROM YOUR SHELVES</p>
      <div className="scroll-x -mx-5 flex gap-2 px-5 pb-1">
        {onShelves.map((show) => (
          <button
            key={show.id}
            onClick={() => {
              fire('tap')
              replace({ kind: 'slot', showId: show.id })
            }}
            className="w-[92px] shrink-0 text-left"
          >
            <Poster url={show.poster_url} title={show.title} className="aspect-[2/3] w-full" />
            <span className="mt-1 block truncate text-[12px] font-semibold">{show.title}</span>
            <span className="tv-osd block truncate text-[12px]" style={{ color: 'var(--tv-faint)' }}>
              {shelfName(show.shelf_owner, people, me).toUpperCase()}
            </span>
          </button>
        ))}
      </div>
    </div>
  )
}

/** Premieres in the next week. Only fetched when asked for; cached after. */
function ComingSoon({ now, onPick }: { now: Date; onPick: (u: Upcoming) => void }) {
  const [items, setItems] = useState<Upcoming[] | null>(() => peekComingSoon(7, now))
  const [loading, setLoading] = useState(false)

  async function scan() {
    setLoading(true)
    fire('tap')
    try {
      await loadComingSoon(7, { now, onProgress: setItems })
    } catch {
      toast.error("Couldn't reach TVmaze")
    } finally {
      setLoading(false)
    }
  }

  return (
    <div>
      <p className="tv-osd tv-amber px-1 pb-2 text-[17px]">📡 COMING SOON</p>
      {items === null ? (
        <button onClick={() => void scan()} disabled={loading} className="tv-btn tv-osd w-full py-3 text-[17px]">
          {loading ? 'SCANNING THE NEXT 7 DAYS…' : "SCAN WHAT'S PREMIERING THIS WEEK"}
        </button>
      ) : items.length === 0 && !loading ? (
        <p className="tv-osd text-[15px]" style={{ color: 'var(--tv-dim)' }}>
          NO PREMIERES IN THE NEXT 7 DAYS
        </p>
      ) : (
        <div className="flex flex-col gap-2">
          {loading && <p className="tv-osd tv-green text-[15px]">SCANNING…</p>}
          {items.map((u) => (
            <button
              key={u.tvmazeId}
              onClick={() => {
                fire('tap')
                onPick(u)
              }}
              className="tv-card flex items-center gap-3 p-2 text-left"
            >
              <Poster url={u.poster} title={u.title} className="h-[60px] w-[40px] shrink-0" />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[14px] font-bold">{u.title}</span>
                <span className="tv-osd tv-green block text-[15px]">
                  {u.isNew ? 'NEW · ' : `S${u.season} · `}
                  {formatDay(new Date(`${u.airdate}T12:00:00`), now).toUpperCase()}
                </span>
                {u.network && (
                  <span className="block truncate text-[11.5px]" style={{ color: 'var(--tv-faint)' }}>
                    {u.network}
                  </span>
                )}
              </span>
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
