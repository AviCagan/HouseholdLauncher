import { useMemo, useState } from 'react'
import { useData } from '@/store/useData'
import { fire } from '@/lib/haptics'
import type { MsExperience, MsExperienceLog, MsExperienceStep, MsLetter } from '@/data/types'
import {
  capWarnings,
  dateSpan,
  experienceTotal,
  formatPartial,
  GROUP_LABEL,
  groupOf,
  KIND_META,
  STATUS_LABEL,
  stepsFor,
  targetTotals,
  type StatusGroup,
  type StepView,
} from './experiences'
import { toggleStep } from './actions'
import { weekdayDay } from './dates'
import { useCounters, useExperiences, useMs, useMsUI } from './store'
import { Chip, Node, Panel, StatusChip, Trail } from './ui'
import { amount, LETTER_LABEL } from './labels'

/**
 * Experiences: one card for everything that counts towards the committee
 * file or the application. The committee's targets sit on top, filled from
 * whichever experiences count towards them; each card has its own total,
 * its cap warnings, its letter and what's left of its onboarding.
 */
export function ExperiencesTab() {
  const experiences = useExperiences()
  const logs = useData((s) => s.ms_experience_logs)
  const steps = useData((s) => s.ms_experience_steps)
  const letters = useData((s) => s.ms_letters)
  const notSetUp = useData((s) => s.missingTables.includes('ms_experiences'))
  const counters = useCounters()
  const { today } = useMs()
  const open = useMsUI((s) => s.open)
  const [group, setGroup] = useState<StatusGroup>('all')

  const targets = useMemo(() => targetTotals(counters, experiences, logs), [counters, experiences, logs])
  const shown = group === 'all' ? experiences : experiences.filter((e) => groupOf(e.status) === group)
  const counts = useMemo(() => {
    const c: Record<StatusGroup, number> = { all: experiences.length, current: 0, prospects: 0, past: 0 }
    for (const e of experiences) c[groupOf(e.status)]++
    return c
  }, [experiences])

  if (notSetUp) {
    return (
      <Panel title="Not set up yet" edge="warn">
        <p className="text-[14px] leading-relaxed">
          Experiences need their tables on the server first. Run <span className="lg-num">supabase/026_medschool_experiences.sql</span> in the Supabase SQL
          editor, then come back.
        </p>
      </Panel>
    )
  }

  return (
    <div className="flex flex-col gap-3 pb-6">
      <TargetsPanel targets={targets} />

      <div className="lg-rez flex flex-col gap-2 lg:flex-row lg:items-center" style={{ '--rez-i': 1 } as React.CSSProperties}>
        <div className="scroll-x -mx-4 flex gap-1.5 px-4 pb-1 lg:mx-0 lg:min-w-0 lg:flex-1 lg:px-0" role="group" aria-label="Show">
          {(Object.keys(GROUP_LABEL) as StatusGroup[]).map((g) => (
            <button
              key={g}
              type="button"
              className="lg-filter"
              aria-pressed={group === g}
              onClick={() => {
                fire('tap')
                setGroup(g)
              }}
            >
              {GROUP_LABEL[g]} <span className="lg-num lg-dim">{counts[g]}</span>
            </button>
          ))}
        </div>
        <button type="button" className="lg-btn lg-btn--small lg-btn--primary self-start" onClick={() => open({ kind: 'experience-edit', experienceId: null })}>
          Add experience
        </button>
      </div>

      {shown.length === 0 ? (
        <Panel rez={2}>
          <p className="lg-dim text-[13.5px]">
            {experiences.length === 0 ? 'No experiences yet. Add shadowing, service, clinical work, research or a club.' : `Nothing under ${GROUP_LABEL[group]}.`}
          </p>
        </Panel>
      ) : (
        <div className="grid gap-3 lg:grid-cols-2">
          {shown.map((exp, i) => (
            <ExperienceCard key={exp.id} exp={exp} logs={logs} steps={steps} letters={letters} today={today} rez={Math.min(i + 2, 8)} />
          ))}
        </div>
      )}
    </div>
  )
}

/** The committee's targets, with the quick log beside them. */
export function TargetsPanel({ targets, title = 'Committee targets', compact = false }: { targets: ReturnType<typeof targetTotals>; title?: string; compact?: boolean }) {
  const open = useMsUI((s) => s.open)
  return (
    <Panel
      title={title}
      rez={0}
      edge="live"
      action={
        <button type="button" className="lg-btn lg-btn--small lg-btn--primary" onClick={() => open({ kind: 'explog', experienceId: null })}>
          Quick log
        </button>
      }
    >
      <div className={`grid gap-3 ${compact ? '' : 'lg:grid-cols-3'}`}>
        {targets.map(({ counter, total, parts }) => {
          const left = Math.max(0, counter.target - total)
          return (
            <div key={counter.id} className="min-w-0">
              <span className="flex items-baseline gap-2 pb-1.5">
                <span className="min-w-0 flex-1 truncate text-[13.5px]">{counter.label}</span>
                <span className="lg-num text-[12.5px]">
                  <span className="lg-live">{Math.round(total * 100) / 100}</span>
                  <span className="lg-dim"> / {amount(counter.target, counter.unit)}</span>
                </span>
              </span>
              <Trail value={total} max={counter.target} label={`${counter.label}: ${total} of ${counter.target}`} />
              {!compact && (
                <p className="lg-dim mt-1.5 text-[12px] leading-snug">
                  {left > 0 ? `${amount(left, counter.unit)} to go` : 'Target reached'}
                  {parts.length > 0 && ` · ${parts.map((p) => `${p.exp.name} ${Math.round(p.total * 100) / 100}`).join(', ')}`}
                </p>
              )}
            </div>
          )
        })}
      </div>
    </Panel>
  )
}

function ExperienceCard({
  exp,
  logs,
  steps,
  letters,
  today,
  rez,
}: {
  exp: MsExperience
  logs: MsExperienceLog[]
  steps: MsExperienceStep[]
  letters: MsLetter[]
  today: string
  rez: number
}) {
  const open = useMsUI((s) => s.open)
  const meta = KIND_META[exp.kind]
  const total = experienceTotal(exp, logs)
  const warnings = capWarnings(exp, total, today)
  const letter = exp.letter_id ? letters.find((l) => l.id === exp.letter_id) : null
  const checklist = stepsFor(exp.id, steps)
  const stepsDone = checklist.filter((s) => s.done_at).length
  const span = dateSpan(exp)
  // Shadowing is filed under the hospital, but remembered by the physician.
  const sub = [
    meta.label,
    exp.role,
    exp.kind === 'shadowing' && exp.specialty ? `${exp.specialty}${exp.physician_type ? ` (${exp.physician_type})` : ''}` : null,
    exp.kind === 'shadowing' ? exp.contact : null,
  ]
    .filter(Boolean)
    .join(' · ')
  const canLog = meta.tracks !== 'estimate' && exp.status !== 'declined'
  const faded = exp.status === 'declined'

  return (
    <Panel
      title={exp.name}
      rez={rez}
      edge={warnings.length ? 'warn' : exp.status === 'active' ? 'live' : undefined}
      action={<Chip tone={exp.status === 'active' ? 'live' : exp.status === 'done' ? 'ok' : undefined}>{STATUS_LABEL[exp.status]}</Chip>}
      className={faded ? 'opacity-60' : ''}
    >
      <button type="button" className="block w-full text-left" onClick={() => open({ kind: 'experience', experienceId: exp.id })}>
        <p className="text-[13.5px] leading-snug">{sub}</p>
        {span && <p className="lg-num lg-dim mt-0.5 text-[11.5px]">{span}</p>}
        <p className="mt-2 text-[13.5px]">
          {meta.tracks === 'estimate' ? (
            exp.prior > 0 ? (
              <>
                <span className="lg-num lg-live">≈ {amount(exp.prior, 'h')}</span>
                {exp.prior_as_of && <span className="lg-dim"> as of {formatPartial(exp.prior_as_of)}</span>}
              </>
            ) : (
              <span className="lg-dim">Hours not filled in yet</span>
            )
          ) : total === 0 ? (
            <span className="lg-dim">Nothing logged yet{exp.cap_hours ? ` · ${exp.cap_hours} h cap` : ''}</span>
          ) : (
            <>
              <span className="lg-num lg-live">{amount(total, meta.tracks === 'meetings' ? 'meetings' : 'h')}</span>
              {exp.cap_hours && <span className="lg-dim"> of a {exp.cap_hours} h cap</span>}
            </>
          )}
        </p>
        {exp.cap_hours && meta.tracks === 'hours' && (
          <div className="mt-1.5">
            <Trail value={total} max={exp.cap_hours} label={`${exp.name}: ${total} of ${exp.cap_hours} h`} />
          </div>
        )}
        {warnings.map((w) => (
          <p key={w.text} className="lg-warn-text mt-1.5 text-[12.5px] leading-snug">
            {w.text}
          </p>
        ))}
        {letter && (
          <p className="mt-1.5 text-[12.5px] leading-snug">
            <span className="lg-dim">Letter · </span>
            {letter.title}: <span className={letter.status === 'received' ? 'lg-live' : ''}>{LETTER_LABEL[letter.status]}</span>
          </p>
        )}
        {checklist.length > 0 && (
          <p className="lg-dim mt-1.5 text-[12px]">
            Onboarding <span className="lg-num">{stepsDone}/{checklist.length}</span>
            {stepsDone < checklist.length && ` · next: ${checklist.find((s) => !s.done_at)!.title}`}
          </p>
        )}
      </button>
      <div className="mt-3 flex flex-wrap gap-2">
        {canLog && (
          <button type="button" className="lg-btn lg-btn--small lg-btn--primary" onClick={() => open({ kind: 'explog', experienceId: exp.id })}>
            {meta.tracks === 'meetings' ? 'Log meeting' : 'Log hours'}
          </button>
        )}
        <button type="button" className="lg-btn lg-btn--small" onClick={() => open({ kind: 'experience', experienceId: exp.id })}>
          Open
        </button>
      </div>
    </Panel>
  )
}

/** A dated onboarding step on the timeline's circuit. Tap the node to tick it. */
export function StepRow({ view, first, last }: { view: StepView; first?: boolean; last?: boolean }) {
  const { step, exp, status } = view
  const open = useMsUI((s) => s.open)
  const done = Boolean(step.done_at)
  return (
    <div className="lg-step" data-done={done} data-first={first} data-last={last}>
      <div className="lg-step-col">
        <span className="lg-step-lit" aria-hidden />
        <Node done={done} hard={false} late={status.kind === 'late'} label={step.title} onToggle={() => void toggleStep(step)} />
      </div>
      <button
        type="button"
        className="lg-rule min-w-0 flex-1 py-2.5 pr-3 text-left"
        style={first ? { borderTop: 0 } : undefined}
        onClick={() => {
          fire('tap')
          open({ kind: 'experience', experienceId: exp.id })
        }}
      >
        <span className="flex items-start gap-2">
          <span
            className="min-w-0 flex-1 text-[14.5px] leading-snug"
            style={done ? { color: 'var(--lg-dim)', textDecoration: 'line-through', textDecorationColor: 'var(--lg-trace)' } : undefined}
          >
            {step.title}
          </span>
          <StatusChip status={status} />
        </span>
        <span className="mt-1 flex flex-wrap items-center gap-1.5">
          <span className={`lg-num text-[11.5px] ${status.kind === 'late' ? 'lg-warn-text' : 'lg-dim'}`}>{step.due_on ? weekdayDay(step.due_on) : ''}</span>
          <Chip>Hours</Chip>
          <Chip>{exp.name}</Chip>
        </span>
      </button>
    </div>
  )
}

