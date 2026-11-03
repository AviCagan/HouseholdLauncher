import { useMemo } from 'react'
import type { MsPractice } from '@/data/types'
import { calendarOf, currentPhase, daysBetween, feeSteps, phaseProgress, shortDay, studyPhases, weekdayDay, type Anchors, type Day } from './dates'
import { useMs, useMsUI, usePractice } from './store'
import { Chip, Lines, Panel, Trail } from './ui'
import { scorePlan } from './labels'

/** The test itself: the date, what changing it costs, the run-up, the scores. */
export function McatTab() {
  const { settings, anchors, today, views } = useMs()
  const open = useMsUI((s) => s.open)
  const ref = settings?.reference ?? {}
  const row = calendarOf(ref).find((r) => r.testDate === settings?.test_date)
  const lightStart = views.find((v) => v.task.id === 't-mcat-light')?.due ?? null
  const phases = useMemo(() => (anchors ? studyPhases(anchors, lightStart, ref.studyBlocks) : []), [anchors, lightStart, ref.studyBlocks])
  const now = currentPhase(phases, today)
  const plan = scorePlan(views.find((v) => v.task.id === 'm-decide')?.task.note ?? null)

  return (
    <div className="flex flex-col gap-3 pb-6">
      <Panel
        title="Test date"
        rez={0}
        edge="live"
        action={
          <button type="button" className="lg-btn lg-btn--small" onClick={() => open({ kind: 'date' })}>
            Change
          </button>
        }
      >
        {settings?.test_date ? (
          <div className="flex flex-wrap items-end gap-3">
            <span className="lg-display text-[26px] leading-none text-[var(--lg-ice)]">{weekdayDay(settings.test_date)}</span>
            <Chip tone={settings.booked ? 'ok' : 'warn'}>{settings.booked ? 'Booked' : 'Not booked'}</Chip>
            {settings.order_number && <span className="lg-num lg-dim text-[11.5px]">Order {settings.order_number}</span>}
          </div>
        ) : (
          <p className="lg-dim text-[13.5px]">No test date yet. Pick one to work out every date that hangs off it.</p>
        )}
        {row && anchors && (
          <dl className="mt-4 grid grid-cols-2 gap-x-3 gap-y-2.5 sm:grid-cols-4">
            <Fact label="Scores out" day={anchors.score} today={today} />
            <Fact label="60-day" day={row.deadline60} today={today} />
            <Fact label="30-day" day={row.deadline30} today={today} />
            <Fact label="10-day" day={row.deadline10} today={today} />
          </dl>
        )}
      </Panel>

      {row && (
        <Panel title="If you need to change it" rez={1}>
          <ul className="flex flex-col">
            {feeSteps(row, ref.mcatFees).map((s, i) => {
              const live = (s.from === null || s.from <= today) && (s.until === null || today <= s.until)
              return (
                <li key={i} className="lg-rule flex items-start gap-3 py-2.5 first:border-t-0">
                  <span className={`lg-num w-[104px] shrink-0 text-[12px] ${live ? 'lg-live' : 'lg-dim'}`}>
                    {s.from === null ? `until ${shortDay(s.until!)}` : s.until === null ? `after ${shortDay(row.deadline10)}` : `${shortDay(s.from)} – ${shortDay(s.until)}`}
                  </span>
                  <span className="min-w-0 flex-1 text-[13.5px] leading-snug">{s.label}</span>
                  {live && <Chip tone="live">now</Chip>}
                </li>
              )
            })}
          </ul>
        </Panel>
      )}

      {phases.length > 0 && (
        <Panel title="Study phases" rez={2}>
          <ol className="flex flex-col">
            {phases.map((p) => {
              const on = now?.id === p.id
              const past = p.end < today
              return (
                <li key={p.id} className="lg-rule py-2.5 first:border-t-0" style={on ? { borderColor: 'var(--lg-cyan)' } : undefined}>
                  <div className="flex items-baseline gap-3">
                    <span className={`min-w-0 flex-1 text-[13.5px] ${on ? 'lg-live font-medium' : past ? 'lg-dim' : ''}`}>{p.label}</span>
                    <span className="lg-num lg-dim shrink-0 text-[11.5px]">
                      {p.start === null ? `to ${shortDay(p.end)}` : p.start === p.end ? shortDay(p.end) : `${shortDay(p.start)} – ${shortDay(p.end)}`}
                    </span>
                  </div>
                  {on && (
                    <div className="mt-2">
                      <Trail value={phaseProgress(p, today)} max={1} label={`Through ${p.label}`} />
                    </div>
                  )}
                  {p.focus && <p className="lg-dim mt-1 text-[12.5px] leading-snug">{p.focus}</p>}
                </li>
              )
            })}
          </ol>
        </Panel>
      )}

      <PracticePanel anchors={anchors} target={settings?.target_score ?? null} />

      {plan && (
        <Panel title="Score day: plan A, B or C" rez={4}>
          <div className="flex flex-col gap-2.5">
            {plan.map((p) => (
              <div key={p.letter} className="flex gap-3">
                <span className="lg-display lg-live w-5 shrink-0 text-[18px] leading-tight">{p.letter}</span>
                <p className="min-w-0 flex-1 text-[13.5px] leading-snug">{p.text}</p>
              </div>
            ))}
          </div>
        </Panel>
      )}

      <div className="grid gap-3 lg:grid-cols-2">
        {(ref.testDayRules?.length ?? 0) > 0 && (
          <Panel title="Test day" rez={5}>
            <Lines items={ref.testDayRules!} />
          </Panel>
        )}
        {((ref.resources?.length ?? 0) > 0 || (ref.studyMethod?.length ?? 0) > 0) && (
          <Panel title="How to study" rez={6}>
            {ref.studyMethod && <Lines items={ref.studyMethod} />}
            {ref.resources && (
              <>
                <p className="lg-label mb-2 mt-4 !text-[10.5px]">Resources</p>
                <Lines items={ref.resources} />
              </>
            )}
          </Panel>
        )}
      </div>
    </div>
  )
}

function Fact({ label, day, today }: { label: string; day: Day; today: Day }) {
  const gone = day < today
  return (
    <div>
      <dt className="lg-label !text-[10px]">{label}</dt>
      <dd className={`lg-num mt-0.5 text-[13.5px] ${gone ? 'lg-dim line-through' : ''}`}>{shortDay(day)}</dd>
    </div>
  )
}

function PracticePanel({ anchors, target }: { anchors: Anchors | null; target: number | null }) {
  const tests = usePractice()
  const open = useMsUI((s) => s.open)
  return (
    <Panel
      title="Practice tests"
      rez={3}
      action={
        <button type="button" className="lg-btn lg-btn--small lg-btn--primary" onClick={() => open({ kind: 'practice', practiceId: null })}>
          Add score
        </button>
      }
    >
      <ScoreChart tests={tests} target={target} goNoGo={anchors?.fl ?? null} />
      {tests.length === 0 ? (
        <p className="lg-dim mt-2 text-[13px]">
          No scores yet. {anchors ? `The first AAMC full-length on ${shortDay(anchors.fl)} is the go/no-go.` : ''}
          {target ? '' : ' Set a target score in settings to draw the target line.'}
        </p>
      ) : (
        <ul className="mt-2">
          {[...tests].reverse().map((t) => (
            <li key={t.id} className="lg-rule first:border-t-0">
              <button type="button" className="flex min-h-[48px] w-full items-center gap-3 py-1.5 text-left" onClick={() => open({ kind: 'practice', practiceId: t.id })}>
                <span className="lg-num lg-dim w-[52px] shrink-0 text-[12px]">{shortDay(t.taken_on)}</span>
                <span className="min-w-0 flex-1 truncate text-[13.5px]">{t.source ?? 'Practice test'}</span>
                <span className="lg-num lg-dim hidden text-[11px] sm:inline">{[t.cp, t.cars, t.bb, t.ps].map((s) => s ?? '—').join(' · ')}</span>
                <span className={`lg-num text-[15px] ${target && t.total && t.total >= target ? 'lg-live' : ''}`}>{t.total ?? '—'}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </Panel>
  )
}

/** Totals over time, with the target as a line and the go/no-go date marked. */
function ScoreChart({ tests, target, goNoGo }: { tests: MsPractice[]; target: number | null; goNoGo: Day | null }) {
  const scored = tests.filter((t) => t.total !== null)
  const W = 320
  const H = 140
  const pad = { l: 30, r: 8, t: 10, b: 18 }
  if (scored.length === 0 && !target) return null
  const values = [...scored.map((t) => t.total!), ...(target ? [target] : [])]
  const lo = Math.max(472, Math.floor((Math.min(...values) - 4) / 2) * 2)
  const hi = Math.min(528, Math.ceil((Math.max(...values) + 4) / 2) * 2)
  const days = [...scored.map((t) => t.taken_on), ...(goNoGo ? [goNoGo] : [])].sort()
  const first = days[0]
  const last = days[days.length - 1]
  const span = first && last ? Math.max(1, daysBetween(first, last)) : 1
  const x = (d: Day) => pad.l + ((W - pad.l - pad.r) * (first ? daysBetween(first, d) : 0)) / span
  const y = (v: number) => pad.t + ((H - pad.t - pad.b) * (hi - v)) / Math.max(1, hi - lo)
  const line = scored.map((t, i) => `${i ? 'L' : 'M'}${x(t.taken_on).toFixed(1)} ${y(t.total!).toFixed(1)}`).join(' ')
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="block w-full" role="img" aria-label={`Practice totals${target ? `, target ${target}` : ''}`}>
      {[lo, Math.round((lo + hi) / 2), hi].map((v) => (
        <g key={v}>
          <line x1={pad.l} x2={W - pad.r} y1={y(v)} y2={y(v)} stroke="#123a5e" strokeWidth="0.6" />
          <text x={pad.l - 4} y={y(v) + 3} textAnchor="end" fontSize="8.5" fill="#86a8c4" fontFamily="JetBrains Mono, monospace">
            {v}
          </text>
        </g>
      ))}
      {target && (
        <g>
          <line x1={pad.l} x2={W - pad.r} y1={y(target)} y2={y(target)} stroke="#41e3ff" strokeWidth="1" strokeDasharray="4 3" />
          <text x={W - pad.r} y={y(target) - 3} textAnchor="end" fontSize="8.5" fill="#41e3ff" fontFamily="JetBrains Mono, monospace">
            target {target}
          </text>
        </g>
      )}
      {goNoGo && scored.length > 0 && (
        <g>
          <line x1={x(goNoGo)} x2={x(goNoGo)} y1={pad.t} y2={H - pad.b} stroke="#ff7a1f" strokeWidth="0.8" strokeDasharray="2 3" />
          <text x={x(goNoGo)} y={H - 6} textAnchor="middle" fontSize="8" fill="#ff7a1f" fontFamily="JetBrains Mono, monospace">
            go/no-go
          </text>
        </g>
      )}
      {scored.length > 1 && <path d={line} fill="none" stroke="#2a7dff" strokeWidth="2" />}
      {scored.map((t) => (
        <circle key={t.id} cx={x(t.taken_on)} cy={y(t.total!)} r="3" fill="#e6fbff" style={{ filter: 'drop-shadow(0 0 2px #41e3ff)' }} />
      ))}
    </svg>
  )
}
