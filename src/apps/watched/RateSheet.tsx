import { useEffect, useRef, useState } from 'react'
import { motion } from 'motion/react'
import { Sheet } from '@/components/primitives/Sheet'
import { fire } from '@/lib/haptics'
import { useData } from '@/store/useData'
import type { WatchShow } from '@/data/types'
import { markWatched, rate, setPlan, waitForSeason, type FinishOutcome } from './actions'
import { useMe, usePeople, useWatchUI } from './store'
import { Face, OsdBar, Poster } from './ui'
import { average, formatScore, seasonScores, showScores } from './ratings'
import { formatDay, seasonNumbers } from './model'

/**
 * Scoring: after a season, after a show, or for something watched long ago.
 *
 * Both people's bars are on one sheet, because they are usually on one
 * couch with one phone. The other phone gets a notification asking for its
 * score too, so whoever wasn't holding it can add theirs later.
 */
export function RateSheet({
  showId,
  seasons,
  includeShow,
  outcome,
  backfill = false,
}: {
  showId: string
  seasons: number[]
  includeShow: boolean
  outcome?: FinishOutcome
  backfill?: boolean
}) {
  const close = useWatchUI((s) => s.close)
  const setTab = useWatchUI((s) => s.setTab)
  const show = useData((s) => s.watch_shows.find((x) => x.id === showId))
  const me = useMe()
  const decided = useRef(false)
  const [seasonsToo, setSeasonsToo] = useState(false)

  /**
   * Caught up with something still running: wait for the next season, or
   * call it watched for now. Leaving without choosing picks for them — wait
   * when the next season has a date, watched when it doesn't — so the show
   * never sits "playing" a season that's over.
   */
  function decide(choice: 'wait' | 'watched') {
    if (!show || decided.current) return
    decided.current = true
    if (choice === 'wait') {
      waitForSeason(show, outcome?.kind === 'caught-up' ? outcome.next : null, me)
      setTab('onair')
    } else {
      markWatched(show, me)
    }
  }

  function done() {
    if (outcome?.kind === 'caught-up' && !decided.current) decide(outcome.airs ? 'wait' : 'watched')
    close()
  }

  if (!show) {
    return (
      <Sheet open onClose={close}>
        <p className="tv-osd py-10 text-center text-[19px]" style={{ color: 'var(--tv-dim)' }}>
          THIS SHOW WAS TAKEN OFF THE AIR
        </p>
      </Sheet>
    )
  }

  const title =
    outcome?.kind === 'finished'
      ? "THAT'S A WRAP"
      : outcome
        ? `SEASON ${seasons[0]} COMPLETE`
        : backfill
          ? 'RATE IT'
          : 'RATINGS'

  const through = show.plan_to
  const all = seasonNumbers(show)
  const backfillSeasons = all.filter((n) => through === null || n <= through)
  const seasonList = backfill ? (seasonsToo ? backfillSeasons : []) : seasons

  return (
    <Sheet open onClose={done} title={<span className="tv-osd tv-yellow text-[23px]">{title}</span>} maxHeight="92vh">
      <div className="flex flex-col gap-4 pb-6">
        <div className="flex items-center gap-3">
          <Poster url={show.poster_url} title={show.title} className="h-[72px] w-[48px] shrink-0" />
          <div className="min-w-0">
            <p className="tv-glow truncate text-[17px] font-bold">{show.title}</p>
            <OutcomeLine outcome={outcome} />
          </div>
        </div>

        {backfill && all.length > 1 && (
          <div>
            <p className="tv-osd px-1 pb-2 text-[15px]" style={{ color: 'var(--tv-faint)' }}>
              WATCHED THROUGH
            </p>
            <div className="scroll-x -mx-5 flex gap-1.5 px-5">
              {all.map((n) => (
                <button
                  key={n}
                  onClick={() => {
                    fire('snap')
                    setPlan(show, null, n === all[all.length - 1] ? null : n, me)
                  }}
                  className={`tv-osd shrink-0 rounded-lg px-3 py-1.5 text-[17px] ${
                    (through ?? all[all.length - 1]) === n ? 'tv-btn tv-btn--cream' : ''
                  }`}
                  style={{ boxShadow: (through ?? all[all.length - 1]) === n ? undefined : 'inset 0 0 0 1px var(--tv-line)' }}
                >
                  S{n}
                  {n === all[all.length - 1] ? ' · ALL' : ''}
                </button>
              ))}
            </div>
          </div>
        )}

        {seasonList.map((n) => (
          <RateBlock key={n} show={show} season={n} label={`SEASON ${n}`} />
        ))}
        {(includeShow || backfill) && <RateBlock show={show} season={0} label="THE WHOLE SHOW" />}

        {backfill && backfillSeasons.length > 0 && (
          <button
            onClick={() => {
              fire('tap')
              setSeasonsToo((v) => !v)
            }}
            className="tv-osd self-center text-[16px]"
            style={{ color: 'var(--tv-dim)' }}
          >
            {seasonsToo ? '− JUST THE WHOLE SHOW' : '+ RATE EACH SEASON TOO'}
          </button>
        )}

        {outcome?.kind === 'caught-up' && (
          <div className="tv-card flex flex-col gap-2 p-3">
            <p className="tv-osd tv-cyan text-[18px]">📡 CAUGHT UP</p>
            <p className="text-[13px]" style={{ color: 'var(--tv-dim)' }}>
              {outcome.next
                ? outcome.airs
                  ? `Season ${outcome.next} starts ${formatDay(new Date(`${outcome.airs}T12:00:00`))}.`
                  : `Season ${outcome.next} is announced, with no date yet.`
                : "Nothing new announced yet. It'll show up under Returning Soon when it is."}
            </p>
            <div className="grid grid-cols-2 gap-2">
              <button
                onClick={() => {
                  decide('wait')
                  close()
                }}
                className="tv-btn tv-btn--yellow tv-osd px-2 py-2.5 text-[16px]"
              >
                ⏳ WAIT FOR {outcome.next ? `S${outcome.next}` : 'IT'}
              </button>
              <button
                onClick={() => {
                  decide('watched')
                  close()
                }}
                className="tv-btn tv-osd px-2 py-2.5 text-[16px]"
              >
                ✓ WATCHED FOR NOW
              </button>
            </div>
          </div>
        )}

        <button onClick={done} className="tv-btn tv-btn--cream tv-osd mt-1 py-3 text-[19px]">
          DONE
        </button>
      </div>
    </Sheet>
  )
}

function OutcomeLine({ outcome }: { outcome?: FinishOutcome }) {
  if (!outcome) return null
  if (outcome.kind === 'continued') {
    return <p className="tv-osd tv-green text-[17px]">▶ ON TO SEASON {outcome.season}</p>
  }
  if (outcome.kind === 'finished') {
    return <p className="tv-osd tv-amber text-[17px]">🏁 SERIES DONE — SCORE THE SHOW TOO</p>
  }
  return <p className="tv-osd tv-cyan text-[17px]">📡 ALL CAUGHT UP</p>
}

/**
 * One thing to score, with a bar per person. Changes are written a moment
 * after the finger stops, not on every half point a drag passes through.
 */
function RateBlock({ show, season, label }: { show: WatchShow; season: number; label: string }) {
  const ratings = useData((s) => s.watch_ratings)
  const people = usePeople()
  const me = useMe()
  const saved = season === 0 ? showScores(ratings, show.id) : seasonScores(ratings, show.id, season)
  const savedWhole = season === 0 ? new Map([...ratings.filter((r) => r.show_id === show.id && r.season === 0)].map((r) => [r.profile_id, r.score_x2 / 2])) : null
  const [draft, setDraft] = useState<Record<string, number | null>>({})
  const pending = useRef(new Map<string, { value: number | null; timer: ReturnType<typeof setTimeout> }>())

  useEffect(() => {
    const map = pending.current
    return () => {
      // Leaving the sheet mid-drag still saves the last value.
      for (const [person, p] of map) {
        clearTimeout(p.timer)
        rate(show.id, season, person, p.value)
      }
      map.clear()
    }
  }, [show.id, season])

  function change(person: string, value: number | null) {
    setDraft((d) => ({ ...d, [person]: value }))
    const existing = pending.current.get(person)
    if (existing) clearTimeout(existing.timer)
    const timer = setTimeout(() => {
      pending.current.delete(person)
      rate(show.id, season, person, value)
    }, 450)
    pending.current.set(person, { value, timer })
  }

  // The whole-show bar shows what each person actually gave the show, not
  // the seasons' average — that's a derived number, not a rating to edit.
  const valueFor = (id: string): number | null =>
    draft[id] !== undefined ? draft[id] : season === 0 ? (savedWhole?.get(id) ?? null) : (saved.byPerson.get(id) ?? null)
  const together = average(people.map((p) => valueFor(p.id)).filter((v): v is number => v !== null))

  return (
    <motion.div layout className="tv-card flex flex-col gap-3 px-3 py-3">
      <div className="flex items-baseline justify-between">
        <span className="tv-osd tv-amber text-[18px]">{label}</span>
        <span className="tv-osd text-[16px]" style={{ color: 'var(--tv-faint)' }}>
          TOGETHER <span className="tv-green text-[24px]">{formatScore(together)}</span>
        </span>
      </div>
      {people.map((p) => {
        const v = valueFor(p.id)
        return (
          <div key={p.id} className="flex items-center gap-2.5">
            <Face emoji={p.emoji} avatar={p.avatar} color={p.color} size={26} />
            <div className="min-w-0 flex-1">
              <div className="mb-1 flex items-center justify-between">
                <span className="tv-osd text-[15px]" style={{ color: p.id === me ? 'var(--tv-phosphor)' : 'var(--tv-dim)' }}>
                  {p.name.toUpperCase()}
                  {p.id === me ? ' (YOU)' : ''}
                </span>
                {v !== null && (
                  <button
                    onClick={() => change(p.id, null)}
                    className="tv-osd text-[13px]"
                    style={{ color: 'var(--tv-faint)' }}
                    aria-label={`Clear ${p.name}'s score`}
                  >
                    CLEAR
                  </button>
                )}
              </div>
              <OsdBar
                value={v}
                onChange={(next) => change(p.id, next)}
                color={`color-mix(in oklab, ${p.color} 55%, #61ff9a)`}
                label={`${p.name}'s score for ${label.toLowerCase()}`}
              />
            </div>
            <span className="tv-osd w-11 text-right text-[26px]" style={{ color: v === null ? 'var(--tv-faint)' : 'var(--tv-phosphor)' }}>
              {formatScore(v)}
            </span>
          </div>
        )
      })}
    </motion.div>
  )
}
