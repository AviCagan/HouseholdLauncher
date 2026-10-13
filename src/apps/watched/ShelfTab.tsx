import { useEffect, useMemo, useRef, useState } from 'react'
import { Reorder } from 'motion/react'
import { fire } from '@/lib/haptics'
import type { WatchShow } from '@/data/types'
import { useWatched } from './useWatched'
import { OURS_JACK, shelfName, useMe, usePeople, useWatchUI, type Person } from './store'
import { NoSignal, Poster, ReorderRow } from './ui'
import { between, setShelfOrder } from './actions'
import { formatHours, formatSpan, isoDay, remainingEpisodes, yearsLabel } from './model'
import { timeToWatch } from './schedule'

/**
 * Channel 2: To Be Watched. One shelf each, and one shared — plugged in by
 * jack, like choosing an input. Either of you can look at the other's.
 */
export function ShelfTab() {
  const { shows, pace, now } = useWatched()
  const people = usePeople()
  const me = useMe()
  const shelf = useWatchUI((s) => s.shelf)
  const setShelf = useWatchUI((s) => s.setShelf)
  const open = useWatchUI((s) => s.open)

  // Start on your own shelf, the first time.
  const current: string | null = shelf === undefined ? (people.some((p) => p.id === me) ? me : null) : shelf

  const jacks = useMemo(() => {
    const mine = people.find((p) => p.id === me)
    const others = people.filter((p) => p.id !== me)
    const list: ({ kind: 'person'; person: Person } | { kind: 'ours' })[] = []
    if (mine) list.push({ kind: 'person', person: mine })
    list.push({ kind: 'ours' })
    for (const p of others) list.push({ kind: 'person', person: p })
    return list
  }, [people, me])

  const onShelf = useMemo(
    () =>
      shows
        .filter((s) => s.stage === 'shelf' && s.shelf_owner === current)
        .sort((a, b) => a.shelf_order - b.shelf_order),
    [shows, current],
  )

  const totalMinutes = onShelf.reduce((t, s) => t + timeToWatch(s, pace.minutesPerWeek, now).minutes, 0)
  const span = pace.minutesPerWeek > 0 ? (totalMinutes / pace.minutesPerWeek) * 7 : Infinity
  const name = shelfName(current, people, me)

  return (
    <div className="flex flex-col px-3 pb-8 pt-3">
      <div className="tv-card flex items-start justify-around gap-2 px-2 pb-2.5 pt-3">
        {jacks.map((j) => {
          const owner = j.kind === 'ours' ? null : j.person.id
          const on = owner === current
          const count = shows.filter((s) => s.stage === 'shelf' && s.shelf_owner === owner).length
          const label = j.kind === 'ours' ? 'OURS' : j.person.id === me ? 'MINE' : j.person.name.toUpperCase()
          return (
            <button
              key={owner ?? 'ours'}
              onClick={() => {
                fire('snap')
                setShelf(owner)
              }}
              className="flex min-w-0 flex-1 flex-col items-center gap-1.5"
              aria-pressed={on}
              aria-label={`${j.kind === 'ours' ? 'Our shelf' : `${j.person.name}'s shelf`}, ${count} shows`}
            >
              <span className="tv-jack" data-on={on} style={{ ['--jack' as string]: j.kind === 'ours' ? OURS_JACK : j.person.jack }} />
              <span className="tv-osd max-w-full truncate text-[16px]" style={{ color: on ? 'var(--tv-phosphor)' : 'var(--tv-faint)' }}>
                {j.kind === 'person' && <span className="mr-0.5">{j.person.emoji}</span>}
                {label}
              </span>
              <span className="tv-osd text-[13px]" style={{ color: 'var(--tv-faint)' }}>
                {count} {count === 1 ? 'SHOW' : 'SHOWS'}
              </span>
            </button>
          )
        })}
      </div>

      <div className="flex items-end justify-between gap-2 px-1 pb-2 pt-4">
        <div className="min-w-0">
          <p className="tv-osd tv-amber text-[19px]">{name.toUpperCase()}</p>
          {onShelf.length > 0 && (
            <p className="tv-osd text-[14px]" style={{ color: 'var(--tv-dim)' }}>
              {formatHours(totalMinutes).toUpperCase()} · ~{formatSpan(span).toUpperCase()} AT YOUR PACE
            </p>
          )}
        </div>
        <button
          onClick={() => {
            fire('tap')
            open({ kind: 'search', preset: { kind: 'shelf', owner: current } })
          }}
          className="tv-btn tv-btn--yellow tv-osd shrink-0 px-3 py-2 text-[16px]"
        >
          + ADD
        </button>
      </div>

      {onShelf.length === 0 ? (
        <NoSignal
          title="Shelf's empty"
          hint={
            current === null
              ? 'Things you both want to watch go here.'
              : current === me
                ? 'Things you want the two of you to watch go here.'
                : `Nothing on ${name.replace("'s shelf", '')}'s shelf yet.`
          }
        />
      ) : (
        <ShelfList shows={onShelf} paceMinutes={pace.minutesPerWeek} now={now} />
      )}
    </div>
  )
}

function ShelfList({ shows, paceMinutes, now }: { shows: WatchShow[]; paceMinutes: number; now: Date }) {
  const open = useWatchUI((s) => s.open)
  const ids = shows.map((s) => s.id).join(',')
  const [order, setOrder] = useState(() => shows.map((s) => s.id))
  const orderRef = useRef(order)
  orderRef.current = order
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => setOrder(shows.map((s) => s.id)), [ids])
  const byId = new Map(shows.map((s) => [s.id, s]))

  function commit(id: string) {
    const list = orderRef.current
    const i = list.indexOf(id)
    const show = byId.get(id)
    if (!show || i < 0 || shows.findIndex((s) => s.id === id) === i) return
    const prev = i > 0 ? byId.get(list[i - 1])?.shelf_order : undefined
    const next = i < list.length - 1 ? byId.get(list[i + 1])?.shelf_order : undefined
    setShelfOrder(show, between(prev, next))
  }

  return (
    <Reorder.Group axis="y" values={order} onReorder={setOrder} className="flex flex-col gap-2">
      {order.map((id) => {
        const show = byId.get(id)
        if (!show) return null
        const t = timeToWatch(show, paceMinutes, now)
        // What's out to watch; seasons only announced are mentioned, not counted.
        const today = isoDay(now)
        const all = remainingEpisodes(show)
        const eps = all.filter((e) => e.airdate !== null && e.airdate <= today)
        const seasons = new Set(eps.map((e) => e.season)).size
        const coming = new Set(all.map((e) => e.season)).size - new Set(eps.map((e) => e.season)).size
        const avg = eps.length ? Math.round(eps.reduce((s, e) => s + e.minutes, 0) / eps.length) : (show.avg_runtime ?? 0)
        return (
          <ReorderRow key={id} id={id} onDrop={() => commit(id)}>
            <button
              onClick={() => {
                fire('tap')
                open({ kind: 'show', showId: show.id })
              }}
              className="flex min-w-0 flex-1 items-center gap-3 text-left"
            >
              <Poster url={show.poster_url} title={show.title} className="h-[78px] w-[52px] shrink-0" />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[15px] font-bold">{show.title}</span>
                <span className="block truncate text-[12px]" style={{ color: 'var(--tv-dim)' }}>
                  {[yearsLabel(show), show.network].filter(Boolean).join(' · ')}
                </span>
                <span className="tv-osd block text-[14px]" style={{ color: 'var(--tv-faint)' }}>
                  {seasons} {seasons === 1 ? 'SEASON' : 'SEASONS'} · {eps.length} EPS · {avg}M
                  {coming > 0 ? ` · +${coming} COMING` : ''}
                </span>
                <span className="tv-osd tv-green block text-[15px]">
                  ≈ {formatSpan(t.days).toUpperCase()}
                  {t.unaired > 0 ? ` + ${t.unaired} TO AIR` : ''}
                </span>
              </span>
            </button>
          </ReorderRow>
        )
      })}
    </Reorder.Group>
  )
}
