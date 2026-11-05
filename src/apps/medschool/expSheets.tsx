import { useMemo, useState } from 'react'
import { toast } from 'sonner'
import { useData } from '@/store/useData'
import { copyToClipboard } from '@/apps/things/routing/deeplink'
import { fire } from '@/lib/haptics'
import { MS_EXPERIENCE_KINDS, MS_EXPERIENCE_STATUSES, type MsExperienceKind, type MsExperienceStatus } from '@/data/types'
import { isDay, lastTuesday, shortDay, todayDay, weekdayDay } from './dates'
import {
  addExpLog,
  addExperience,
  addStep,
  removeExpLog,
  removeExperience,
  removeStep,
  toggleStep,
  updateExpLog,
  updateExperience,
  updateStep,
  type ExperienceInput,
} from './actions'
import {
  AMCAS_DESCRIPTION_LIMIT,
  amcasText,
  blankExperience,
  capWarnings,
  dateSpan,
  defaultLogDay,
  entryAmount,
  entryTimes,
  experienceTotal,
  formatPartial,
  hhmm,
  isPartialDate,
  KIND_META,
  lastLogged,
  logsFor,
  STATUS_LABEL,
  stepsFor,
  threeMonthsFrom,
  unitOf,
} from './experiences'
import { useCounters, useExperiences, useMs, useMsUI } from './store'
import { amount, hoursBetween, LETTER_LABEL, timeRange } from './labels'
import { Actions, MsSheet } from './sheets'
import { Field, Node, Trail } from './ui'

const X = (
  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden>
    <path d="M6 6l12 12M18 6 6 18" />
  </svg>
)

// --- one experience ----------------------------------------------------------------

/**
 * An experience in full: where it stands, its total and warnings, its
 * letter, its onboarding checklist and every entry in its log.
 */
export function ExperienceSheet({ experienceId }: { experienceId: string }) {
  const close = useMsUI((s) => s.close)
  const open = useMsUI((s) => s.open)
  const exp = useData((s) => s.ms_experiences.find((e) => e.id === experienceId))
  const allLogs = useData((s) => s.ms_experience_logs)
  const allSteps = useData((s) => s.ms_experience_steps)
  const letters = useData((s) => s.ms_letters)
  const counters = useCounters()
  const { today } = useMs()
  const [stepTitle, setStepTitle] = useState('')
  const [stepDue, setStepDue] = useState('')
  const [confirmDelete, setConfirmDelete] = useState(false)
  if (!exp) return null

  const meta = KIND_META[exp.kind]
  const logs = logsFor(exp.id, allLogs)
  const steps = stepsFor(exp.id, allSteps)
  const total = experienceTotal(exp, allLogs)
  const warnings = capWarnings(exp, total, today)
  const letter = exp.letter_id ? letters.find((l) => l.id === exp.letter_id) : null
  const target = exp.counts_toward ? counters.find((c) => c.id === exp.counts_toward) : null
  const span = dateSpan(exp)
  const unit = unitOf(exp)

  const setStatus = (status: MsExperienceStatus) => {
    if (status === exp.status) return
    fire('snap')
    void updateExperience(exp, { status })
  }

  const copy = () => {
    fire('tap')
    copyToClipboard(amcasText(exp, allLogs, letter)).then(
      () => toast.success('Copied for AMCAS', { description: 'Organization, contact, dates, hours and description.' }),
      () => toast.error("Couldn't copy that"),
    )
  }

  return (
    <MsSheet title={exp.name} onClose={close}>
      <div className="flex flex-col gap-4">
        <div>
          <p className="text-[14px] leading-snug">
            {[meta.label, exp.role, exp.specialty, exp.physician_type].filter(Boolean).join(' · ')}
          </p>
          {span && <p className="lg-num lg-dim mt-0.5 text-[12px]">{span}</p>}
          {(exp.contact || exp.location) && (
            <p className="lg-dim mt-1 text-[12.5px] leading-snug">{[exp.contact, exp.location].filter(Boolean).join(' · ')}</p>
          )}
        </div>

        <div className="scroll-x -mx-5 flex gap-1.5 px-5 pb-1" role="group" aria-label="Status">
          {MS_EXPERIENCE_STATUSES.map((s) => (
            <button key={s} type="button" className="lg-filter shrink-0" aria-pressed={exp.status === s} onClick={() => setStatus(s)}>
              {STATUS_LABEL[s]}
            </button>
          ))}
        </div>

        <div>
          <p className="text-[14px]">
            {meta.tracks === 'estimate' ? (
              exp.prior > 0 ? (
                <>
                  <span className="lg-num lg-live text-[18px]">≈ {amount(exp.prior, 'h')}</span>
                  {exp.prior_as_of && <span className="lg-dim"> as of {formatPartial(exp.prior_as_of)}</span>}
                </>
              ) : (
                <span className="lg-dim">No estimate yet — add one under Edit details.</span>
              )
            ) : (
              <>
                <span className="lg-num lg-live text-[18px]">{amount(total, unit)}</span>
                {exp.prior > 0 && (
                  <span className="lg-dim">
                    {' '}
                    · {amount(exp.prior, unit)} from before dates were kept
                  </span>
                )}
              </>
            )}
          </p>
          {target && <p className="lg-dim mt-0.5 text-[12px]">Counts towards {target.label.toLowerCase()}</p>}
          {exp.cap_hours && (
            <div className="mt-2">
              <Trail value={total} max={exp.cap_hours} label={`${total} of a ${exp.cap_hours} h cap`} />
              <p className="lg-dim mt-1 text-[12px]">
                Cap {exp.cap_hours} h{exp.cap_until ? ` by ${weekdayDay(exp.cap_until)}` : ''}
              </p>
            </div>
          )}
          {warnings.map((w) => (
            <p key={w.text} className="lg-warn-text mt-1.5 text-[13px] leading-snug">
              {w.text}
            </p>
          ))}
          {letter && (
            <p className="mt-2 text-[13px] leading-snug">
              <span className="lg-dim">Letter · </span>
              {letter.title}: <span className={letter.status === 'received' ? 'lg-live' : ''}>{LETTER_LABEL[letter.status]}</span>
            </p>
          )}
        </div>

        <div className="flex flex-wrap gap-2">
          {meta.tracks !== 'estimate' && (
            <button type="button" className="lg-btn lg-btn--small lg-btn--primary" onClick={() => open({ kind: 'explog', experienceId: exp.id })}>
              {meta.tracks === 'meetings' ? 'Log meeting' : 'Log hours'}
            </button>
          )}
          <button type="button" className="lg-btn lg-btn--small" onClick={() => open({ kind: 'experience-edit', experienceId: exp.id })}>
            Edit details
          </button>
          <button type="button" className="lg-btn lg-btn--small" onClick={copy}>
            Copy for AMCAS
          </button>
        </div>

        {(steps.length > 0 || exp.status === 'prospect' || exp.status === 'reached_out' || exp.status === 'onboarding') && (
          <section>
            <h3 className="lg-label mb-1">Onboarding · {steps.filter((s) => s.done_at).length}/{steps.length}</h3>
            <p className="lg-dim mb-1 text-[12px]">A step with a date also shows in the timeline.</p>
            <ul>
              {steps.map((st) => (
                <li key={st.id} className="lg-rule flex min-h-[52px] items-center gap-2 py-1 first:border-t-0">
                  <Node done={Boolean(st.done_at)} hard={false} late={Boolean(st.due_on && !st.done_at && st.due_on < today)} label={st.title} onToggle={() => void toggleStep(st)} />
                  <span className={`min-w-0 flex-1 text-[13.5px] leading-snug ${st.done_at ? 'lg-dim line-through' : ''}`}>{st.title}</span>
                  <input
                    type="date"
                    className="lg-field lg-field--mono !w-[148px] shrink-0 !py-1.5 !text-[12px]"
                    aria-label={`Due date for ${st.title}`}
                    value={st.due_on ?? ''}
                    onChange={(e) => void updateStep(st, { due_on: e.target.value || null })}
                  />
                  <button type="button" className="lg-icon-btn" aria-label={`Remove the step ${st.title}`} onClick={() => void removeStep(st)}>
                    {X}
                  </button>
                </li>
              ))}
            </ul>
            <form
              className="mt-2 flex flex-wrap gap-2"
              onSubmit={(e) => {
                e.preventDefault()
                if (!stepTitle.trim()) return
                void addStep(exp, stepTitle, isDay(stepDue) ? stepDue : null).then((ok) => {
                  if (!ok) return
                  fire('success')
                  setStepTitle('')
                  setStepDue('')
                })
              }}
            >
              <input className="lg-field min-w-0 flex-1" placeholder="Add a step" aria-label="A new onboarding step" value={stepTitle} onChange={(e) => setStepTitle(e.target.value)} />
              <input type="date" className="lg-field lg-field--mono !w-[148px]" aria-label="Its due date (optional)" value={stepDue} onChange={(e) => setStepDue(e.target.value)} />
              <button type="submit" className="lg-btn lg-btn--small" disabled={!stepTitle.trim()}>
                Add
              </button>
            </form>
          </section>
        )}

        {meta.tracks !== 'estimate' && (
          <section>
            <h3 className="lg-label mb-1">
              Log · {logs.length} {logs.length === 1 ? 'entry' : 'entries'}
            </h3>
            {logs.length === 0 ? (
              <p className="lg-dim text-[13px]">Nothing logged yet.</p>
            ) : (
              <ul>
                {logs.map((l) => {
                  const times = entryTimes(l)
                  return (
                    <li key={l.id} className="lg-rule flex min-h-[48px] items-center gap-2 py-1 first:border-t-0">
                      <button type="button" className="flex min-w-0 flex-1 items-center gap-2 text-left" onClick={() => open({ kind: 'explog', experienceId: exp.id, logId: l.id })}>
                        <span className="lg-num w-[56px] shrink-0 text-[12.5px]">{shortDay(l.on_date)}</span>
                        {unit === 'h' && <span className="lg-num lg-live w-[54px] shrink-0 text-[12.5px]">{amount(entryAmount(exp, l), 'h')}</span>}
                        <span className="lg-dim min-w-0 flex-1 truncate text-[12.5px]">{[times, l.note].filter(Boolean).join(' · ') || (unit === 'meetings' ? 'Meeting' : '')}</span>
                      </button>
                      <button type="button" className="lg-icon-btn" aria-label={`Remove the entry for ${shortDay(l.on_date)}`} onClick={() => void removeExpLog(l)}>
                        {X}
                      </button>
                    </li>
                  )
                })}
              </ul>
            )}
          </section>
        )}

        {exp.notes && (
          <section>
            <h3 className="lg-label mb-1">Notes</h3>
            <p className="text-[13.5px] leading-relaxed">{exp.notes}</p>
          </section>
        )}
        {exp.description && (
          <section>
            <h3 className="lg-label mb-1">Description</h3>
            <p className="text-[13.5px] leading-relaxed">{exp.description}</p>
          </section>
        )}
      </div>
      <Actions>
        <button
          type="button"
          className={`lg-btn lg-btn--small ${confirmDelete ? 'lg-btn--warn' : 'lg-btn--ghost'}`}
          onClick={() => {
            if (!confirmDelete) {
              fire('warning')
              setConfirmDelete(true)
              return
            }
            close()
            void removeExperience(exp)
          }}
        >
          {confirmDelete ? `Yes, remove it${logs.length ? ` and its ${logs.length} ${logs.length === 1 ? 'entry' : 'entries'}` : ''}` : 'Remove this experience'}
        </button>
      </Actions>
    </MsSheet>
  )
}

// --- add or edit the details -------------------------------------------------------

const toNum = (s: string): number | null => {
  const n = Number(s.replace(/,/g, ''))
  return s.trim() && Number.isFinite(n) && n >= 0 ? n : null
}

export function ExperienceEditSheet({ experienceId, preset }: { experienceId: string | null; preset?: MsExperienceKind }) {
  const close = useMsUI((s) => s.close)
  const open = useMsUI((s) => s.open)
  const existing = useData((s) => (experienceId ? s.ms_experiences.find((e) => e.id === experienceId) : undefined))
  const counters = useCounters()
  const letters = useData((s) => s.ms_letters)
  const start = useMemo(() => existing ?? blankExperience(preset ?? 'shadowing', '', '', null), [existing, preset])
  const [kind, setKind] = useState<MsExperienceKind>(start.kind)
  const [name, setName] = useState(start.name)
  const [role, setRole] = useState(start.role ?? '')
  const [contact, setContact] = useState(start.contact ?? '')
  const [location, setLocation] = useState(start.location ?? '')
  const [startOn, setStartOn] = useState(start.start_on ?? '')
  const [endOn, setEndOn] = useState(start.end_on ?? '')
  const [status, setStatus] = useState<MsExperienceStatus>(start.status)
  const [specialty, setSpecialty] = useState(start.specialty ?? '')
  const [physicianType, setPhysicianType] = useState<'' | 'MD' | 'DO'>(start.physician_type ?? '')
  const [capHours, setCapHours] = useState(start.cap_hours != null ? String(start.cap_hours) : '')
  const [capUntil, setCapUntil] = useState(start.cap_until ?? '')
  const [prior, setPrior] = useState(start.prior ? String(start.prior) : '')
  const [priorAsOf, setPriorAsOf] = useState(start.prior_as_of ?? '')
  const [countsToward, setCountsToward] = useState(start.counts_toward ?? '')
  const [letterId, setLetterId] = useState(start.letter_id ?? '')
  const [notes, setNotes] = useState(start.notes ?? '')
  const [description, setDescription] = useState(start.description ?? '')
  const [saving, setSaving] = useState(false)
  if (experienceId && !existing) return null

  const meta = KIND_META[kind]
  const startOk = !startOn.trim() || isPartialDate(startOn.trim())
  const endOk = !endOn.trim() || isPartialDate(endOn.trim())
  const capOk = !capHours.trim() || (toNum(capHours) ?? 0) > 0
  const priorOk = !prior.trim() || toNum(prior) !== null
  const valid = name.trim().length > 0 && startOk && endOk && capOk && priorOk
  const isNew = !existing

  const changeKind = (next: MsExperienceKind) => {
    setKind(next)
    // A new record follows its kind's usual target until one is chosen.
    if (isNew) setCountsToward(KIND_META[next].target ?? '')
    if (isNew) setStatus(next === 'shadowing' ? 'prospect' : 'active')
  }

  async function save() {
    if (!valid) return
    setSaving(true)
    const input: ExperienceInput = {
      kind,
      name: name.trim(),
      role: role.trim() || null,
      contact: contact.trim() || null,
      location: location.trim() || null,
      start_on: startOn.trim() || null,
      end_on: endOn.trim() || null,
      status,
      notes: notes.trim() || null,
      description: description.trim() || null,
      specialty: kind === 'shadowing' ? specialty.trim() || null : null,
      physician_type: kind === 'shadowing' && physicianType ? physicianType : null,
      cap_hours: kind === 'shadowing' ? toNum(capHours) : null,
      cap_until: kind === 'shadowing' && isDay(capUntil) ? capUntil : null,
      prior: toNum(prior) ?? 0,
      prior_as_of: isDay(priorAsOf) ? priorAsOf : null,
      counts_toward: countsToward || null,
      letter_id: letterId || null,
    }
    if (existing) {
      const ok = await updateExperience(existing, input)
      setSaving(false)
      if (ok) {
        toast.success('Saved')
        close()
      }
      return
    }
    const row = await addExperience(input)
    setSaving(false)
    if (!row) return
    close()
    open({ kind: 'experience', experienceId: row.id })
  }

  return (
    <MsSheet title={isNew ? 'New experience' : 'Edit experience'} onClose={close}>
      <div className="flex flex-col gap-4">
        <Field label="Kind">
          <select className="lg-field" value={kind} onChange={(e) => changeKind(e.target.value as MsExperienceKind)}>
            {MS_EXPERIENCE_KINDS.map((k) => (
              <option key={k} value={k}>
                {KIND_META[k].label}
              </option>
            ))}
          </select>
        </Field>
        <Field label={kind === 'shadowing' ? 'Physician or program' : 'Organization or name'}>
          <input className="lg-field" value={name} onChange={(e) => setName(e.target.value)} />
        </Field>
        <div className="grid grid-cols-2 gap-2">
          <Field label="Role">
            <input className="lg-field" value={role} placeholder={kind === 'clinical_paid' ? 'EMT-B' : ''} onChange={(e) => setRole(e.target.value)} />
          </Field>
          <Field label="Status">
            <select className="lg-field" value={status} onChange={(e) => setStatus(e.target.value as MsExperienceStatus)}>
              {MS_EXPERIENCE_STATUSES.map((s) => (
                <option key={s} value={s}>
                  {STATUS_LABEL[s]}
                </option>
              ))}
            </select>
          </Field>
        </div>
        <div className="grid grid-cols-2 gap-2">
          <Field label="Contact">
            <input className="lg-field" value={contact} onChange={(e) => setContact(e.target.value)} />
          </Field>
          <Field label="Location">
            <input className="lg-field" value={location} onChange={(e) => setLocation(e.target.value)} />
          </Field>
        </div>
        <div className="grid grid-cols-2 gap-2">
          <Field label="Started" hint={startOk ? undefined : <span className="lg-warn-text">Like 2021, 2021-03 or 2021-03-05</span>}>
            <input className="lg-field lg-field--mono" value={startOn} placeholder="2021-03" inputMode="numeric" onChange={(e) => setStartOn(e.target.value)} />
          </Field>
          <Field label="Ended" hint={endOk ? 'Blank if it’s still going' : <span className="lg-warn-text">Like 2021, 2021-03 or 2021-03-05</span>}>
            <input className="lg-field lg-field--mono" value={endOn} placeholder="still going" inputMode="numeric" onChange={(e) => setEndOn(e.target.value)} />
          </Field>
        </div>

        {kind === 'shadowing' && (
          <>
            <div className="grid grid-cols-2 gap-2">
              <Field label="Specialty">
                <input className="lg-field" value={specialty} onChange={(e) => setSpecialty(e.target.value)} />
              </Field>
              <Field label="MD or DO">
                <select className="lg-field" value={physicianType} onChange={(e) => setPhysicianType(e.target.value as '' | 'MD' | 'DO')}>
                  <option value="">Not sure</option>
                  <option value="MD">MD</option>
                  <option value="DO">DO</option>
                </select>
              </Field>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <Field label="Hour cap" hint="An observer program's limit, if it has one">
                <input className="lg-field lg-field--mono" inputMode="decimal" value={capHours} onChange={(e) => setCapHours(e.target.value)} />
              </Field>
              <Field label="Cap ends" hint={isDay(startOn) && !capUntil ? `Three months on is ${shortDay(threeMonthsFrom(startOn))}` : undefined}>
                <input type="date" className="lg-field lg-field--mono" value={capUntil} onChange={(e) => setCapUntil(e.target.value)} />
              </Field>
            </div>
          </>
        )}

        <div className="grid grid-cols-2 gap-2">
          <Field
            label={meta.tracks === 'estimate' ? 'Estimated hours' : meta.tracks === 'meetings' ? 'Meetings before the log' : 'Hours before the log'}
            hint={meta.tracks === 'estimate' ? 'Your best total so far' : 'Counted but not dated'}
          >
            <input className="lg-field lg-field--mono" inputMode="decimal" value={prior} onChange={(e) => setPrior(e.target.value)} />
          </Field>
          <Field label="As of">
            <input type="date" className="lg-field lg-field--mono" value={priorAsOf} onChange={(e) => setPriorAsOf(e.target.value)} />
          </Field>
        </div>

        <div className="grid grid-cols-2 gap-2">
          <Field label="Counts towards">
            <select className="lg-field" value={countsToward} onChange={(e) => setCountsToward(e.target.value)}>
              <option value="">No committee target</option>
              {counters.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.label}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Letter">
            <select className="lg-field" value={letterId} onChange={(e) => setLetterId(e.target.value)}>
              <option value="">None</option>
              {letters.map((l) => (
                <option key={l.id} value={l.id}>
                  {l.title}
                </option>
              ))}
            </select>
          </Field>
        </div>

        <Field label="Notes">
          <textarea className="lg-field" rows={3} value={notes} onChange={(e) => setNotes(e.target.value)} />
        </Field>
        <Field
          label="Description for the application"
          hint={
            <span className={description.length > AMCAS_DESCRIPTION_LIMIT ? 'lg-warn-text' : ''}>
              <span className="lg-num">{description.length}</span>/{AMCAS_DESCRIPTION_LIMIT} characters
            </span>
          }
        >
          <textarea className="lg-field" rows={4} value={description} onChange={(e) => setDescription(e.target.value)} />
        </Field>
        {isNew && kind === 'shadowing' && <p className="lg-dim text-[12.5px]">A new shadowing opportunity starts with an onboarding checklist you can edit.</p>}
      </div>
      <Actions>
        <button type="button" className="lg-btn lg-btn--primary" disabled={!valid || saving} onClick={() => void save()}>
          {isNew ? 'Add experience' : 'Save'}
        </button>
      </Actions>
    </MsSheet>
  )
}

// --- log to an experience ----------------------------------------------------------

const LOG_MODE_KEY = 'ms:log-mode'
type LogMode = 'times' | 'hours'

function savedLogMode(): LogMode {
  try {
    return localStorage.getItem(LOG_MODE_KEY) === 'hours' ? 'hours' : 'times'
  } catch {
    return 'times'
  }
}

/**
 * Log hours or a meeting to an experience, or change an entry already
 * logged. Opened with no experience — the HUD's quick log — it starts on the
 * one logged to last.
 */
export function ExpLogSheet({ experienceId, logId }: { experienceId: string | null; logId?: string | null }) {
  const close = useMsUI((s) => s.close)
  const experiences = useExperiences()
  const logs = useData((s) => s.ms_experience_logs)
  const entry = useData((s) => (logId ? s.ms_experience_logs.find((l) => l.id === logId) : undefined))
  const loggable = experiences.filter((e) => KIND_META[e.kind].tracks !== 'estimate' && (e.status !== 'declined' || e.id === entry?.experience_id))
  const initial = (entry && experiences.find((e) => e.id === entry.experience_id)) || (experienceId ? experiences.find((e) => e.id === experienceId) : null) || lastLogged(experiences, logs)
  const today = todayDay()
  const [expId, setExpId] = useState(initial?.id ?? '')
  const exp = experiences.find((e) => e.id === expId) ?? null
  const meetings = exp ? KIND_META[exp.kind].tracks === 'meetings' : false
  const [date, setDate] = useState(entry?.on_date ?? defaultLogDay(initial ?? null, today, lastTuesday))
  const [mode, setMode] = useState<LogMode>(entry ? (entry.start_time && entry.end_time ? 'times' : 'hours') : savedLogMode)
  const [hours, setHours] = useState(entry?.hours != null ? String(entry.hours) : '')
  const [from, setFrom] = useState(hhmm(entry?.start_time ?? null))
  const [to, setTo] = useState(hhmm(entry?.end_time ?? null))
  const [note, setNote] = useState(entry?.note ?? '')
  const [saving, setSaving] = useState(false)
  if (logId && !entry) return null

  const fromTimes = hoursBetween(from, to)
  const value = meetings ? (mode === 'times' ? fromTimes : null) : mode === 'times' ? fromTimes : Number(hours) || null
  const valid = Boolean(exp) && isDay(date) && (meetings || (value !== null && value > 0 && value <= 24))
  const overnight = mode === 'times' && from && to && to < from
  const choose = (next: LogMode) => {
    setMode(next)
    try {
      localStorage.setItem(LOG_MODE_KEY, next)
    } catch {
      // Private storage off: it opens on the default next time.
    }
  }

  async function save() {
    if (!valid || !exp) return
    setSaving(true)
    const withTimes = mode === 'times' && fromTimes !== null
    const input = {
      on_date: date,
      start_time: withTimes ? from : null,
      end_time: withTimes ? to : null,
      hours: value,
      note: note.trim() || null,
    }
    const ok = entry ? await updateExpLog(entry, { ...input, experience_id: exp.id }) : await addExpLog(exp, input)
    setSaving(false)
    if (!ok) return
    toast.success(entry ? 'Entry saved' : meetings ? `Meeting logged · ${exp.name}` : `${amount(value ?? 0, 'h')} logged · ${exp.name}`, {
      description: `${amount(experienceTotal(exp, entry ? logs : [...logs, { ...input, id: '', experience_id: exp.id, created_by: null, created_at: '', updated_at: '' }]), unitOf(exp))} in all`,
    })
    close()
  }

  return (
    <MsSheet title={entry ? 'Edit entry' : meetings ? 'Log a meeting' : 'Log hours'} onClose={close}>
      {loggable.length === 0 ? (
        <p className="lg-dim text-[13.5px]">Nothing to log to yet. Add an experience first.</p>
      ) : (
        <div className="flex flex-col gap-4">
          <Field label="Experience">
            <select
              className="lg-field"
              value={expId}
              onChange={(e) => {
                setExpId(e.target.value)
                const next = experiences.find((x) => x.id === e.target.value)
                if (!entry && next) setDate(defaultLogDay(next, today, lastTuesday))
              }}
            >
              {loggable.map((e) => (
                <option key={e.id} value={e.id}>
                  {e.name} — {KIND_META[e.kind].label}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Date" hint={meetings && date !== today && !entry ? 'The last Tuesday — club meetings are usually then.' : undefined}>
            <input type="date" className="lg-field lg-field--mono" value={date} max={today} onChange={(e) => setDate(e.target.value)} />
          </Field>
          {!meetings && (
            <div>
              <div className="mb-3 flex gap-1.5" role="group" aria-label="How to enter the hours">
                <button type="button" className="lg-filter flex-1" aria-pressed={mode === 'times'} onClick={() => choose('times')}>
                  From – to
                </button>
                <button type="button" className="lg-filter flex-1" aria-pressed={mode === 'hours'} onClick={() => choose('hours')}>
                  Hours
                </button>
              </div>
              {mode === 'times' ? (
                <>
                  <div className="grid grid-cols-2 gap-2">
                    <Field label="From">
                      <input type="time" className="lg-field lg-field--mono" value={from} onChange={(e) => setFrom(e.target.value)} />
                    </Field>
                    <Field label="To">
                      <input type="time" className="lg-field lg-field--mono" value={to} onChange={(e) => setTo(e.target.value)} />
                    </Field>
                  </div>
                  <p className="mt-2 text-[13.5px]" aria-live="polite">
                    {fromTimes ? (
                      <>
                        <span className="lg-num lg-live text-[16px]">{amount(fromTimes, 'h')}</span>
                        <span className="lg-dim"> · {timeRange(from, to)}</span>
                        {overnight && <span className="lg-dim"> · past midnight</span>}
                      </>
                    ) : (
                      <span className="lg-dim">Pick when you got there and when you left.</span>
                    )}
                  </p>
                </>
              ) : (
                <Field label="Hours">
                  <input className="lg-field lg-field--mono" inputMode="decimal" value={hours} onChange={(e) => setHours(e.target.value)} />
                </Field>
              )}
            </div>
          )}
          <Field label="Note">
            <input className="lg-field" value={note} onChange={(e) => setNote(e.target.value)} />
          </Field>
          {exp && capWarnings(exp, experienceTotal(exp, logs) + (entry ? 0 : (value ?? 0)), today).map((w) => (
            <p key={w.text} className="lg-warn-text text-[12.5px] leading-snug">
              {w.text}
            </p>
          ))}
        </div>
      )}
      <Actions>
        <button type="button" className="lg-btn lg-btn--primary" disabled={!valid || saving} onClick={() => void save()}>
          {entry ? 'Save entry' : meetings ? 'Log meeting' : 'Log hours'}
        </button>
        {entry && (
          <button
            type="button"
            className="lg-btn lg-btn--ghost"
            onClick={() => {
              close()
              void removeExpLog(entry)
            }}
          >
            Remove entry
          </button>
        )}
      </Actions>
    </MsSheet>
  )
}
