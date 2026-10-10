import { useEffect, useMemo, useRef, useState } from 'react'
import { motion, Reorder } from 'motion/react'
import { fire } from '@/lib/haptics'
import type { WatchShow } from '@/data/types'
import { useWatched } from './useWatched'
import { useMe, useWatchUI } from './store'
import { Chip, NoSignal, Poster, ReorderRow, SectionHead } from './ui'
import { between, finishSeason, firstSeason, setLineupOrder, setProgress, slotIntoLineup, startWatching } from './actions'
import {
  allEpisodes,
  formatDay,
  formatHours,
  formatMonth,
  formatWhen,
  hasEpisodeOut,
  isoDay,
  lastPlannedSeason,
  paceLabel,
  remainingEpisodes,
  seasonLength,
} from './model'
import { assignLanes, type Projection } from './schedule'

/**
 * Channel 1: what's on, what's next, and when everything gets watched.
 */
export function OnAirTab() {
  const { playing, lineup, projections, pace, now, shows } = useWatched()
  const open = useWatchUI((s) => s.open)
  const me = useMe()
  const [rearranging, setRearranging] = useState(false)
  // The first show in line with an episode out: one waiting on a season
  // that hasn't aired can't be put on.
  const ready = lineup.find((s) => hasEpisodeOut(s, isoDay(now)))

  return (
    <div className="flex flex-col px-3 pb-8 pt-2">
      <button
        onClick={() => {
          fire('tap')
          open({ kind: 'pace' })
        }}
        className="tv-card mt-1 flex items-center gap-2 px-3 py-2 text-left"
      >
        <span className="tv-osd text-[14px]" style={{ color: 'var(--tv-faint)' }}>
          PACE
        </span>
        <span className="tv-osd tv-green text-[19px]">{paceLabel(pace.minutesPerWeek)}</span>
        <span className="ml-auto">
          <Chip color={pace.source === 'measured' ? 'var(--tv-osd)' : undefined}>
            {pace.source === 'measured'
              ? pace.confidence >= 1
                ? 'MEASURED'
                : 'LEARNING'
              : pace.source === 'manual'
                ? 'SET BY YOU'
                : 'STARTER PACE'}
          </Chip>
        </span>
      </button>

      <SectionHead>▶ NOW PLAYING</SectionHead>
      {playing.length === 0 ? (
        <NoSignal
          title="Nothing on"
          hint={
            ready
              ? `${ready.title} is next in the lineup.`
              : lineup.length > 0
                ? 'Everything in the lineup is waiting on new episodes.'
                : 'Find a show, put it on a shelf or straight into the lineup.'
          }
          action={
            ready ? (
              <button
                onClick={() => startWatching(ready, me)}
                className="tv-btn tv-btn--yellow tv-osd px-4 py-2.5 text-[18px]"
              >
                ▶ PLAY {ready.title.toUpperCase().slice(0, 22)}
              </button>
            ) : (
              <button
                onClick={() => {
                  fire('tap')
                  open({ kind: 'search', preset: { kind: 'lineup', at: 'end' } })
                }}
                className="tv-btn tv-btn--yellow tv-osd px-4 py-2.5 text-[18px]"
              >
                + FIND A SHOW
              </button>
            )
          }
        />
      ) : (
        <div className="flex flex-col gap-3">
          {playing.map((show) => (
            <NowCard key={show.id} show={show} projection={projections.get(show.id)} now={now} />
          ))}
        </div>
      )}

      <SectionHead
        right={
          lineup.length > 1 ? (
            <button
              onClick={() => {
                fire('tap')
                setRearranging((v) => !v)
              }}
              className="tv-osd text-[15px]"
              style={{ color: rearranging ? 'var(--tv-yellow)' : 'var(--tv-dim)' }}
            >
              {rearranging ? 'DONE' : 'REARRANGE'}
            </button>
          ) : undefined
        }
      >
        ▸ UP NEXT
      </SectionHead>
      {rearranging ? (
        <LineupReorder lineup={lineup} projections={projections} now={now} />
      ) : (
        <UpNext lineup={lineup} playing={playing} projections={projections} now={now} />
      )}

      {playing.length + lineup.length > 0 && (
        <>
          <SectionHead>▦ TV GUIDE</SectionHead>
          <ProgramGuide shows={[...playing, ...lineup]} projections={projections} now={now} />
        </>
      )}

      <ReturningSoon shows={shows} now={now} />
    </div>
  )
}

// --- now playing -----------------------------------------------------------------

function NowCard({ show, projection, now }: { show: WatchShow; projection: Projection | undefined; now: Date }) {
  const me = useMe()
  const open = useWatchUI((s) => s.open)
  const season = show.current_season ?? 1
  const len = seasonLength(show, season)
  const done = projection?.position?.done ?? show.current_episode
  const estimated = projection?.position?.estimated ?? false
  const seasonDone = projection?.seasonFinish.get(season)
  const final = season === lastPlannedSeason(show) && (show.status === 'Ended' || show.tvmaze_id === null)
  const nextEpisode = allEpisodes(show).filter((e) => e.season === season)[done]
  const nextAirs = nextEpisode?.airdate && nextEpisode.airdate > isoDay(now) ? nextEpisode.airdate : null

  function finish() {
    const outcome = finishSeason(show, me)
    open({ kind: 'rate', showId: show.id, seasons: [season], includeShow: outcome.kind === 'finished', outcome })
  }

  return (
    <motion.div layout className="tv-card overflow-hidden p-3">
      <div className="flex gap-3">
        <button
          onClick={() => {
            fire('tap')
            open({ kind: 'show', showId: show.id })
          }}
          className="w-[92px] shrink-0"
          aria-label={`Open ${show.title}`}
        >
          <Poster url={show.poster_url} title={show.title} className="aspect-[2/3] w-full" />
        </button>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5">
            <span className="tv-led" data-on="true" />
            <span className="tv-osd tv-red text-[15px]">ON AIR</span>
            {show.live && <Chip color="var(--tv-red)">AS IT AIRS</Chip>}
          </div>
          <h3 className="tv-glow mt-1 line-clamp-2 text-[17px] font-bold leading-tight">{show.title}</h3>
          <p className="tv-osd tv-green mt-1.5 text-[24px]">
            S{season} · {estimated ? '≈' : ''}
            {done}/{len}
          </p>
          <p className="tv-osd text-[13px]" style={{ color: 'var(--tv-faint)' }}>
            EPISODES WATCHED{estimated ? ' · ESTIMATE' : ''}
          </p>
          <EpisodeTrack done={done} len={len} />
          <p className="tv-osd mt-1.5 text-[15px]" style={{ color: 'var(--tv-dim)' }}>
            {nextAirs
              ? `NEXT EPISODE ${formatDay(new Date(`${nextAirs}T12:00:00`), now).toUpperCase()}`
              : seasonDone
                ? `SEASON DONE ~${formatWhen(seasonDone, now).toUpperCase()}`
                : projection?.tba
                  ? 'REST OF SEASON TBA'
                  : ''}
          </p>
          {projection?.finish && !final && (
            <p className="tv-osd text-[15px]" style={{ color: 'var(--tv-dim)' }}>
              ALL CAUGHT UP ~{formatWhen(projection.finish, now).toUpperCase()}
            </p>
          )}
        </div>
      </div>

      <div className="mt-3 flex items-stretch gap-2">
        <div className="tv-card flex items-center">
          <button
            onClick={() => setProgress(show, done - 1, me)}
            disabled={done <= 0}
            aria-label="One episode fewer"
            className="tv-osd grid h-11 w-10 place-items-center text-[24px] disabled:opacity-30"
          >
            −
          </button>
          <span className="tv-osd w-8 text-center text-[13px]" style={{ color: 'var(--tv-faint)' }}>
            EP
          </span>
          <button
            onClick={() => setProgress(show, done + 1, me)}
            disabled={done >= len}
            aria-label="Watched another episode"
            className="tv-osd grid h-11 w-10 place-items-center text-[24px] disabled:opacity-30"
          >
            +
          </button>
        </div>
        <button onClick={finish} className="tv-btn tv-btn--yellow tv-osd flex-1 px-3 text-[18px]">
          {final ? '🏁 FINISHED THE SHOW' : `🏁 FINISHED SEASON ${season}`}
        </button>
      </div>
    </motion.div>
  )
}

function EpisodeTrack({ done, len }: { done: number; len: number }) {
  if (len <= 0) return null
  // One block per episode when they fit; a plain gauge for long seasons.
  if (len <= 26) {
    return (
      <div className="mt-1.5 flex gap-[2px]">
        {Array.from({ length: len }, (_, i) => (
          <span
            key={i}
            className="h-[7px] flex-1 rounded-[1px]"
            style={{
              background: i < done ? 'var(--tv-osd)' : 'rgb(255 255 255 / 0.08)',
              boxShadow: i < done ? '0 0 6px rgb(97 255 154 / 0.6)' : 'none',
            }}
          />
        ))}
      </div>
    )
  }
  return (
    <div className="mt-1.5 h-[7px] overflow-hidden rounded-[2px]" style={{ background: 'rgb(255 255 255 / 0.08)' }}>
      <div className="h-full" style={{ width: `${(done / len) * 100}%`, background: 'var(--tv-osd)', boxShadow: '0 0 6px rgb(97 255 154 / 0.6)' }} />
    </div>
  )
}

// --- up next -------------------------------------------------------------------------

function slotSummary(show: WatchShow): string {
  const eps = remainingEpisodes(show)
  if (eps.length === 0) return 'NOTHING LISTED YET'
  const seasons = [...new Set(eps.map((e) => e.season))]
  const range = seasons.length === 1 ? `S${seasons[0]}` : `S${seasons[0]}–${seasons[seasons.length - 1]}`
  const minutes = eps.reduce((t, e) => t + e.minutes, 0)
  return `${range} · ${eps.length} EPS · ${formatHours(minutes).toUpperCase()}`
}

function UpNext({
  lineup,
  playing,
  projections,
  now,
}: {
  lineup: WatchShow[]
  playing: WatchShow[]
  projections: Map<string, Projection>
  now: Date
}) {
  const open = useWatchUI((s) => s.open)
  const me = useMe()

  if (lineup.length === 0) {
    return (
      <div className="tv-card flex flex-col items-center gap-2 px-4 py-5 text-center">
        <p className="tv-osd tv-glow text-[20px]">THE LINEUP IS EMPTY</p>
        <p className="text-[13px]" style={{ color: 'var(--tv-dim)' }}>
          Slot shows in from a shelf, or find something new.
        </p>
        <div className="mt-1 flex gap-2">
          <button
            onClick={() => {
              fire('tap')
              useWatchUI.getState().setTab('shelf')
            }}
            className="tv-btn tv-osd px-3 py-2 text-[16px]"
          >
            SHELVES
          </button>
          <button
            onClick={() => {
              fire('tap')
              open({ kind: 'search', preset: { kind: 'lineup', at: 'end' } })
            }}
            className="tv-btn tv-btn--yellow tv-osd px-3 py-2 text-[16px]"
          >
            + FIND A SHOW
          </button>
        </div>
      </div>
    )
  }

  return (
    <div className="scroll-x -mx-3 flex snap-x snap-mandatory gap-3 px-3 pb-2">
      {lineup.map((show, i) => {
        const p = projections.get(show.id)
        // What it follows: the show before it that isn't watched as it airs —
        // those come on alongside everything, so nothing comes "after" them.
        const before = [...playing, ...lineup.slice(0, i)].filter((s) => !s.live).pop()
        const out = hasEpisodeOut(show, isoDay(now))
        const nextSeason = remainingEpisodes(show)[0]?.season ?? show.plan_from
        return (
          <div key={show.id} className="tv-card w-[172px] shrink-0 snap-start p-2.5">
            <div className="flex items-center justify-between">
              <span className="tv-osd tv-amber text-[16px]">#{i + 1}</span>
              {show.live && <Chip color="var(--tv-red)">AS IT AIRS</Chip>}
            </div>
            <button
              onClick={() => {
                fire('tap')
                open({ kind: 'show', showId: show.id })
              }}
              className="mt-1.5 block w-full text-left"
            >
              <Poster url={show.poster_url} title={show.title} className="aspect-[2/3] w-full" />
              <p className="tv-glow mt-2 line-clamp-2 min-h-[2.5em] text-[14px] font-bold leading-tight">{show.title}</p>
            </button>
            <p className="tv-osd mt-1 text-[13px]" style={{ color: 'var(--tv-faint)' }}>
              {slotSummary(show)}
            </p>
            <Estimate projection={p} now={now} />
            {before && !show.live && (
              <p className="mt-1 truncate text-[11px]" style={{ color: 'var(--tv-faint)' }}>
                after {before.title}
              </p>
            )}
            {out ? (
              <button onClick={() => startWatching(show, me)} className="tv-btn tv-osd mt-2 w-full py-1.5 text-[15px]">
                ▶ START NOW
              </button>
            ) : (
              <p
                className="tv-osd mt-2 rounded-[12px] border border-dashed py-1.5 text-center text-[15px]"
                style={{ borderColor: 'var(--tv-line)', color: 'var(--tv-faint)' }}
              >
                ⏳ WAITING{nextSeason ? ` FOR S${nextSeason}` : ''}
              </p>
            )}
          </div>
        )
      })}
      <button
        onClick={() => {
          fire('tap')
          open({ kind: 'search', preset: { kind: 'lineup', at: 'end' } })
        }}
        className="tv-card grid w-[120px] shrink-0 snap-start place-items-center p-3 text-center"
        style={{ borderStyle: 'dashed' }}
      >
        <span>
          <span className="tv-osd tv-yellow block text-[34px]">+</span>
          <span className="tv-osd block text-[15px]" style={{ color: 'var(--tv-dim)' }}>
            SLOT A SHOW IN
          </span>
        </span>
      </button>
    </div>
  )
}

function Estimate({ projection, now }: { projection: Projection | undefined; now: Date }) {
  if (!projection) return null
  const { start, finish, tba, beyond, waitingUntil } = projection
  return (
    <div className="tv-osd mt-1.5 flex flex-col gap-0.5 text-[15px]">
      <span className="tv-green">
        {start ? `STARTS ~${formatWhen(start, now).toUpperCase()}` : waitingUntil ? `AIRS ${formatMonth(waitingUntil).toUpperCase()}` : 'DATES TBA'}
      </span>
      <span style={{ color: 'var(--tv-dim)' }}>
        {finish ? `DONE ~${formatWhen(finish, now).toUpperCase()}` : tba ? 'DONE: TBA' : beyond ? 'DONE: 20+ YRS' : ''}
      </span>
    </div>
  )
}

function LineupReorder({
  lineup,
  projections,
  now,
}: {
  lineup: WatchShow[]
  projections: Map<string, Projection>
  now: Date
}) {
  const ids = lineup.map((s) => s.id).join(',')
  const [order, setOrder] = useState(() => lineup.map((s) => s.id))
  const orderRef = useRef(order)
  orderRef.current = order
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => setOrder(lineup.map((s) => s.id)), [ids])

  const byId = new Map(lineup.map((s) => [s.id, s]))

  function commit(id: string) {
    const list = orderRef.current
    const i = list.indexOf(id)
    const show = byId.get(id)
    if (!show || i < 0) return
    const prev = i > 0 ? byId.get(list[i - 1])?.lineup_order : undefined
    const next = i < list.length - 1 ? byId.get(list[i + 1])?.lineup_order : undefined
    const before = lineup.findIndex((s) => s.id === id)
    if (before === i) return
    setLineupOrder(show, between(prev, next))
  }

  return (
    <Reorder.Group axis="y" values={order} onReorder={setOrder} className="flex flex-col gap-2">
      {order.map((id, i) => {
        const show = byId.get(id)
        if (!show) return null
        return (
          <ReorderRow key={id} id={id} onDrop={() => commit(id)}>
            <span className="tv-osd tv-amber w-7 text-center text-[20px]">{i + 1}</span>
            <Poster url={show.poster_url} title={show.title} className="h-[54px] w-[36px] shrink-0" />
            <span className="min-w-0 flex-1">
              <span className="block truncate text-[14px] font-semibold">{show.title}</span>
              <span className="tv-osd block text-[14px]" style={{ color: 'var(--tv-dim)' }}>
                {projections.get(id)?.start ? `~${formatWhen(projections.get(id)!.start!, now).toUpperCase()}` : 'TBA'}
              </span>
            </span>
          </ReorderRow>
        )
      })}
    </Reorder.Group>
  )
}

// --- the guide ---------------------------------------------------------------------

const PX_PER_DAY = 3
const DAY = 86_400_000
const BLOCK_COLORS = ['#f8c534', '#6fe7ff', '#f3efe4', '#7ad3a1', '#ff9f68', '#c9a7ff']

function ProgramGuide({
  shows,
  projections,
  now,
}: {
  shows: WatchShow[]
  projections: Map<string, Projection>
  now: Date
}) {
  const open = useWatchUI((s) => s.open)
  const scroller = useRef<HTMLDivElement>(null)

  const layout = useMemo(() => {
    const start = new Date(now.getFullYear(), now.getMonth(), 1)
    const items = shows
      .map((show, i) => ({ show, p: projections.get(show.id), color: BLOCK_COLORS[i % BLOCK_COLORS.length] }))
      .filter((x): x is { show: WatchShow; p: Projection; color: string } => !!x.p && !!x.p.start)
    const latest = items.reduce((max, x) => {
      const end = x.p.finish ?? new Date(x.p.start!.getTime() + 75 * DAY)
      return Math.max(max, end.getTime())
    }, start.getTime() + 150 * DAY)
    // Five years is as far as anyone needs to scroll; later estimates are
    // still on the cards themselves.
    const endRaw = Math.min(latest + 35 * DAY, start.getTime() + 5 * 365 * DAY)
    const end = new Date(new Date(endRaw).getFullYear(), new Date(endRaw).getMonth() + 1, 1)
    const lanes = assignLanes(
      items.map((x) => ({ id: x.show.id, start: x.p.start, finish: x.p.finish })),
      end,
    )
    const months: { at: Date; x: number }[] = []
    for (let d = new Date(start); d < end; d = new Date(d.getFullYear(), d.getMonth() + 1, 1)) {
      months.push({ at: d, x: ((d.getTime() - start.getTime()) / DAY) * PX_PER_DAY })
    }
    const laneCount = Math.max(1, ...[...lanes.values()].map((l) => l + 1))
    return { start, end, items, lanes, months, laneCount, width: ((end.getTime() - start.getTime()) / DAY) * PX_PER_DAY }
  }, [shows, projections, now])

  const nowX = ((now.getTime() - layout.start.getTime()) / DAY) * PX_PER_DAY

  useEffect(() => {
    if (scroller.current) scroller.current.scrollLeft = Math.max(0, nowX - 24)
    // Once, on mount: after that the scroll position is theirs.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const LANE_H = 50
  const HEAD_H = 26

  return (
    <div className="tv-card flex overflow-hidden">
      <div className="shrink-0 border-r" style={{ borderColor: 'var(--tv-line)', width: 42 }}>
        <div style={{ height: HEAD_H }} />
        {Array.from({ length: layout.laneCount }, (_, i) => (
          <div key={i} className="tv-osd grid place-items-center text-[14px]" style={{ height: LANE_H, color: 'var(--tv-faint)' }}>
            CH{i + 1}
          </div>
        ))}
      </div>
      <div ref={scroller} className="scroll-x relative min-w-0 flex-1">
        <div className="relative" style={{ width: layout.width, height: HEAD_H + layout.laneCount * LANE_H + 6 }}>
          {layout.months.map((m) => (
            <div key={m.x} className="absolute bottom-0 top-0" style={{ left: m.x, borderLeft: '1px solid var(--tv-line)' }}>
              <span className="tv-osd absolute left-1.5 top-1 whitespace-nowrap text-[14px]" style={{ color: 'var(--tv-dim)' }}>
                {m.at.toLocaleDateString('en-US', { month: 'short' }).toUpperCase()}
                {m.at.getMonth() === 0 || m.x === 0 ? ` '${String(m.at.getFullYear()).slice(2)}` : ''}
              </span>
            </div>
          ))}

          {layout.items.map(({ show, p, color }) => {
            const lane = layout.lanes.get(show.id) ?? 0
            const left = Math.max(0, ((p.start!.getTime() - layout.start.getTime()) / DAY) * PX_PER_DAY)
            const endTime = (p.finish ?? layout.end).getTime()
            const width = Math.max(46, ((endTime - p.start!.getTime()) / DAY) * PX_PER_DAY - 2)
            const open_ = !p.finish
            return (
              <button
                key={show.id}
                onClick={() => {
                  fire('tap')
                  open({ kind: 'show', showId: show.id })
                }}
                className={`tv-block text-left ${open_ ? 'tv-tba' : ''}`}
                style={{
                  left,
                  width,
                  top: HEAD_H + lane * LANE_H + 4,
                  height: LANE_H - 8,
                  color: '#1a1408',
                  background: show.live
                    ? `repeating-linear-gradient(135deg, ${color} 0 10px, color-mix(in oklab, ${color} 82%, black) 10px 20px)`
                    : `linear-gradient(180deg, color-mix(in oklab, ${color} 92%, white), ${color})`,
                }}
                aria-label={`${show.title}${p.finish ? `, done around ${formatMonth(p.finish)}` : ''}`}
              >
                <span className="block truncate px-2 pt-1 text-[12.5px] font-bold leading-tight">{show.title}</span>
                <span className="tv-osd block truncate px-2 text-[13px] opacity-75">
                  {p.finish ? `→ ${formatMonth(p.finish).toUpperCase()}` : p.tba ? '→ TBA' : '→ …'}
                </span>
              </button>
            )
          })}

          <div className="pointer-events-none absolute bottom-0 top-0 z-10" style={{ left: nowX, width: 2, background: 'var(--tv-red)', boxShadow: '0 0 8px var(--tv-red)' }}>
            <span className="tv-osd tv-red absolute -left-3 bottom-0 text-[12px]">NOW</span>
          </div>
        </div>
      </div>
    </div>
  )
}

// --- returning ---------------------------------------------------------------------

/**
 * Shows on a shelf or already watched with new episodes coming — the "new
 * season of X starts in March" nudge, one tap from the lineup.
 */
function ReturningSoon({ shows, now }: { shows: WatchShow[]; now: Date }) {
  const me = useMe()
  const today = isoDay(now)
  const items = shows
    .filter((s) => (s.stage === 'shelf' || s.stage === 'watched') && s.next_airdate && s.next_airdate >= today)
    .sort((a, b) => (a.next_airdate ?? '').localeCompare(b.next_airdate ?? ''))
    .slice(0, 8)
  if (items.length === 0) return null

  return (
    <>
      <SectionHead>★ RETURNING SOON</SectionHead>
      <div className="flex flex-col gap-2">
        {items.map((show) => {
          const nextEp = allEpisodes(show).find((e) => e.airdate !== null && e.airdate >= today)
          const season = nextEp?.season ?? firstSeason(show)
          const when = new Date(`${show.next_airdate}T12:00:00`)
          return (
            <div key={show.id} className="tv-card flex items-center gap-3 p-2">
              <Poster url={show.poster_url} title={show.title} className="h-[60px] w-[40px] shrink-0" />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[14px] font-semibold">{show.title}</span>
                <span className="tv-osd tv-green block text-[15px]">
                  S{season} · {formatDay(when, now).toUpperCase()}
                </span>
              </span>
              <button
                onClick={() => {
                  const orders = shows.filter((s) => s.stage === 'lineup' || s.stage === 'watching').map((s) => s.lineup_order)
                  slotIntoLineup(show, orders.length ? Math.max(...orders) + 1000 : Date.now(), me, {
                    live: true,
                    planFrom: season,
                    planTo: null,
                  })
                }}
                className="tv-btn tv-osd shrink-0 px-2.5 py-2 text-[14px]"
              >
                WATCH AS IT AIRS
              </button>
            </div>
          )
        })}
      </div>
    </>
  )
}
