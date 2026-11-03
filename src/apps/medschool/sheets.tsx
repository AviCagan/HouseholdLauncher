import { useMemo, useState, type ReactNode } from 'react'
import { toast } from 'sonner'
import { Sheet } from '@/components/primitives/Sheet'
import { useData } from '@/store/useData'
import { useMembers } from '@/store/useMember'
import type { MsCategory, MsLetterStatus } from '@/data/types'
import {
  ANCHOR_LABEL,
  ANCHORS,
  anchorsFor,
  calendarOf,
  dateFlags,
  isDay,
  lastTuesday,
  renderNote,
  resolveDue,
  shortDay,
  todayDay,
  weekdayDay,
} from './dates'
import {
  addCourse,
  addLog,
  addTask,
  deleteTask,
  loggedFor,
  removeCourse,
  removePractice,
  savePractice,
  setCounterTotal,
  setHidden,
  setLetterStatus,
  setTestDate,
  toggleTask,
  updateCourse,
  updateTask,
} from './actions'
import { CATEGORIES, CATEGORY_LABEL, defaultCategory, DEFAULT_SCALE, isOverridden, NON_GPA_GRADES } from './gpa'
import { LETTER_STATUSES } from './plan'
import { useMs, useMsUI } from './store'
import { AREAS, amount, hoursBetween, LETTER_LABEL, timeRange } from './labels'
import { Chip, Field, SwitchRow } from './ui'

/** Every sheet is the launcher's own, dressed for the grid. */
function MsSheet({ title, onClose, children }: { title: ReactNode; onClose: () => void; children: ReactNode }) {
  return (
    <Sheet open onClose={onClose} title={title} className="lg-sheet" maxHeight="88vh">
      {children}
    </Sheet>
  )
}

function Actions({ children }: { children: ReactNode }) {
  return <div className="mt-5 flex flex-wrap gap-2">{children}</div>
}

// --- a task ----------------------------------------------------------------------

export function TaskSheet({ taskId }: { taskId: string | null }) {
  const close = useMsUI((s) => s.close)
  const { anchors, settings } = useMs()
  const task = useData((s) => (taskId ? s.ms_tasks.find((t) => t.id === taskId) : undefined))
  const members = useMembers()
  const isNew = taskId === null
  const [title, setTitle] = useState(task?.title ?? '')
  const [area, setArea] = useState(task?.area ?? 'MCAT')
  const [note, setNote] = useState(task?.note ?? '')
  const [hard, setHard] = useState(task?.hard ?? false)
  const [anchored, setAnchored] = useState(Boolean(task?.due_anchor))
  const [anchor, setAnchor] = useState(task?.due_anchor ?? 'T')
  const [offset, setOffset] = useState(String(task?.due_offset ?? 0))
  const [fixed, setFixed] = useState(task?.due_fixed ?? (task ? (resolveDue(task, anchors) ?? '') : todayDay()))
  const [saving, setSaving] = useState(false)

  if (!isNew && !task) return null
  const offsetN = Number(offset)
  const due = anchored ? (anchors ? resolveDue({ due_fixed: null, due_anchor: anchor, due_offset: Number.isInteger(offsetN) ? offsetN : 0 }, anchors) : null) : fixed
  const valid = title.trim().length > 0 && (anchored ? Number.isInteger(offsetN) : isDay(fixed))
  const by = task?.done_by ? members.find((m) => m.id === task.done_by)?.display_name : null

  async function save() {
    if (!valid) return
    setSaving(true)
    const input = {
      title: title.trim(),
      area,
      note: note.trim() || null,
      hard,
      due_fixed: anchored ? null : fixed,
      due_anchor: anchored ? anchor : null,
      due_offset: anchored ? offsetN : 0,
    }
    const ok = task ? await updateTask(task, input) : Boolean(await addTask(input))
    setSaving(false)
    if (ok) {
      if (task) toast.success('Saved')
      close()
    }
  }

  return (
    <MsSheet title={isNew ? 'New task' : 'Task'} onClose={close}>
      <div className="flex flex-col gap-4">
        <Field label="Title">
          <input className="lg-field" value={title} onChange={(e) => setTitle(e.target.value)} />
        </Field>
        <Field label="Area">
          <select className="lg-field" value={area} onChange={(e) => setArea(e.target.value)}>
            {[...new Set([...AREAS, area])].map((a) => (
              <option key={a} value={a}>
                {a}
              </option>
            ))}
          </select>
        </Field>

        {task?.builtin && task.due_anchor ? (
          <div>
            <SwitchRow
              label="Moves with the test date"
              hint={anchored ? `Days from ${ANCHOR_LABEL[anchor].toLowerCase()}` : 'Pinned to a fixed date'}
              on={anchored}
              onChange={setAnchored}
            />
          </div>
        ) : null}

        {anchored ? (
          <div className="grid grid-cols-[1fr_96px] gap-2">
            <Field label="From">
              <select className="lg-field" value={anchor} onChange={(e) => setAnchor(e.target.value as typeof anchor)}>
                {ANCHORS.map((a) => (
                  <option key={a} value={a}>
                    {ANCHOR_LABEL[a]}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Days">
              <input className="lg-field lg-field--mono" inputMode="numeric" value={offset} onChange={(e) => setOffset(e.target.value)} />
            </Field>
          </div>
        ) : (
          <Field label="Date">
            <input type="date" className="lg-field lg-field--mono" value={fixed} onChange={(e) => setFixed(e.target.value)} />
          </Field>
        )}
        <p className="lg-num lg-dim -mt-2 text-[12px]">{due ? `Due ${weekdayDay(due)}` : anchors ? '' : 'Pick a test date to work this out.'}</p>

        <SwitchRow label="Hard deadline" hint="Reminders three days before and on the day." on={hard} onChange={setHard} />
        <Field label="Note" hint={note.includes('{') ? renderNote(note, anchors) : undefined}>
          <textarea className="lg-field" rows={4} value={note} onChange={(e) => setNote(e.target.value)} />
        </Field>
        {task?.estimated && <Chip>The date is an estimate</Chip>}
        {task?.done_at && (
          <p className="lg-num lg-dim text-[12px]">
            Done {shortDay(todayDay(new Date(task.done_at)))}
            {by ? ` by ${by}` : ''}
          </p>
        )}
      </div>

      <Actions>
        <button type="button" className="lg-btn lg-btn--primary" disabled={!valid || saving} onClick={() => void save()}>
          {isNew ? 'Add task' : 'Save'}
        </button>
        {task && (
          <button
            type="button"
            className="lg-btn"
            onClick={() => {
              void toggleTask(task)
              close()
            }}
          >
            {task.done_at ? 'Mark not done' : 'Mark done'}
          </button>
        )}
        {task && task.builtin && (
          <button
            type="button"
            className="lg-btn lg-btn--ghost"
            onClick={() => {
              void setHidden(task, !task.hidden)
              close()
            }}
          >
            {task.hidden ? 'Show again' : 'Hide'}
          </button>
        )}
        {task && !task.builtin && (
          <button
            type="button"
            className="lg-btn lg-btn--warn"
            onClick={() => {
              void deleteTask(task)
              close()
            }}
          >
            Delete
          </button>
        )}
      </Actions>
      {settings && !settings.test_date && anchored && <p className="lg-warn-text mt-3 text-[12px]">No test date is set yet.</p>}
    </MsSheet>
  )
}

// --- the test date ---------------------------------------------------------------

export function DateSheet() {
  const close = useMsUI((s) => s.close)
  const { settings, views } = useMs()
  const ref = useMemo(() => settings?.reference ?? {}, [settings])
  const calendar = calendarOf(ref)
  const commencement = ref.commencement?.date ?? null
  const [pick, setPick] = useState<string | null>(null)

  const moving = useMemo(() => {
    if (!pick) return 0
    const next = anchorsFor(pick, ref)
    return views.filter((v) => v.task.due_anchor && resolveDue(v.task, next) !== v.due).length
  }, [pick, ref, views])

  if (pick) {
    const next = anchorsFor(pick, ref)
    return (
      <MsSheet title="Change the test date" onClose={close}>
        <p className="text-[15px]">
          Move the plan to <span className="lg-num lg-live">{weekdayDay(pick)}</span>?
        </p>
        <p className="lg-dim mt-2 text-[13.5px] leading-snug">
          {moving} {moving === 1 ? 'date moves' : 'dates move'} with it.
          {next && (
            <>
              {' '}
              Scores out <span className="lg-num">{shortDay(next.score)}</span>, earliest committee interview{' '}
              <span className="lg-num">{shortDay(next.csiInterview)}</span>.
            </>
          )}
        </p>
        {settings?.booked && settings.test_date && (
          <p className="lg-warn-text mt-3 text-[13px] leading-snug">
            You're booked for {weekdayDay(settings.test_date)}. This changes the plan here, not your AAMC appointment.
          </p>
        )}
        <Actions>
          <button
            type="button"
            className="lg-btn lg-btn--primary"
            onClick={() => {
              void setTestDate(pick)
              close()
            }}
          >
            Move the plan
          </button>
          <button type="button" className="lg-btn" onClick={() => setPick(null)}>
            Back
          </button>
        </Actions>
      </MsSheet>
    )
  }

  return (
    <MsSheet title="2027 test dates" onClose={close}>
      {calendar.length === 0 && <p className="lg-dim text-[13.5px]">No MCAT calendar in the plan yet. Import one in settings.</p>}
      <ul>
        {calendar.map((row) => {
          const flags = dateFlags(row, commencement)
          const current = row.testDate === settings?.test_date
          return (
            <li key={row.testDate} className="lg-rule first:border-t-0">
              <button
                type="button"
                disabled={current}
                className="flex min-h-[52px] w-full items-center gap-3 py-2 text-left"
                onClick={() => setPick(row.testDate)}
              >
                <span className="min-w-0 flex-1">
                  <span className={`lg-num block text-[14px] ${current ? 'lg-live' : ''}`}>{weekdayDay(row.testDate)}</span>
                  <span className="lg-num lg-dim block text-[11.5px]">scores {shortDay(row.scoreRelease)}</span>
                </span>
                <span className="flex flex-wrap justify-end gap-1">
                  {current && <Chip tone="solid">current</Chip>}
                  {flags.selectCenters && <Chip>select centers</Chip>}
                  {flags.saturday && <Chip tone="warn">Saturday</Chip>}
                  {flags.nearCommencement && <Chip tone="warn">near commencement</Chip>}
                </span>
              </button>
            </li>
          )
        })}
      </ul>
    </MsSheet>
  )
}

// --- counters --------------------------------------------------------------------

/** How hours were last entered, so the sheet opens the way you use it. */
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
 * Log hours, or a meeting. Hours can be typed in, or worked out from when
 * you got there and when you left — and then the times go in the note, the
 * way the log has always recorded them.
 */
export function LogSheet({ counterId }: { counterId: string }) {
  const close = useMsUI((s) => s.close)
  const counter = useData((s) => s.ms_counters.find((c) => c.id === counterId))
  const today = todayDay()
  const meetings = counter?.unit !== 'h'
  const [date, setDate] = useState(meetings ? lastTuesday(today) : today)
  const [mode, setMode] = useState<LogMode>(savedLogMode)
  const [hours, setHours] = useState('')
  const [from, setFrom] = useState('')
  const [to, setTo] = useState('')
  const [note, setNote] = useState('')
  if (!counter) return null
  const fromTimes = hoursBetween(from, to)
  const value = meetings ? 1 : mode === 'times' ? (fromTimes ?? 0) : Number(hours)
  const valid = isDay(date) && value > 0 && value <= 24
  const overnight = mode === 'times' && from && to && to < from
  const choose = (next: LogMode) => {
    setMode(next)
    try {
      localStorage.setItem(LOG_MODE_KEY, next)
    } catch {
      // Private storage off: it just opens on the default next time.
    }
  }
  const noteToSave = !meetings && mode === 'times' && fromTimes ? [note.trim(), timeRange(from, to)].filter(Boolean).join(', ') : note

  return (
    <MsSheet title={meetings ? 'Log a meeting' : `Log ${counter.label.toLowerCase()}`} onClose={close}>
      <div className="flex flex-col gap-4">
        <Field label="Date" hint={meetings && date !== today ? 'The last Tuesday — club meetings are usually then.' : undefined}>
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
      </div>
      <Actions>
        <button
          type="button"
          className="lg-btn lg-btn--primary"
          disabled={!valid}
          onClick={() => {
            void addLog(counter, date, value, noteToSave).then((ok) => {
              if (ok) {
                toast.success(meetings ? 'Meeting logged' : `${amount(value, 'h')} logged`)
                close()
              }
            })
          }}
        >
          {meetings ? 'Log meeting' : 'Log hours'}
        </button>
      </Actions>
    </MsSheet>
  )
}

export function TotalSheet({ counterId }: { counterId: string }) {
  const close = useMsUI((s) => s.close)
  const counter = useData((s) => s.ms_counters.find((c) => c.id === counterId))
  const logs = useData((s) => s.ms_counter_logs)
  const logged = counter ? loggedFor(counter.id, logs) : 0
  const [total, setTotal] = useState(counter ? String(Math.round((counter.undated + logged) * 100) / 100) : '')
  if (!counter) return null
  const value = Number(total)
  return (
    <MsSheet title={`Set the ${counter.label.toLowerCase()} total`} onClose={close}>
      <Field label="Total" hint={`The log adds up to ${amount(logged, counter.unit)}; the rest counts as from before dates were kept.`}>
        <input className="lg-field lg-field--mono" inputMode="decimal" value={total} onChange={(e) => setTotal(e.target.value)} />
      </Field>
      <Actions>
        <button
          type="button"
          className="lg-btn lg-btn--primary"
          disabled={!(value >= 0) || total.trim() === ''}
          onClick={() => {
            void setCounterTotal(counter, value).then((ok) => ok && close())
          }}
        >
          Set total
        </button>
      </Actions>
    </MsSheet>
  )
}

// --- a letter ----------------------------------------------------------------------

export function LetterSheet({ letterId }: { letterId: string }) {
  const close = useMsUI((s) => s.close)
  const letter = useData((s) => s.ms_letters.find((l) => l.id === letterId))
  if (!letter) return null
  const dateOf: Record<MsLetterStatus, string | null> = {
    not_asked: null,
    asked: letter.asked_on,
    agreed: letter.agreed_on,
    received: letter.received_on,
  }
  return (
    <MsSheet title="Letter" onClose={close}>
      <p className="text-[15px] font-medium">{letter.title}</p>
      {letter.note && <p className="lg-dim mt-1 text-[13px] leading-snug">{letter.note}</p>}
      <ul className="mt-4">
        {LETTER_STATUSES.map((s) => (
          <li key={s} className="lg-rule first:border-t-0">
            <button
              type="button"
              className="flex min-h-[52px] w-full items-center gap-3 text-left"
              aria-pressed={letter.status === s}
              onClick={() => {
                void setLetterStatus(letter, s)
                close()
              }}
            >
              <span className="lg-node !h-6 !w-6" data-done={letter.status === s} aria-hidden>
                <span />
              </span>
              <span className="flex-1 text-[14.5px]">{LETTER_LABEL[s]}</span>
              {dateOf[s] && <span className="lg-num lg-dim text-[12px]">{shortDay(dateOf[s]!)}</span>}
            </button>
          </li>
        ))}
      </ul>
    </MsSheet>
  )
}

// --- a course ----------------------------------------------------------------------

const GRADES = [...Object.keys(DEFAULT_SCALE), ...NON_GPA_GRADES]

export function CourseSheet({ courseId, term: presetTerm }: { courseId: string | null; term?: string }) {
  const close = useMsUI((s) => s.close)
  const course = useData((s) => (courseId ? s.ms_courses.find((c) => c.id === courseId) : undefined))
  const courses = useData((s) => s.ms_courses)
  const terms = useMemo(() => [...new Set(courses.map((c) => c.term))], [courses])
  const [term, setTerm] = useState(course?.term ?? presetTerm ?? '')
  const [code, setCode] = useState(course?.code ?? '')
  const [title, setTitle] = useState(course?.title ?? '')
  const [credits, setCredits] = useState(String(course?.credits ?? 3))
  const [grade, setGrade] = useState(course?.grade ?? 'IP')
  const [category, setCategory] = useState<MsCategory | null>(course && isOverridden(course) ? course.category : null)
  const [doubt, setDoubt] = useState(course?.maybe_nonscience ?? false)
  const [note, setNote] = useState(course?.category_note ?? '')
  if (courseId && !course) return null
  const effective = category ?? defaultCategory(code)
  const creditsN = Number(credits)
  const valid = term.trim() && code.trim() && creditsN >= 0 && Number.isFinite(creditsN)

  async function save() {
    if (!valid) return
    const input = {
      term: term.trim(),
      code: code.trim().toUpperCase(),
      title: title.trim() || null,
      grade: grade || null,
      credits: creditsN,
      category: effective,
      category_note: note.trim() || null,
      maybe_nonscience: doubt,
    }
    const ok = course ? await updateCourse(course, input) : await addCourse(input)
    if (ok) close()
  }

  return (
    <MsSheet title={course ? course.code : 'Add a course'} onClose={close}>
      <div className="flex flex-col gap-4">
        <div className="grid grid-cols-2 gap-2">
          <Field label="Term" hint="Like “Winter 2027”">
            <input className="lg-field" list="ms-terms" value={term} onChange={(e) => setTerm(e.target.value)} />
            <datalist id="ms-terms">
              {terms.map((t) => (
                <option key={t} value={t} />
              ))}
            </datalist>
          </Field>
          <Field label="Code">
            <input className="lg-field lg-field--mono" value={code} onChange={(e) => setCode(e.target.value)} autoCapitalize="characters" />
          </Field>
        </div>
        <Field label="Title">
          <input className="lg-field" value={title} onChange={(e) => setTitle(e.target.value)} />
        </Field>
        <div className="grid grid-cols-2 gap-2">
          <Field label="Grade">
            <select className="lg-field lg-field--mono" value={grade} onChange={(e) => setGrade(e.target.value)}>
              {GRADES.map((g) => (
                <option key={g} value={g}>
                  {g === 'IP' ? 'IP (in progress)' : g === 'W' ? 'W (withdrew)' : g === 'P' ? 'P (pass)' : g}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Credits">
            <input className="lg-field lg-field--mono" inputMode="decimal" value={credits} onChange={(e) => setCredits(e.target.value)} />
          </Field>
        </div>
        <Field label="Category" hint={category ? 'Set by hand.' : `From the subject code: ${CATEGORY_LABEL[defaultCategory(code)]}.`}>
          <select className="lg-field" value={category ?? ''} onChange={(e) => setCategory((e.target.value || null) as MsCategory | null)}>
            <option value="">From the code ({CATEGORY_LABEL[defaultCategory(code)]})</option>
            {CATEGORIES.map((c) => (
              <option key={c} value={c}>
                {CATEGORY_LABEL[c]}
              </option>
            ))}
          </select>
        </Field>
        {effective !== 'other' && (
          <SwitchRow label="Might not count as science" hint="Shows the science GPAs with and without it." on={doubt} onChange={setDoubt} />
        )}
        <Field label="Note">
          <input className="lg-field" value={note} onChange={(e) => setNote(e.target.value)} />
        </Field>
      </div>
      <Actions>
        <button type="button" className="lg-btn lg-btn--primary" disabled={!valid} onClick={() => void save()}>
          {course ? 'Save' : 'Add course'}
        </button>
        {course && (
          <button
            type="button"
            className="lg-btn lg-btn--warn"
            onClick={() => {
              void removeCourse(course)
              close()
            }}
          >
            Remove
          </button>
        )}
      </Actions>
    </MsSheet>
  )
}

// --- a practice test ------------------------------------------------------------------

const SECTIONS = [
  ['cp', 'Chem/Phys'],
  ['cars', 'CARS'],
  ['bb', 'Bio/Biochem'],
  ['ps', 'Psych/Soc'],
] as const

export function PracticeSheet({ practiceId }: { practiceId: string | null }) {
  const close = useMsUI((s) => s.close)
  const existing = useData((s) => (practiceId ? s.ms_practice.find((p) => p.id === practiceId) : undefined))
  const [date, setDate] = useState(existing?.taken_on ?? todayDay())
  const [source, setSource] = useState(existing?.source ?? '')
  const [total, setTotal] = useState(existing?.total ? String(existing.total) : '')
  const [sections, setSections] = useState<Record<string, string>>({
    cp: existing?.cp ? String(existing.cp) : '',
    cars: existing?.cars ? String(existing.cars) : '',
    bb: existing?.bb ? String(existing.bb) : '',
    ps: existing?.ps ? String(existing.ps) : '',
  })
  const [note, setNote] = useState(existing?.note ?? '')
  if (practiceId && !existing) return null

  const parsed = SECTIONS.map(([k]) => (sections[k].trim() ? Number(sections[k]) : null))
  const sectionBad = parsed.some((v) => v !== null && !(Number.isInteger(v) && v >= 118 && v <= 132))
  const allSections = parsed.every((v) => v !== null)
  const sum = allSections ? (parsed as number[]).reduce((a, b) => a + b, 0) : null
  const totalN = total.trim() ? Number(total) : sum
  const totalBad = totalN !== null && !(Number.isInteger(totalN) && totalN >= 472 && totalN <= 528)
  const valid = isDay(date) && !sectionBad && !totalBad && totalN !== null

  return (
    <MsSheet title={existing ? 'Practice test' : 'Add a practice score'} onClose={close}>
      <div className="flex flex-col gap-4">
        <div className="grid grid-cols-2 gap-2">
          <Field label="Date">
            <input type="date" className="lg-field lg-field--mono" value={date} onChange={(e) => setDate(e.target.value)} />
          </Field>
          <Field label="Source" hint="AAMC FL1, Blueprint FL2">
            <input className="lg-field" value={source} onChange={(e) => setSource(e.target.value)} />
          </Field>
        </div>
        <div className="grid grid-cols-4 gap-2">
          {SECTIONS.map(([k, label]) => (
            <Field key={k} label={label}>
              <input
                className="lg-field lg-field--mono !px-2 text-center"
                inputMode="numeric"
                value={sections[k]}
                aria-invalid={sections[k].trim() !== '' && (Number(sections[k]) < 118 || Number(sections[k]) > 132)}
                onChange={(e) => setSections((s) => ({ ...s, [k]: e.target.value }))}
              />
            </Field>
          ))}
        </div>
        <Field label="Total" hint={sectionBad ? 'Each section is 118–132.' : totalBad ? 'The total is 472–528.' : sum && !total.trim() ? `From the sections: ${sum}.` : '472–528'}>
          <input className="lg-field lg-field--mono" inputMode="numeric" value={total} onChange={(e) => setTotal(e.target.value)} />
        </Field>
        <Field label="Note">
          <input className="lg-field" value={note} onChange={(e) => setNote(e.target.value)} />
        </Field>
      </div>
      <Actions>
        <button
          type="button"
          className="lg-btn lg-btn--primary"
          disabled={!valid}
          onClick={() => {
            const [cp, cars, bb, ps] = parsed
            void savePractice({ taken_on: date, source: source.trim() || null, total: totalN, cp, cars, bb, ps, note: note.trim() || null }, existing).then((ok) => ok && close())
          }}
        >
          Save
        </button>
        {existing && (
          <button
            type="button"
            className="lg-btn lg-btn--warn"
            onClick={() => {
              void removePractice(existing)
              close()
            }}
          >
            Remove
          </button>
        )}
      </Actions>
    </MsSheet>
  )
}
