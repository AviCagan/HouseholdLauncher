import { useMemo, useState } from 'react'
import { fire } from '@/lib/haptics'
import type { WatchShow } from '@/data/types'
import { useWatched } from './useWatched'
import { usePeople, useWatchUI, type Person } from './store'
import { Face, NoSignal, Poster, SectionHead } from './ui'
import { formatScore, rankSeasons, rankShows, waitingSeasons, waitingShows, type RankBy, type Scores, type Waiting } from './ratings'
import { isSingleSeason, yearsLabel } from './model'
import { Patterns } from './Patterns'

/**
 * Channel 3: Watched. Everything you've finished, ranked — by the two of you
 * together, or by either one — as whole shows or season by season.
 */
export function WatchedTab() {
  const { shows, ratings } = useWatched()
  const people = usePeople()
  const open = useWatchUI((s) => s.open)
  const [unit, setUnit] = useState<'shows' | 'seasons' | 'patterns'>('shows')
  const [by, setBy] = useState<RankBy>('together')
  const [showDropped, setShowDropped] = useState(false)

  const everyone = useMemo(() => people.map((p) => p.id), [people])
  const rankedShows = useMemo(() => rankShows(shows, ratings, by, everyone), [shows, ratings, by, everyone])
  const rankedSeasons = useMemo(() => rankSeasons(shows, ratings, by, everyone), [shows, ratings, by, everyone])
  // Left out of the together ranking until both have scored them.
  const waiting = useMemo(
    () =>
      by !== 'together' ? [] : unit === 'shows' ? waitingShows(shows, ratings, everyone) : waitingSeasons(shows, ratings, everyone),
    [by, unit, shows, ratings, everyone],
  )
  const bothNone = by === 'together' && waiting.length > 0
  const dropped = shows.filter((s) => s.stage === 'dropped')

  const addPast = () => {
    fire('tap')
    open({ kind: 'search', preset: { kind: 'watched', throughSeason: null } })
  }

  return (
    <div className="flex flex-col px-3 pb-8 pt-3">
      <div className="flex gap-2">
        <Toggle
          options={[
            { id: 'shows', label: 'SHOWS' },
            { id: 'seasons', label: 'SEASONS' },
            { id: 'patterns', label: 'PATTERNS' },
          ]}
          value={unit}
          onChange={(v) => setUnit(v as 'shows' | 'seasons' | 'patterns')}
        />
      </div>
      {unit === 'patterns' ? (
        <div className="mt-3">
          <Patterns />
        </div>
      ) : (
        <>
          <div className="scroll-x -mx-3 mt-2 flex gap-2 px-3">
            <ByChip on={by === 'together'} onClick={() => setBy('together')}>
              ★ TOGETHER
            </ByChip>
            {people.map((p) => (
              <ByChip key={p.id} on={by === p.id} onClick={() => setBy(p.id)} color={p.color}>
                {p.emoji} {p.name.toUpperCase()}
              </ByChip>
            ))}
          </div>

          <SectionHead
            right={
              <button onClick={addPast} className="tv-osd text-[15px]" style={{ color: 'var(--tv-yellow)' }}>
                + ADD PAST SHOW
              </button>
            }
          >
            {unit === 'shows' ? '★ THE RATINGS' : '★ BEST SEASONS'}
          </SectionHead>

          {unit === 'shows' ? (
            rankedShows.length === 0 ? (
              <NoSignal
                title={bothNone ? 'Nothing you both rated' : 'No ratings yet'}
                hint={
                  bothNone
                    ? 'Shows land here once you both score them. The ones waiting are below.'
                    : "Finish something, or add the shows you've already watched to rate them."
                }
                action={
                  <button onClick={addPast} className="tv-btn tv-btn--yellow tv-osd px-4 py-2.5 text-[17px]">
                    + ADD SOMETHING WE'VE WATCHED
                  </button>
                }
              />
            ) : (
              <div className="flex flex-col gap-2">
                {rankedShows.map((r) => (
                  <RankRow
                    key={r.show.id}
                    show={r.show}
                    rank={r.rank}
                    scores={r.scores}
                    people={people}
                    note={yearsLabel(r.show)}
                    onOpen={() => open({ kind: 'show', showId: r.show.id })}
                    onRate={() => open({ kind: 'rate', showId: r.show.id, seasons: [], includeShow: true })}
                  />
                ))}
              </div>
            )
          ) : rankedSeasons.length === 0 ? (
            <NoSignal
              title={bothNone ? 'No seasons you both rated' : 'No season scores'}
              hint={bothNone ? 'The ones waiting on a score are below.' : 'Seasons get a score when you finish them.'}
            />
          ) : (
            <div className="flex flex-col gap-2">
              {rankedSeasons.map((r) => (
                <RankRow
                  key={`${r.show.id}:${r.season}`}
                  show={r.show}
                  rank={r.rank}
                  scores={r.scores}
                  people={people}
                  note={isSingleSeason(r.show) ? 'ITS ONLY SEASON' : `SEASON ${r.season}`}
                  onOpen={() => open({ kind: 'show', showId: r.show.id })}
                  onRate={() => open({ kind: 'rate', showId: r.show.id, seasons: [r.season], includeShow: false })}
                />
              ))}
            </div>
          )}

          {waiting.length > 0 && (
            <>
              <SectionHead>⏳ WAITING ON A SCORE</SectionHead>
              <p className="-mt-1 px-1 pb-2 text-[12.5px]" style={{ color: 'var(--tv-faint)' }}>
                Not in the together ranking until you've both rated them.
              </p>
              <div className="flex flex-col gap-2">
                {waiting.map((w) => (
                  <RankRow
                    key={`${w.show.id}:${w.season}`}
                    show={w.show}
                    rank={null}
                    scores={w.scores}
                    people={people}
                    note={waitingNote(w, people)}
                    waitingOn
                    onOpen={() => open({ kind: 'show', showId: w.show.id })}
                    onRate={() =>
                      open(
                        w.season === 0
                          ? { kind: 'rate', showId: w.show.id, seasons: [], includeShow: true }
                          : { kind: 'rate', showId: w.show.id, seasons: [w.season], includeShow: false },
                      )
                    }
                  />
                ))}
              </div>
            </>
          )}
        </>
      )}

      {dropped.length > 0 && (
        <>
          <SectionHead
            right={
              <button
                onClick={() => setShowDropped((v) => !v)}
                className="tv-osd text-[15px]"
                style={{ color: 'var(--tv-dim)' }}
              >
                {showDropped ? 'HIDE' : `SHOW ${dropped.length}`}
              </button>
            }
          >
            ✕ DROPPED
          </SectionHead>
          {showDropped && (
            <div className="flex flex-col gap-2">
              {dropped.map((show) => (
                <button
                  key={show.id}
                  onClick={() => open({ kind: 'show', showId: show.id })}
                  className="tv-card flex items-center gap-3 p-2 text-left opacity-70"
                >
                  <Poster url={show.poster_url} title={show.title} className="h-[54px] w-[36px] shrink-0" />
                  <span className="truncate text-[14px] font-semibold">{show.title}</span>
                </button>
              ))}
            </div>
          )}
        </>
      )}
    </div>
  )
}

/** "NEEDS JACKIE'S SCORE", "SEASON 2 · NEEDS BOTH SCORES". */
function waitingNote(w: Waiting, people: Person[]): string {
  const names = w.missing.map((id) => people.find((p) => p.id === id)?.name.toUpperCase() ?? '?')
  const who = names.length === people.length ? 'NEEDS BOTH SCORES' : `NEEDS ${names.join(' & ')}'S SCORE`
  return w.season === 0 || isSingleSeason(w.show) ? who : `SEASON ${w.season} · ${who}`
}

function RankRow({
  show,
  rank,
  scores,
  people,
  note,
  waitingOn = false,
  onOpen,
  onRate,
}: {
  show: WatchShow
  rank: number | null
  scores: Scores
  people: Person[]
  note: string
  /** Not everyone has scored it: no together number, just the button. */
  waitingOn?: boolean
  onOpen: () => void
  onRate: () => void
}) {
  return (
    <div className="tv-card flex items-center gap-2.5 p-2">
      <span
        className={`tv-osd w-9 shrink-0 text-center ${rank === 1 ? 'tv-yellow' : ''}`}
        style={{ fontSize: rank !== null && rank < 10 ? 30 : 22, color: rank === null ? 'var(--tv-faint)' : undefined }}
      >
        {rank ?? '–'}
      </span>
      <button
        onClick={() => {
          fire('tap')
          onOpen()
        }}
        className="flex min-w-0 flex-1 items-center gap-2.5 text-left"
      >
        <Poster url={show.poster_url} title={show.title} className="h-[66px] w-[44px] shrink-0" />
        <span className="min-w-0 flex-1">
          <span className="block truncate text-[14.5px] font-bold">{show.title}</span>
          <span className="tv-osd block text-[13px]" style={{ color: 'var(--tv-faint)' }}>
            {note}
          </span>
          <span className="mt-1 flex flex-wrap items-center gap-x-2.5 gap-y-1">
            {people.map((p) => (
              <span key={p.id} className="flex items-center gap-1">
                <Face emoji={p.emoji} avatar={p.avatar} color={p.color} size={16} />
                <span className="tv-osd text-[15px]" style={{ color: scores.byPerson.has(p.id) ? 'var(--tv-phosphor)' : 'var(--tv-faint)' }}>
                  {formatScore(scores.byPerson.get(p.id) ?? null)}
                </span>
              </span>
            ))}
          </span>
        </span>
      </button>
      {scores.together === null || waitingOn ? (
        <button
          onClick={() => {
            fire('tap')
            onRate()
          }}
          className="tv-btn tv-btn--yellow tv-osd shrink-0 px-2.5 py-2 text-[15px]"
        >
          RATE
        </button>
      ) : (
        <button
          onClick={() => {
            fire('tap')
            onRate()
          }}
          className="flex shrink-0 flex-col items-center px-1"
          aria-label={`Together ${formatScore(scores.together)} out of 10. Change ratings`}
        >
          <span className="tv-osd tv-green text-[30px] leading-none">{formatScore(scores.together)}</span>
          <span className="tv-osd text-[11px]" style={{ color: 'var(--tv-faint)' }}>
            TOGETHER
          </span>
        </button>
      )}
    </div>
  )
}

function Toggle({
  options,
  value,
  onChange,
}: {
  options: { id: string; label: string }[]
  value: string
  onChange: (v: string) => void
}) {
  return (
    <div className="tv-card flex flex-1 gap-1 p-1">
      {options.map((o) => (
        <button
          key={o.id}
          onClick={() => {
            if (o.id === value) return
            fire('snap')
            onChange(o.id)
          }}
          className={`tv-osd flex-1 rounded-[10px] py-2 text-[17px] ${o.id === value ? 'tv-btn tv-btn--cream' : ''}`}
          style={{ color: o.id === value ? undefined : 'var(--tv-dim)' }}
        >
          {o.label}
        </button>
      ))}
    </div>
  )
}

function ByChip({
  on,
  onClick,
  color,
  children,
}: {
  on: boolean
  onClick: () => void
  color?: string
  children: React.ReactNode
}) {
  return (
    <button
      onClick={() => {
        fire('snap')
        onClick()
      }}
      className="tv-osd shrink-0 rounded-full px-3 py-1.5 text-[15px]"
      style={{
        color: on ? '#14100a' : (color ?? 'var(--tv-dim)'),
        background: on ? (color ? `color-mix(in oklab, ${color} 70%, white)` : 'var(--tv-yellow)') : 'var(--tv-card)',
        boxShadow: on ? 'none' : 'inset 0 0 0 1px var(--tv-line)',
      }}
    >
      {children}
    </button>
  )
}
