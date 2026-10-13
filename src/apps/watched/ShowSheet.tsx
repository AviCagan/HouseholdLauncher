import { useState } from 'react'
import { toast } from 'sonner'
import { Sheet } from '@/components/primitives/Sheet'
import { fire } from '@/lib/haptics'
import type { WatchShow } from '@/data/types'
import { useWatched } from './useWatched'
import { OURS_JACK, shelfName, useMe, usePeople, useWatchUI } from './store'
import { Chip, Face, Poster, Stat } from './ui'
import {
  dropShow,
  finishSeason,
  markWatched,
  markWatchedBefore,
  moveToShelf,
  pauseShow,
  playNext,
  queueNextSeason,
  refreshShow,
  removeShow,
  setLive,
  setPlan,
  startWatching,
} from './actions'
import {
  allEpisodes,
  formatDay,
  formatHours,
  formatMinutes,
  formatSpan,
  formatWhen,
  hasEpisodeOut,
  isoDay,
  lastSeasonOut,
  remainingEpisodes,
  seasonNumbers,
  seasonStats,
  showTotals,
  yearsLabel,
} from './model'
import { timeToWatch } from './schedule'
import { useHold } from './hold'
import { formatScore, seasonScores, showScores } from './ratings'

/**
 * One show: everything known about it, the estimate, its seasons, its
 * scores, and what can be done with it from wherever it is.
 */
export function ShowSheet({ showId }: { showId: string }) {
  const close = useWatchUI((s) => s.close)
  const { shows } = useWatched()
  const show = shows.find((s) => s.id === showId)

  return (
    <Sheet open onClose={close} maxHeight="92vh" title={<span className="tv-osd tv-amber text-[18px]">▸ ON THE GUIDE</span>}>
      {show ? (
        <ShowBody show={show} />
      ) : (
        <p className="tv-osd py-10 text-center text-[19px]" style={{ color: 'var(--tv-dim)' }}>
          THIS SHOW WAS TAKEN OFF THE AIR
        </p>
      )}
    </Sheet>
  )
}

function ShowBody({ show }: { show: WatchShow }) {
  const { log, ratings, projections, pace, now, lineup } = useWatched()
  const people = usePeople()
  const me = useMe()
  const open = useWatchUI((s) => s.open)
  const replace = useWatchUI((s) => s.replace)
  const close = useWatchUI((s) => s.close)
  const setTab = useWatchUI((s) => s.setTab)
  const [confirmRemove, setConfirmRemove] = useState(false)
  const [refreshing, setRefreshing] = useState(false)

  const today = isoDay(now)
  const totals = showTotals(show, today)
  const stats = seasonStats(show, today)
  const projection = projections.get(show.id)
  const ttw = timeToWatch(show, pace.minutesPerWeek, now)
  const whole = showScores(ratings, show.id)
  const hasDatedFuture = allEpisodes(show).some((e) => e.airdate !== null && e.airdate > today)
  const seasonsAll = seasonNumbers(show)
  const watchedThrough = show.plan_to ?? lastSeasonOut(show, today)
  const laterSeasons = show.stage === 'watched' && seasonsAll.some((n) => n > (watchedThrough ?? 0))

  function finish() {
    if (!show.current_season) return
    const season = show.current_season
    const outcome = finishSeason(show, me)
    replace({ kind: 'rate', showId: show.id, seasons: [season], includeShow: outcome.kind === 'finished', outcome })
  }

  const stageLine =
    show.stage === 'shelf'
      ? `ON ${shelfName(show.shelf_owner, people, me).toUpperCase()}`
      : show.stage === 'lineup'
        ? `IN THE LINEUP · #${lineup.findIndex((s) => s.id === show.id) + 1}`
        : show.stage === 'watching'
          ? `NOW PLAYING · SEASON ${show.current_season}`
          : show.stage === 'watched'
            ? show.watched_before
              ? 'WATCHED BEFORE'
              : `WATCHED${show.finished_at ? ` · ${formatDay(new Date(show.finished_at), now).toUpperCase()}` : ''}`
            : 'DROPPED'

  return (
    <div className="flex flex-col gap-4 pb-6 pt-1">
      <div className="flex gap-3.5">
        <button
          onClick={() => {
            if (show.tvmaze_id === null && !show.poster_url) return
            fire('tap')
            open({ kind: 'posters', showId: show.id })
          }}
          className="w-[118px] shrink-0"
          aria-label="Change the picture"
        >
          <Poster url={show.poster_url} title={show.title} large className="aspect-[2/3] w-full" />
          <span className="tv-osd mt-1.5 block text-center text-[13px]" style={{ color: 'var(--tv-faint)' }}>
            {show.tvmaze_id !== null ? 'CHANGE PICTURE' : ''}
          </span>
        </button>
        <div className="min-w-0 flex-1">
          <h2 className="tv-glow text-[21px] font-bold leading-tight">{show.title}</h2>
          <p className="mt-1 text-[12.5px]" style={{ color: 'var(--tv-dim)' }}>
            {[yearsLabel(show), show.network].filter(Boolean).join(' · ')}
          </p>
          <div className="mt-2 flex flex-wrap gap-1">
            {show.status === 'Running' && <Chip color="var(--tv-red)">AIRING</Chip>}
            {show.status === 'Ended' && <Chip>ENDED</Chip>}
            {show.status === 'In Development' && <Chip color="var(--tv-cyan)">COMING</Chip>}
            {show.genres.slice(0, 3).map((g) => (
              <Chip key={g}>{g.toUpperCase()}</Chip>
            ))}
          </div>
          <p className="tv-osd tv-amber mt-2.5 text-[17px]">{stageLine}</p>
          {whole.together !== null && (
            <p className="tv-osd mt-1 text-[17px]">
              <span className="tv-green text-[24px]">★ {formatScore(whole.together)}</span>
              <span style={{ color: 'var(--tv-faint)' }}> TOGETHER</span>
            </p>
          )}
        </div>
      </div>

      <Actions
        show={show}
        out={hasEpisodeOut(show, today)}
        hasDatedFuture={hasDatedFuture}
        laterSeasons={laterSeasons}
        onFinish={finish}
        onFinishDates={() => replace({ kind: 'finish', showId: show.id })}
        onRate={() =>
          replace({
            kind: 'rate',
            showId: show.id,
            seasons: watchedSeasons(show, log),
            includeShow: show.stage === 'watched',
            backfill: show.watched_before,
          })
        }
        onSlot={() => replace({ kind: 'slot', showId: show.id })}
        onGoOnAir={() => {
          setTab('onair')
          close()
        }}
      />

      {(projection || (show.stage === 'shelf' && ttw.minutes > 0)) && (
        <div className="tv-card px-3 py-2.5">
          <p className="tv-osd text-[14px]" style={{ color: 'var(--tv-faint)' }}>
            AT YOUR PACE ({formatMinutes(pace.minutesPerWeek).toUpperCase()}/WK)
          </p>
          {projection && show.stage === 'lineup' && projection.episodesLeft === 0 && projection.tba ? (
            <div className="tv-osd mt-1 flex flex-col gap-0.5 text-[19px]">
              <span className="tv-green">⏳ WAITING FOR SEASON {remainingEpisodes(show)[0]?.season ?? show.plan_from ?? '?'}</span>
              <span className="text-[15px]" style={{ color: 'var(--tv-dim)' }}>
                NOTHING LISTED YET · IT COMES ON WHEN IT AIRS
              </span>
            </div>
          ) : projection ? (
            <div className="tv-osd mt-1 flex flex-col gap-0.5 text-[19px]">
              {show.stage === 'lineup' && (
                <span className="tv-green">
                  {projection.start ? `STARTS ~${formatWhen(projection.start, now).toUpperCase()}` : 'START: TBA'}
                </span>
              )}
              <span className="tv-green">
                {projection.finish
                  ? `DONE ~${formatWhen(projection.finish, now).toUpperCase()}`
                  : projection.tba
                    ? 'DONE: WHEN THE REST IS DATED'
                    : 'DONE: 20+ YEARS'}
              </span>
              {projection.waitingUntil && (
                <span style={{ color: 'var(--tv-dim)' }}>
                  NEXT EPISODE {formatDay(projection.waitingUntil, now).toUpperCase()}
                </span>
              )}
              <span className="text-[15px]" style={{ color: 'var(--tv-dim)' }}>
                {projection.episodesLeft} EPISODES · {formatHours(projection.minutesLeft).toUpperCase()} TO GO
              </span>
            </div>
          ) : (
            <p className="tv-osd tv-green mt-1 text-[19px]">
              ≈ {formatSpan(ttw.days).toUpperCase()} IF YOU STARTED TODAY
              {ttw.unaired > 0 && (
                <span className="block text-[15px]" style={{ color: 'var(--tv-dim)' }}>
                  + {ttw.unaired} EPISODES STILL TO AIR
                </span>
              )}
            </p>
          )}
        </div>
      )}

      {(show.stage === 'lineup' || show.stage === 'watching') && (
        <PlanControls show={show} hasDatedFuture={hasDatedFuture} />
      )}

      <div className="grid grid-cols-3 gap-2">
        <Stat
          label="SEASONS"
          value={totals.seasons}
          sub={totals.comingSeasons > 0 ? `+${totals.comingSeasons} coming` : undefined}
        />
        <Stat label="EPISODES" value={totals.airedEpisodes} sub={totals.episodes > totals.airedEpisodes ? `+${totals.episodes - totals.airedEpisodes} to air` : undefined} />
        <Stat label="AVG EP" value={`${totals.avgRuntime}M`} />
        <Stat label="EPS/SEASON" value={totals.avgEpisodesPerSeason} />
        <Stat label="RUNTIME" value={formatHours(totals.minutes).replace(' hrs', 'H').replace(' min', 'M').toUpperCase()} />
        <Stat label="STATUS" value={show.status === 'Ended' ? 'ENDED' : show.status === 'Running' ? 'AIRING' : '—'} />
      </div>

      {stats.length > 0 && (
        <div className="flex flex-col gap-1.5">
          <p className="tv-osd tv-amber px-1 text-[17px]">SEASONS</p>
          {stats.map((st) => {
            const row = log.find((r) => r.show_id === show.id && r.season === st.n)
            const sc = seasonScores(ratings, show.id, st.n)
            const isNow = show.stage === 'watching' && show.current_season === st.n
            const done =
              !!row?.finished_at ||
              (show.stage === 'watched' && (show.plan_to === null || st.n <= show.plan_to) && st.episodes > 0)
            const airsLater = st.premiere && st.premiere > today && !done
            const status = isNow
              ? { text: '▶ NOW', color: 'var(--tv-red)' }
              : done
                ? {
                    text: row?.finished_at ? `✓ ${formatDay(new Date(row.finished_at), now).toUpperCase()}` : '✓ WATCHED',
                    color: 'var(--tv-osd)',
                  }
                : airsLater
                  ? { text: `AIRS ${formatDay(new Date(`${st.premiere}T12:00:00`), now).toUpperCase()}`, color: 'var(--tv-cyan)' }
                  : st.tba
                    ? { text: 'TBA', color: 'var(--tv-faint)' }
                    : st.aired < st.episodes
                      ? { text: `${st.aired}/${st.episodes} OUT`, color: 'var(--tv-amber)' }
                      : { text: '', color: 'var(--tv-faint)' }
            return (
              <button
                key={st.n}
                onClick={() => {
                  fire('tap')
                  replace({ kind: 'rate', showId: show.id, seasons: [st.n], includeShow: false })
                }}
                className="tv-card flex items-center gap-2.5 px-3 py-2 text-left"
              >
                <span className="tv-osd tv-yellow w-9 text-[20px]">S{st.n}</span>
                <span className="min-w-0 flex-1">
                  <span className="tv-osd block text-[15px]" style={{ color: 'var(--tv-phosphor)' }}>
                    {st.episodes ? `${st.episodes} EPS · ${st.avgRuntime}M · ${formatHours(st.minutes).toUpperCase()}` : 'ANNOUNCED'}
                  </span>
                  <span className="tv-osd block text-[14px]" style={{ color: status.color }}>
                    {status.text}
                    {st.premiere && !airsLater ? `${status.text ? ' · ' : ''}${st.premiere.slice(0, 4)}` : ''}
                  </span>
                </span>
                {sc.together !== null ? (
                  <span className="tv-osd tv-green text-[22px]">{formatScore(sc.together)}</span>
                ) : done ? (
                  <span className="tv-osd text-[14px]" style={{ color: 'var(--tv-yellow)' }}>
                    RATE
                  </span>
                ) : null}
              </button>
            )
          })}
        </div>
      )}

      {whole.byPerson.size > 0 && (
        <div className="tv-card flex flex-wrap items-center gap-x-4 gap-y-1 px-3 py-2.5">
          <span className="tv-osd text-[14px]" style={{ color: 'var(--tv-faint)' }}>
            SCORES
          </span>
          {people.map((p) => (
            <span key={p.id} className="flex items-center gap-1.5">
              <Face emoji={p.emoji} avatar={p.avatar} color={p.color} size={18} />
              <span className="tv-osd text-[18px]">{formatScore(whole.byPerson.get(p.id) ?? null)}</span>
              {whole.basis.get(p.id) === 'seasons' && (
                <span className="tv-osd text-[12px]" style={{ color: 'var(--tv-faint)' }}>
                  (SEASONS)
                </span>
              )}
            </span>
          ))}
        </div>
      )}

      {show.summary && (
        <p className="text-[13.5px] leading-relaxed" style={{ color: 'var(--tv-dim)' }}>
          {show.summary}
        </p>
      )}

      {show.stage === 'shelf' && (
        <div>
          <p className="tv-osd px-1 pb-2 text-[15px]" style={{ color: 'var(--tv-faint)' }}>
            MOVE TO ANOTHER SHELF
          </p>
          <div className="flex gap-2">
            {[...people.filter((p) => p.id === me), null, ...people.filter((p) => p.id !== me)].map((p) => {
              const owner = p ? p.id : null
              const here = owner === show.shelf_owner
              return (
                <button
                  key={owner ?? 'ours'}
                  disabled={here}
                  onClick={() => {
                    moveToShelf(show, owner, me)
                    toast(`Moved to ${shelfName(owner, people, me).toLowerCase()}`)
                  }}
                  className="tv-btn flex flex-1 flex-col items-center gap-1 px-1 py-2"
                >
                  <span className="tv-jack" data-on={here} style={{ ['--jack' as string]: p ? p.jack : OURS_JACK, width: 26, height: 26 }} />
                  <span className="tv-osd text-[14px]">{p ? (p.id === me ? 'MINE' : p.name.toUpperCase()) : 'OURS'}</span>
                </button>
              )
            })}
          </div>
        </div>
      )}

      <div className="flex flex-col items-center gap-3 pt-1">
        {show.tvmaze_id !== null && (
          <button
            disabled={refreshing}
            onClick={async () => {
              setRefreshing(true)
              fire('tap')
              const ok = await refreshShow(show)
              setRefreshing(false)
              if (ok) toast.success('Up to date with TVmaze')
              else toast.error("Couldn't reach TVmaze")
            }}
            className="tv-osd text-[15px]"
            style={{ color: 'var(--tv-dim)' }}
          >
            {refreshing ? 'CHECKING…' : '↻ CHECK FOR NEW EPISODES'}
          </button>
        )}
        <button
          onClick={() => {
            if (!confirmRemove) {
              fire('warning')
              setConfirmRemove(true)
              return
            }
            removeShow(show)
            close()
          }}
          className="tv-osd rounded-xl px-4 py-2 text-[15px]"
          style={{
            color: confirmRemove ? '#fff' : 'var(--tv-red)',
            background: confirmRemove ? 'var(--tv-red)' : 'transparent',
          }}
        >
          {confirmRemove ? 'TAP AGAIN TO REMOVE IT AND ITS SCORES' : 'REMOVE SHOW'}
        </button>
      </div>
    </div>
  )
}

/** Seasons with a record of being watched, for the rating sheet. */
function watchedSeasons(show: WatchShow, log: { show_id: string; season: number; finished_at: string | null }[]): number[] {
  const finished = log.filter((r) => r.show_id === show.id && r.finished_at).map((r) => r.season)
  if (finished.length) return [...new Set(finished)].sort((a, b) => a - b)
  if (show.stage === 'watched') {
    const through = show.plan_to ?? lastSeasonOut(show, isoDay(new Date())) ?? 0
    return seasonNumbers(show).filter((n) => n <= through)
  }
  return []
}

function Actions({
  show,
  out,
  hasDatedFuture,
  laterSeasons,
  onFinish,
  onFinishDates,
  onRate,
  onSlot,
  onGoOnAir,
}: {
  show: WatchShow
  /** An episode they haven't seen is out — there's something to start. */
  out: boolean
  hasDatedFuture: boolean
  laterSeasons: boolean
  onFinish: () => void
  /** Held: finish with the real dates. */
  onFinishDates: () => void
  onRate: () => void
  onSlot: () => void
  onGoOnAir: () => void
}) {
  const me = useMe()
  const btn = 'tv-btn tv-osd px-3 py-2.5 text-[17px]'
  const finishHold = useHold(onFinish, onFinishDates)
  const nextSeason = remainingEpisodes(show)[0]?.season ?? show.plan_from
  // Nothing out yet: nothing to start. It waits in the lineup and comes on
  // when the first episode airs.
  const waiting = (
    <span
      className="tv-osd grid place-items-center rounded-[12px] border border-dashed px-3 py-2.5 text-center text-[17px]"
      style={{ borderColor: 'var(--tv-line)', color: 'var(--tv-faint)' }}
    >
      ⏳ {show.stage === 'shelf' ? 'NOT OUT YET' : `WAITING${nextSeason ? ` FOR S${nextSeason}` : ''}`}
    </span>
  )

  if (show.stage === 'shelf') {
    return (
      <div className="grid grid-cols-2 gap-2">
        {out ? (
          <button onClick={() => { startWatching(show, me); onGoOnAir() }} className={`${btn} tv-btn--yellow`}>▶ START</button>
        ) : (
          waiting
        )}
        <button onClick={onSlot} className={btn}>⤵ INTO LINEUP</button>
        <button onClick={() => { markWatchedBefore(show, me); onRate() }} className={`${btn} col-span-2`}>✓ WE'VE ALREADY SEEN IT</button>
      </div>
    )
  }
  if (show.stage === 'lineup') {
    return (
      <div className="grid grid-cols-2 gap-2">
        {out ? (
          <button onClick={() => { startWatching(show, me); onGoOnAir() }} className={`${btn} tv-btn--yellow`}>▶ START NOW</button>
        ) : (
          waiting
        )}
        <button onClick={() => { playNext(show, me); toast('Next up') }} className={btn}>⏭ PLAY NEXT</button>
        <button onClick={() => moveToShelf(show, show.shelf_owner, me)} className={btn}>↩ BACK TO SHELF</button>
        <button onClick={() => { markWatchedBefore(show, me); onRate() }} className={btn}>✓ SEEN IT</button>
      </div>
    )
  }
  if (show.stage === 'watching') {
    return (
      <div className="grid grid-cols-2 gap-2">
        <button {...finishHold} className={`${btn} tv-hold tv-btn--yellow col-span-2 flex-col gap-0`}>
          <span>🏁 FINISHED SEASON {show.current_season}</span>
          <span className="text-[12px] opacity-70">HOLD TO PICK DATES</span>
        </button>
        <button onClick={() => pauseShow(show, me)} className={btn}>⏸ PAUSE</button>
        <button onClick={() => { markWatched(show, me); onRate() }} className={btn}>✓ CALL IT WATCHED</button>
        <button onClick={() => dropShow(show, me)} className={`${btn} col-span-2`} style={{ color: 'var(--tv-red)' }}>✕ DROP IT</button>
      </div>
    )
  }
  if (show.stage === 'watched') {
    return (
      <div className="grid grid-cols-2 gap-2">
        <button onClick={onRate} className={`${btn} tv-btn--yellow ${laterSeasons ? '' : 'col-span-2'}`}>★ RATINGS</button>
        {laterSeasons && (
          <button onClick={() => { queueNextSeason(show, me); onGoOnAir() }} className={btn}>
            + NEXT SEASON{hasDatedFuture ? ' (AIRING)' : ''}
          </button>
        )}
      </div>
    )
  }
  return (
    <div className="grid grid-cols-2 gap-2">
      <button onClick={() => { startWatching(show, me); onGoOnAir() }} className={`${btn} tv-btn--yellow`}>▶ ANOTHER GO</button>
      <button onClick={() => moveToShelf(show, show.shelf_owner, me)} className={btn}>↩ BACK TO SHELF</button>
    </div>
  )
}

/** Which seasons this slot covers, and whether it's watched as it airs. */
function PlanControls({ show, hasDatedFuture }: { show: WatchShow; hasDatedFuture: boolean }) {
  const me = useMe()
  const seasons = [...new Set(allEpisodes(show).map((e) => e.season))].sort((a, b) => a - b)
  if (seasons.length === 0) return null
  const first = seasons[0]
  const last = seasons[seasons.length - 1]
  const from = show.stage === 'watching' ? (show.current_season ?? first) : (show.plan_from ?? first)
  const to = show.plan_to ?? last
  const lockFrom = show.stage === 'watching'

  return (
    <div className="tv-card flex flex-col gap-3 px-3 py-3">
      {/* Waiting on a season past everything listed: nothing to pick from yet. */}
      {seasons.length > 1 && from <= last && (
        <div className="flex items-center gap-2">
          <span className="tv-osd w-20 text-[15px]" style={{ color: 'var(--tv-faint)' }}>
            SEASONS
          </span>
          <Stepper
            value={from}
            min={first}
            max={to}
            disabled={lockFrom}
            onChange={(v) => setPlan(show, v, show.plan_to, me)}
          />
          <span className="tv-osd text-[16px]" style={{ color: 'var(--tv-faint)' }}>
            TO
          </span>
          <Stepper value={to} min={from} max={last} onChange={(v) => setPlan(show, show.plan_from, v === last ? null : v, me)} />
        </div>
      )}
      {(hasDatedFuture || show.live) && (
        <button
          onClick={() => setLive(show, !show.live, me)}
          className="flex items-center justify-between gap-3 text-left"
          role="switch"
          aria-checked={show.live}
        >
          <span>
            <span className="tv-osd block text-[17px]">{show.live ? 'WATCHING AS IT AIRS' : 'BINGE IT WHEN IT’S OUT'}</span>
            <span className="block text-[12px]" style={{ color: 'var(--tv-dim)' }}>
              {show.live
                ? 'Each episode on the day it drops, alongside whatever else is on.'
                : 'Waits its turn in the lineup, then all at once.'}
            </span>
          </span>
          <span className="tv-led shrink-0" data-on={show.live} style={{ width: 12, height: 12 }} />
        </button>
      )}
    </div>
  )
}

function Stepper({
  value,
  min,
  max,
  disabled = false,
  onChange,
}: {
  value: number
  min: number
  max: number
  disabled?: boolean
  onChange: (v: number) => void
}) {
  return (
    <span className="flex items-center rounded-lg" style={{ boxShadow: 'inset 0 0 0 1px var(--tv-line)' }}>
      <button
        disabled={disabled || value <= min}
        onClick={() => onChange(value - 1)}
        className="tv-osd grid h-8 w-8 place-items-center text-[20px] disabled:opacity-30"
        aria-label="Earlier season"
      >
        −
      </button>
      <span className="tv-osd tv-yellow w-7 text-center text-[19px]">{value}</span>
      <button
        disabled={disabled || value >= max}
        onClick={() => onChange(value + 1)}
        className="tv-osd grid h-8 w-8 place-items-center text-[20px] disabled:opacity-30"
        aria-label="Later season"
      >
        +
      </button>
    </span>
  )
}
