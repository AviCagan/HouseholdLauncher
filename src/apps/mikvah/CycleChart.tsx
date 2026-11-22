import { useState } from 'react'
import type { CycleRow } from './history'
import { dateBoth } from './format'
import { stats } from './history'

/**
 * Cycle lengths as bars, oldest to newest. One series, so no legend box —
 * the section title names it. Thin bars with a 2px gap, rounded only at the
 * top and anchored to the baseline; a faint grid; a tooltip on each bar.
 * The History list below is the table view of the same numbers.
 */
export function CycleChart({ rows }: { rows: CycleRow[] }) {
  const data = rows.filter((r) => r.length !== null).slice(-24)
  const [hover, setHover] = useState<number | null>(null)
  if (data.length === 0) return <p className="mk-dim text-[13px]">The chart appears once two periods are logged.</p>

  const W = 320
  const H = 150
  const pad = { l: 24, r: 6, t: 10, b: 18 }
  const max = Math.max(40, Math.ceil(Math.max(...data.map((d) => d.length!)) / 10) * 10)
  const innerW = W - pad.l - pad.r
  const innerH = H - pad.t - pad.b
  const slot = innerW / data.length
  const barW = Math.max(3, Math.min(18, slot - 2))
  const y = (v: number) => pad.t + innerH - (v / max) * innerH
  const avg = stats(data.map((d) => d.length)).average
  const ticks = Array.from({ length: max / 10 + 1 }, (_, i) => i * 10)
  const h = hover !== null ? data[hover] : null

  return (
    <div className="relative">
      <svg viewBox={`0 0 ${W} ${H}`} className="block w-full" role="img" aria-label={`Cycle lengths for the last ${data.length} cycles; average ${avg} days`}>
        {ticks.map((t) => (
          <g key={t}>
            <line x1={pad.l} x2={W - pad.r} y1={y(t)} y2={y(t)} stroke="var(--border)" strokeWidth={1} />
            <text x={pad.l - 4} y={y(t) + 3} textAnchor="end" fontSize={9} fill="var(--text-faint)">
              {t}
            </text>
          </g>
        ))}
        {data.map((d, i) => {
          const x = pad.l + i * slot + (slot - barW) / 2
          const top = y(d.length!)
          const r = Math.min(4, barW / 2, pad.t + innerH - top)
          const base = pad.t + innerH
          return (
            <g key={d.id}>
              <path
                d={`M${x},${base} L${x},${top + r} Q${x},${top} ${x + r},${top} L${x + barW - r},${top} Q${x + barW},${top} ${x + barW},${top + r} L${x + barW},${base} Z`}
                fill="var(--mk-bar)"
                opacity={hover === null || hover === i ? 1 : 0.45}
              />
              {/* A hit target wider and taller than the bar. */}
              <rect
                x={pad.l + i * slot}
                y={pad.t}
                width={slot}
                height={innerH}
                fill="transparent"
                onPointerEnter={() => setHover(i)}
                onPointerLeave={() => setHover(null)}
                onClick={() => setHover(hover === i ? null : i)}
              />
            </g>
          )
        })}
        {avg !== null && (
          <g>
            <line x1={pad.l} x2={W - pad.r} y1={y(avg)} y2={y(avg)} stroke="var(--text-dim)" strokeWidth={1} strokeDasharray="3 3" />
            <text x={W - pad.r} y={y(avg) - 3} textAnchor="end" fontSize={9} fill="var(--text-dim)">
              avg {avg}
            </text>
          </g>
        )}
      </svg>
      {h && (
        <div
          className="mk-card pointer-events-none absolute top-0 px-3 py-2 text-[12px] shadow-lg"
          style={{ left: `${Math.min(70, Math.max(0, ((hover! + 0.5) / data.length) * 100 - 15))}%`, background: 'var(--bg-elevated)' }}
        >
          <p className="font-semibold">{h.length} days</p>
          <p className="mk-dim">From {dateBoth(h.day1)}</p>
        </div>
      )}
    </div>
  )
}
