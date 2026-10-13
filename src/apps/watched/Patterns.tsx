import { useMemo, useState } from 'react'
import { fire } from '@/lib/haptics'
import { useWatched } from './useWatched'
import { useWatchUI } from './store'
import { NoSignal, Poster, SectionHead, Stat } from './ui'
import { MIN_RUNS, type WatchRun } from './insights'
import { formatScore } from './ratings'
import { formatHours, formatSpan, perWeek } from './model'

/**
 * Watched → Patterns: does how much they like a show change how fast they
 * watch it? A scatter of score against speed, the answer in a sentence, and
 * every season behind it in a list.
 */

/** The dots: a green deep enough to sit on the screen without glaring (validated against it). */
const DOT = '#33a866'
const SURFACE = '#0c141c'

export function Patterns() {
  const { runs, pattern } = useWatched()
  const open = useWatchUI((s) => s.open)
  const rated = pattern.points
  const toGo = Math.max(0, MIN_RUNS - rated.length)

  if (runs.length === 0) {
    return (
      <NoSignal
        title="No patterns yet"
        hint="Finish a season and rate it. After a few, this shows how long things take you — and whether the ones you love go faster."
      />
    )
  }

  const r = pattern.r
  const headline =
    r === null
      ? null
      : r >= 0.3
        ? 'THE BETTER IT IS, THE FASTER YOU WATCH'
        : r <= -0.3
          ? 'YOU TAKE YOUR TIME WITH THE GOOD ONES'
          : "SPEED DOESN'T TRACK THE SCORE"
  const top = Math.max(...rated.map((p) => p.score!))
  const factor = r === null ? 1 : pattern.factor(top)

  return (
    <div className="flex flex-col gap-3">
      {headline ? (
        <div className="tv-card px-3 py-2.5">
          <p className="tv-osd tv-amber text-[19px] leading-tight">{headline}</p>
          <p className="mt-1 text-[12.5px] leading-snug" style={{ color: 'var(--tv-dim)' }}>
            From {rated.length} rated seasons. {Math.abs(factor - 1) >= 0.05
              ? `It's in your estimates: a show you've rated ${formatScore(top)} so far is timed at about ${Math.round(factor * 10) / 10}× your pace.`
              : 'Not strong enough to change any estimates yet.'}
          </p>
        </div>
      ) : (
        <p className="tv-osd text-[16px]" style={{ color: 'var(--tv-dim)' }}>
          RATE {toGo} MORE FINISHED SEASON{toGo === 1 ? '' : 'S'} TO SEE A PATTERN
        </p>
      )}

      {pattern.loved && pattern.meh && (
        <div className="grid grid-cols-2 gap-2">
          <Stat label={`RATED ABOVE ${formatScore(pattern.loved.cutoff)}`} value={perWeek(pattern.loved.hoursPerWeek).replace(' a week', '/WK').toUpperCase()} sub={`${pattern.loved.count} seasons`} />
          <Stat label={`${formatScore(pattern.meh.cutoff)} OR BELOW`} value={perWeek(pattern.meh.hoursPerWeek).replace(' a week', '/WK').toUpperCase()} sub={`${pattern.meh.count} seasons`} />
        </div>
      )}

      {rated.length > 0 && <Scatter points={rated} />}

      <SectionHead>⏱ HOW LONG EACH TOOK</SectionHead>
      <div className="flex flex-col gap-2">
        {[...runs]
          .sort((a, b) => b.hoursPerWeek - a.hoursPerWeek)
          .map((run) => (
            <button
              key={`${run.show.id}:${run.season}`}
              onClick={() => {
                fire('tap')
                open({ kind: 'show', showId: run.show.id })
              }}
              className="tv-card flex items-center gap-3 p-2 text-left"
            >
              <Poster url={run.show.poster_url} title={run.show.title} className="h-[54px] w-[36px] shrink-0" />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[14px] font-semibold">
                  {run.show.title} <span style={{ color: 'var(--tv-faint)' }}>S{run.season}</span>
                </span>
                <span className="block text-[12px]" style={{ color: 'var(--tv-dim)' }}>
                  {formatSpan(run.days)} · {formatHours(run.minutes)} · {perWeek(run.hoursPerWeek)}
                </span>
              </span>
              <span className="tv-osd tv-green shrink-0 text-[20px]">{run.score === null ? '–' : `★${formatScore(run.score)}`}</span>
            </button>
          ))}
      </div>
    </div>
  )
}

/** Score across, hours a week up; tap a dot for the season. */
function Scatter({ points }: { points: WatchRun[] }) {
  const [picked, setPicked] = useState<WatchRun | null>(null)
  const W = 340
  const H = 210
  const L = 40
  const R = 10
  const T = 12
  const B = 30

  const geo = useMemo(() => {
    const scores = points.map((p) => p.score!)
    const xMin = Math.max(0, Math.floor(Math.min(...scores)) - 1)
    const xMax = 10
    const yTop = niceTop(Math.max(...points.map((p) => p.hoursPerWeek)) * 1.1)
    const x = (s: number) => L + ((s - xMin) / (xMax - xMin)) * (W - L - R)
    const y = (h: number) => T + (1 - h / yTop) * (H - T - B)
    const xTicks: number[] = []
    for (let s = Math.ceil(xMin); s <= xMax; s++) if ((xMax - xMin <= 6 || s % 2 === 0) && s > xMin) xTicks.push(s)
    const yTicks = [0, yTop / 2, yTop]

    // The trend, fitted the way the pattern is: log(speed) on score.
    let trend: string | null = null
    if (points.length >= MIN_RUNS) {
      const xs = scores
      const ys = points.map((p) => Math.log(p.hoursPerWeek))
      const n = xs.length
      const mx = xs.reduce((t, v) => t + v, 0) / n
      const my = ys.reduce((t, v) => t + v, 0) / n
      const sxx = xs.reduce((t, v) => t + (v - mx) ** 2, 0)
      if (sxx > 0) {
        const b = xs.reduce((t, v, i) => t + (v - mx) * (ys[i] - my), 0) / sxx
        const a = my - b * mx
        const lo = Math.min(...xs)
        const hi = Math.max(...xs)
        trend = Array.from({ length: 21 }, (_, i) => {
          const s = lo + ((hi - lo) * i) / 20
          return `${x(s).toFixed(1)},${y(Math.min(yTop, Math.exp(a + b * s))).toFixed(1)}`
        }).join(' ')
      }
    }
    return { x, y, xTicks, yTicks, trend }
  }, [points])

  return (
    <div className="tv-card px-2 pb-2 pt-2.5">
      <p className="tv-osd px-1 text-[15px]" style={{ color: 'var(--tv-faint)' }}>
        SCORE VS. HOW FAST YOU WATCHED IT
      </p>
      <svg viewBox={`0 0 ${W} ${H}`} className="mt-1 block w-full" role="img" aria-label="Each finished season: its score against hours watched a week">
        {geo.yTicks.map((h) => (
          <g key={h}>
            <line x1={L} x2={W - R} y1={geo.y(h)} y2={geo.y(h)} stroke="rgb(150 200 255 / 0.13)" strokeWidth={1} />
            <text x={L - 6} y={geo.y(h) + 4} textAnchor="end" fontSize={11} fill="var(--tv-faint)">
              {h === 0 ? '0' : `${Math.round(h * 10) / 10}h`}
            </text>
          </g>
        ))}
        {geo.xTicks.map((s) => (
          <text key={s} x={geo.x(s)} y={H - B + 16} textAnchor="middle" fontSize={11} fill="var(--tv-faint)">
            {s}
          </text>
        ))}
        <text x={W - R} y={H - 2} textAnchor="end" fontSize={10} fill="var(--tv-faint)">
          SCORE →
        </text>
        {geo.trend && <polyline points={geo.trend} fill="none" stroke="var(--tv-dim)" strokeOpacity={0.55} strokeWidth={2} strokeLinecap="round" />}
        {points.map((p) => {
          const on = picked === p
          return (
            <g key={`${p.show.id}:${p.season}`}>
              <circle cx={geo.x(p.score!)} cy={geo.y(p.hoursPerWeek)} r={on ? 7 : 5} fill={DOT} stroke={on ? 'var(--tv-yellow)' : SURFACE} strokeWidth={2} />
              <circle
                cx={geo.x(p.score!)}
                cy={geo.y(p.hoursPerWeek)}
                r={14}
                fill="transparent"
                style={{ cursor: 'pointer' }}
                onClick={() => {
                  fire('tap')
                  setPicked(on ? null : p)
                }}
                onMouseEnter={() => setPicked(p)}
              >
                <title>{`${p.show.title} S${p.season}: ${formatScore(p.score)} · ${perWeek(p.hoursPerWeek)}`}</title>
              </circle>
            </g>
          )
        })}
      </svg>
      <p className="min-h-[2.6em] px-1 text-[12.5px] leading-snug" style={{ color: 'var(--tv-dim)' }}>
        {picked ? (
          <>
            <span style={{ color: 'var(--tv-phosphor)' }}>
              {picked.show.title} S{picked.season}
            </span>{' '}
            · ★ {formatScore(picked.score)} · {formatSpan(picked.days)} · {perWeek(picked.hoursPerWeek)}
          </>
        ) : (
          'Each dot is a season you finished. Tap one to see which.'
        )}
      </p>
    </div>
  )
}

/** A round top for the axis: 2, 2.5, 5 or 10 times a power of ten. */
function niceTop(v: number): number {
  if (v <= 0) return 1
  const p = 10 ** Math.floor(Math.log10(v))
  for (const m of [1, 2, 2.5, 5, 10]) if (m * p >= v) return m * p
  return 10 * p
}
