import { useMemo, useState } from 'react'
import { useData } from '@/store/useData'
import { fire } from '@/lib/haptics'
import type { MsCounter } from '@/data/types'
import { shortDay } from './dates'
import { addQuestion, advanceLetter, loggedFor, removeLog, removeQuestion, toggleEligibility, toggleQuestion } from './actions'
import { useCounters, useExperiences, useExperiencesLive, useMs, useMsUI } from './store'
import { TargetsPanel } from './ExperiencesTab'
import { targetTotals } from './experiences'
import { Chip, CopyText, Lines, Panel, Trail } from './ui'
import { amount, LETTER_LABEL } from './labels'

/** The pre-health committee file: hours, checklist, letters, who to ask. */
export function FileTab() {
  const counters = useCounters()
  const { settings } = useMs()
  const ref = settings?.reference ?? {}
  const committee = ref.committee ?? {}
  const live = useExperiencesLive()

  return (
    <div className="flex flex-col gap-3 pb-6">
      {live ? (
        <ExperienceTargets />
      ) : (
        <div className="grid gap-3 lg:grid-cols-3">
          {counters.map((c, i) => (
            <CounterPanel key={c.id} counter={c} rez={i} />
          ))}
        </div>
      )}
      <div className="grid gap-3 lg:grid-cols-2">
        <EligibilityPanel />
        <LettersPanel />
      </div>
      <div className="grid gap-3 lg:grid-cols-2">
        <QuestionsPanel />
        {(committee.contacts?.length ?? 0) > 0 && (
          <Panel title="Contacts" rez={6}>
            <div className="flex flex-col gap-4">
              {committee.contacts!.map((p) => (
                <div key={p.name}>
                  <p className="text-[14.5px] font-medium">{p.name}</p>
                  <p className="lg-dim text-[12.5px]">
                    {[p.role, p.room && `Room ${p.room}`].filter(Boolean).join(' · ')}
                  </p>
                  {p.email && <CopyText text={p.email} label="email" href={`mailto:${p.email}`} />}
                  {p.phone && <CopyText text={p.phone} label="phone" href={`tel:${p.phone.replace(/[^\d+]/g, '')}`} />}
                </div>
              ))}
            </div>
          </Panel>
        )}
      </div>
      {(ref.people?.length ?? 0) > 0 && (
        <Panel title="People" rez={7}>
          <div className="flex flex-col gap-2.5">
            {ref.people!.map((p) => (
              <div key={p.name}>
                <p className="text-[14px] font-medium">{p.name}</p>
                {p.role && <p className="lg-dim text-[12.5px] leading-snug">{p.role}</p>}
              </div>
            ))}
          </div>
        </Panel>
      )}
      {((committee.requirements?.length ?? 0) > 0 || (committee.rules?.length ?? 0) > 0) && (
        <Panel rez={8}>
          <details>
            <summary className="lg-label flex min-h-[36px] cursor-pointer items-center">Committee requirements and rules</summary>
            <div className="flex flex-col gap-4 pt-2">
              {committee.requirements && (
                <div>
                  <p className="lg-label mb-2 !text-[10.5px]">Requirements</p>
                  <Lines items={committee.requirements} />
                </div>
              )}
              {committee.rules && (
                <div>
                  <p className="lg-label mb-2 !text-[10.5px]">Rules</p>
                  <Lines items={committee.rules} />
                </div>
              )}
            </div>
          </details>
        </Panel>
      )}
    </div>
  )
}

/** The committee's targets, filled from the experiences counting towards them. */
function ExperienceTargets() {
  const counters = useCounters()
  const experiences = useExperiences()
  const logs = useData((s) => s.ms_experience_logs)
  const setTab = useMsUI((s) => s.setTab)
  const targets = useMemo(() => targetTotals(counters, experiences, logs), [counters, experiences, logs])
  return (
    <div className="flex flex-col gap-2">
      <TargetsPanel targets={targets} title="Hours and meetings" />
      <button
        type="button"
        className="lg-btn lg-btn--small lg-btn--ghost self-start"
        onClick={() => {
          fire('snap')
          setTab('exp')
        }}
      >
        Every experience, its log and its letter →
      </button>
    </div>
  )
}

function CounterPanel({ counter, rez }: { counter: MsCounter; rez: number }) {
  const logs = useData((s) => s.ms_counter_logs)
  const open = useMsUI((s) => s.open)
  const [showLog, setShowLog] = useState(false)
  const entries = useMemo(
    () => logs.filter((l) => l.counter_id === counter.id).sort((a, b) => b.on_date.localeCompare(a.on_date)),
    [logs, counter.id],
  )
  const logged = loggedFor(counter.id, logs)
  const total = counter.undated + logged
  const left = Math.max(0, counter.target - total)
  const meetings = counter.unit !== 'h'

  return (
    <Panel
      title={counter.label}
      rez={rez}
      edge="live"
      action={
        <span className="lg-num text-[13px]">
          <span className="lg-live">{Math.round(total * 100) / 100}</span>
          <span className="lg-dim"> / {counter.target}</span>
        </span>
      }
    >
      <Trail value={total} max={counter.target} cap={counter.cap} label={`${counter.label}: ${total} of ${counter.target}`} />
      <p className="mt-2.5 text-[13.5px]">
        {left > 0 ? (
          <>
            {meetings ? (
              <>
                <span className="lg-num">{Math.round(left * 100) / 100}</span> more to reach {counter.target}
              </>
            ) : (
              <>
                <span className="lg-num">{amount(left, counter.unit)}</span> to go
              </>
            )}
          </>
        ) : (
          <span className="lg-live">Target reached</span>
        )}
      </p>
      {counter.cap && (
        <p className="lg-warn-text mt-1.5 text-[12.5px] leading-snug">
          {counter.cap_note ?? `One source caps at ${amount(counter.cap, counter.unit)}.`}{' '}
          <span className="lg-num">
            {amount(Math.min(total, counter.cap), counter.unit)} of {amount(counter.cap, counter.unit)}
          </span>{' '}
          so far.
        </p>
      )}
      {counter.note && <p className="lg-dim mt-1.5 text-[12.5px] leading-snug">{counter.note}</p>}

      <div className="mt-3 flex flex-wrap gap-2">
        <button type="button" className="lg-btn lg-btn--small lg-btn--primary" onClick={() => open({ kind: 'log', counterId: counter.id })}>
          {meetings ? 'Log meeting' : 'Log hours'}
        </button>
        <button type="button" className="lg-btn lg-btn--small" onClick={() => open({ kind: 'total', counterId: counter.id })}>
          Set total
        </button>
        {entries.length > 0 && (
          <button type="button" className="lg-btn lg-btn--small lg-btn--ghost" aria-expanded={showLog} onClick={() => setShowLog((s) => !s)}>
            {showLog ? 'Hide' : 'Show'} {entries.length} {entries.length === 1 ? 'entry' : 'entries'}
          </button>
        )}
      </div>

      {meetings && (
        <p className="lg-dim mt-2.5 text-[12px]">
          <span className="lg-num">{entries.length}</span> dated · <span className="lg-num">{Math.round(counter.undated * 100) / 100}</span> from before dates were kept
        </p>
      )}
      {!meetings && counter.undated > 0 && (
        <p className="lg-dim mt-2.5 text-[12px]">
          <span className="lg-num">{amount(counter.undated, counter.unit)}</span> without a date
        </p>
      )}

      {showLog && (
        <ul className="mt-2">
          {entries.map((l) => (
            <li key={l.id} className="lg-rule flex min-h-[48px] items-center gap-2 py-1">
              <span className="lg-num w-[64px] shrink-0 text-[12.5px]">{shortDay(l.on_date)}</span>
              {!meetings && <span className="lg-num lg-live w-[54px] shrink-0 text-[12.5px]">{amount(l.amount, 'h')}</span>}
              <span className="lg-dim min-w-0 flex-1 truncate text-[12.5px]">{l.note}</span>
              <button type="button" className="lg-icon-btn" aria-label={`Remove the entry for ${shortDay(l.on_date)}`} onClick={() => void removeLog(l)}>
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden>
                  <path d="M6 6l12 12M18 6 6 18" />
                </svg>
              </button>
            </li>
          ))}
        </ul>
      )}
    </Panel>
  )
}

function EligibilityPanel() {
  const items = useData((s) => s.ms_eligibility)
  const tasks = useData((s) => s.ms_tasks)
  const sorted = useMemo(() => [...items].sort((a, b) => a.sort - b.sort), [items])
  const metOf = (id: string) => {
    const e = items.find((x) => x.id === id)!
    if (e.task_id) return Boolean(tasks.find((t) => t.id === e.task_id)?.done_at)
    return e.met
  }
  const met = sorted.filter((e) => metOf(e.id)).length
  if (sorted.length === 0) return null
  return (
    <Panel
      title="Eligibility"
      rez={3}
      action={
        <span className="lg-num text-[12.5px]">
          <span className={met === sorted.length ? 'lg-live' : ''}>{met}</span>
          <span className="lg-dim">/{sorted.length} met</span>
        </span>
      }
    >
      <ul>
        {sorted.map((e) => {
          const on = metOf(e.id)
          return (
            <li key={e.id} className="lg-rule first:border-t-0">
              <button type="button" className="flex min-h-[48px] w-full items-start gap-3 py-2 text-left" aria-pressed={on} onClick={() => void toggleEligibility(e)}>
                <span className="lg-node !h-6 !w-6" data-done={on} aria-hidden>
                  <span />
                </span>
                <span className="min-w-0 flex-1">
                  <span className={`block text-[13.5px] leading-snug ${on ? '' : ''}`}>{e.title}</span>
                  {e.note && <span className="lg-dim block text-[12px] leading-snug">{e.note}</span>}
                  {e.task_id && <span className="lg-dim block text-[11.5px]">Same as the task — ticking one ticks both.</span>}
                </span>
                <Chip tone={on ? 'ok' : undefined}>{on ? 'met' : 'not met'}</Chip>
              </button>
            </li>
          )
        })}
      </ul>
    </Panel>
  )
}

function LettersPanel() {
  const letters = useData((s) => s.ms_letters)
  const open = useMsUI((s) => s.open)
  const sorted = useMemo(() => [...letters].sort((a, b) => a.sort - b.sort), [letters])
  const received = sorted.filter((l) => l.status === 'received').length
  if (sorted.length === 0) return null
  return (
    <Panel
      title="Letters"
      rez={4}
      action={
        <span className="lg-num text-[12.5px]">
          <span className={received === sorted.length ? 'lg-live' : ''}>{received}</span>
          <span className="lg-dim">/{sorted.length} in</span>
        </span>
      }
    >
      <p className="lg-dim pb-1 text-[12px]">Tap a status to move it on: not asked → asked → agreed → received.</p>
      <ul>
        {sorted.map((l) => {
          const dates = [
            l.asked_on && `Asked ${shortDay(l.asked_on)}`,
            l.agreed_on && `agreed ${shortDay(l.agreed_on)}`,
            l.received_on && `received ${shortDay(l.received_on)}`,
          ].filter(Boolean)
          return (
            <li key={l.id} className="lg-rule flex items-start gap-2 py-2 first:border-t-0">
              <button type="button" className="min-h-[44px] min-w-0 flex-1 text-left" onClick={() => open({ kind: 'letter', letterId: l.id })}>
                <span className="block text-[13.5px] leading-snug">{l.title}</span>
                {l.note && <span className="lg-dim block text-[12px] leading-snug">{l.note}</span>}
                {dates.length > 0 && <span className="lg-num lg-dim mt-0.5 block text-[11px]">{dates.join(' · ')}</span>}
              </button>
              <button
                type="button"
                className="lg-btn lg-btn--small shrink-0 !px-2.5"
                aria-label={`${l.title}: ${LETTER_LABEL[l.status]}. Tap to move on.`}
                onClick={() => void advanceLetter(l)}
                style={l.status === 'received' ? { borderColor: 'var(--lg-cyan)', color: 'var(--lg-cyan)' } : l.status === 'not_asked' ? { color: 'var(--lg-dim)' } : undefined}
              >
                {LETTER_LABEL[l.status]}
              </button>
            </li>
          )
        })}
      </ul>
    </Panel>
  )
}

function QuestionsPanel() {
  const questions = useData((s) => s.ms_questions)
  const sorted = useMemo(() => [...questions].sort((a, b) => a.sort - b.sort), [questions])
  const [text, setText] = useState('')
  const add = () => {
    if (!text.trim()) return
    void addQuestion(text)
    fire('success')
    setText('')
  }
  return (
    <Panel title="Questions for the advisor" rez={5}>
      <ul>
        {sorted.map((q) => (
          <li key={q.id} className="lg-rule flex items-start gap-1 first:border-t-0">
            <button type="button" className="flex min-h-[48px] min-w-0 flex-1 items-start gap-3 py-2 text-left" aria-pressed={q.done} onClick={() => void toggleQuestion(q)}>
              <span className="lg-node !h-6 !w-6" data-done={q.done} aria-hidden>
                <span />
              </span>
              <span className={`min-w-0 flex-1 text-[13.5px] leading-snug ${q.done ? 'lg-dim line-through' : ''}`}>{q.text}</span>
            </button>
            <button type="button" className="lg-icon-btn" aria-label={`Remove: ${q.text}`} onClick={() => void removeQuestion(q)}>
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden>
                <path d="M6 6l12 12M18 6 6 18" />
              </svg>
            </button>
          </li>
        ))}
      </ul>
      <form
        className="mt-2 flex gap-2"
        onSubmit={(e) => {
          e.preventDefault()
          add()
        }}
      >
        <input className="lg-field" value={text} onChange={(e) => setText(e.target.value)} aria-label="A question to ask" />
        <button type="submit" className="lg-btn lg-btn--small shrink-0" disabled={!text.trim()}>
          Add
        </button>
      </form>
    </Panel>
  )
}
