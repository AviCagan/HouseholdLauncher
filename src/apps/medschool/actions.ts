import { toast } from 'sonner'
import { useData } from '@/store/useData'
import { useProfile } from '@/store/useProfile'
import { newId, nowIso } from '@/data/adapter'
import { fire } from '@/lib/haptics'
import type {
  MsCounter,
  MsCounterLog,
  MsCourse,
  MsEligibility,
  MsLetter,
  MsLetterStatus,
  MsPractice,
  MsQuestion,
  MsSettings,
  MsTask,
} from '@/data/types'
import { anchorsFor, resolveDue, todayDay, type Day } from './dates'
import { LETTER_STATUSES, type PlanRows } from './plan'

/**
 * Every write Med School makes.
 *
 * Optimistic like the rest of the launcher: the change is on screen first,
 * and a failure puts the row back and says so. Checking a task off records
 * when and by whom, and comes with an undo.
 */

type MsTable =
  | 'ms_settings'
  | 'ms_tasks'
  | 'ms_counters'
  | 'ms_counter_logs'
  | 'ms_eligibility'
  | 'ms_letters'
  | 'ms_courses'
  | 'ms_practice'
  | 'ms_questions'

type RowOf<T extends MsTable> = T extends 'ms_settings'
  ? MsSettings
  : T extends 'ms_tasks'
    ? MsTask
    : T extends 'ms_counters'
      ? MsCounter
      : T extends 'ms_counter_logs'
        ? MsCounterLog
        : T extends 'ms_eligibility'
          ? MsEligibility
          : T extends 'ms_letters'
            ? MsLetter
            : T extends 'ms_courses'
              ? MsCourse
              : T extends 'ms_practice'
                ? MsPractice
                : MsQuestion

const keyOf = (table: MsTable, row: unknown): string => (table === 'ms_settings' ? 'singleton' : (row as { id: string }).id)

function rows<T extends MsTable>(table: T): RowOf<T>[] {
  return useData.getState()[table] as unknown as RowOf<T>[]
}

function put<T extends MsTable>(table: T, row: RowOf<T>): void {
  const list = rows(table)
  const key = keyOf(table, row)
  const next = list.some((r) => keyOf(table, r) === key) ? list.map((r) => (keyOf(table, r) === key ? row : r)) : [...list, row]
  useData.setState({ [table]: next } as never)
}

function drop(table: MsTable, key: string): void {
  useData.setState({ [table]: rows(table).filter((r) => keyOf(table, r) !== key) } as never)
}

const adapter = () => useData.getState().adapter
const me = () => useProfile.getState().profileId

function failed(message: string, err: unknown): void {
  fire('error')
  toast.error(message)
  console.error('[medschool]', err)
}

/** Patch one row, putting it back exactly as it was on failure. */
async function updateRow<T extends MsTable>(table: T, before: RowOf<T>, patch: Partial<RowOf<T>>, failMessage = "Couldn't save that"): Promise<boolean> {
  put(table, { ...before, ...patch, updated_at: nowIso() } as RowOf<T>)
  try {
    await adapter().update(table, keyOf(table, before), patch as never)
    return true
  } catch (err) {
    put(table, before)
    failed(failMessage, err)
    return false
  }
}

async function insertRow<T extends MsTable>(table: T, row: RowOf<T>, failMessage = "Couldn't add that"): Promise<boolean> {
  put(table, row)
  try {
    await adapter().insert(table, row as never)
    return true
  } catch (err) {
    drop(table, keyOf(table, row))
    failed(failMessage, err)
    return false
  }
}

async function removeRow<T extends MsTable>(table: T, row: RowOf<T>, failMessage = "Couldn't remove that"): Promise<boolean> {
  drop(table, keyOf(table, row))
  try {
    await adapter().remove(table, keyOf(table, row))
    return true
  } catch (err) {
    put(table, row)
    failed(failMessage, err)
    return false
  }
}

const latest = <T extends MsTable>(table: T, id: string): RowOf<T> | undefined => rows(table).find((r) => keyOf(table, r) === id)

// --- settings ----------------------------------------------------------------------

export const settingsRow = (): MsSettings | undefined => rows('ms_settings')[0]

function blankSettings(): MsSettings {
  return {
    singleton: true,
    test_date: null,
    booked: false,
    order_number: null,
    target_score: null,
    show_estimated: true,
    reference: {},
    updated_by: me(),
    updated_at: nowIso(),
  }
}

/** Change the settings row, making it first if this device has never had one. */
export async function updateSettings(patch: Partial<MsSettings>): Promise<boolean> {
  const before = settingsRow()
  if (before) return updateRow('ms_settings', before, { ...patch, updated_by: me() })
  const row = { ...blankSettings(), ...patch }
  put('ms_settings', row)
  try {
    await adapter().insert('ms_settings', row)
    return true
  } catch {
    // The migration inserts the row; a device that missed it updates instead.
    try {
      await adapter().update('ms_settings', 'singleton', patch as never)
      return true
    } catch (err) {
      drop('ms_settings', 'singleton')
      failed("Couldn't save that", err)
      return false
    }
  }
}

/**
 * Bring every task's stored date in line with the current test date.
 *
 * The date is derived — anchored tasks follow the test date — and stored only
 * so the reminder sweep on the server can find what's due. Run after the date
 * changes, and on opening the app, which also heals anything a failed write
 * left behind.
 */
export async function syncDueDates(): Promise<number> {
  const settings = settingsRow()
  const anchors = anchorsFor(settings?.test_date ?? null, settings?.reference)
  const stale = rows('ms_tasks').filter((t) => resolveDue(t, anchors) !== t.due_on)
  for (const t of stale) {
    const due_on = resolveDue(t, anchors)
    put('ms_tasks', { ...t, due_on })
    try {
      await adapter().update('ms_tasks', t.id, { due_on })
    } catch (err) {
      put('ms_tasks', t)
      console.warn('[medschool] due date', err)
    }
  }
  return stale.length
}

/** Move the plan to another MCAT date. Every anchored task moves with it. */
export async function setTestDate(date: Day): Promise<void> {
  if (!(await updateSettings({ test_date: date }))) return
  const moved = await syncDueDates()
  fire('success')
  toast.success('Test date changed', { description: moved ? `${moved} dates moved with it.` : undefined })
}

// --- tasks ---------------------------------------------------------------------------

/** Mark done or open again, with an undo either way. */
export async function toggleTask(task: MsTask): Promise<void> {
  const before = latest('ms_tasks', task.id) ?? task
  const doneNow = !before.done_at
  fire(doneNow ? 'complete' : 'toggleOff')
  const ok = await updateRow('ms_tasks', before, doneNow ? { done_at: nowIso(), done_by: me() } : { done_at: null, done_by: null })
  if (!ok) return
  toast(doneNow ? 'Marked done' : 'Marked not done', {
    description: before.title,
    action: {
      label: 'Undo',
      onClick: () => {
        const now = latest('ms_tasks', task.id)
        if (now) void updateRow('ms_tasks', now, { done_at: before.done_at, done_by: before.done_by })
      },
    },
  })
}

export interface TaskInput {
  title: string
  area: string
  note: string | null
  hard: boolean
  due_fixed: Day | null
  due_anchor: MsTask['due_anchor']
  due_offset: number
}

export async function addTask(input: TaskInput): Promise<MsTask | null> {
  const settings = settingsRow()
  const anchors = anchorsFor(settings?.test_date ?? null, settings?.reference)
  const stamp = nowIso()
  const row: MsTask = {
    id: newId(),
    ...input,
    title: input.title.trim(),
    due_on: resolveDue(input, anchors),
    estimated: false,
    builtin: false,
    hidden: false,
    done_at: null,
    done_by: null,
    reminded_early_for: null,
    reminded_day_for: null,
    created_by: me(),
    created_at: stamp,
    updated_at: stamp,
  }
  if (!(await insertRow('ms_tasks', row))) return null
  fire('success')
  return row
}

export async function updateTask(task: MsTask, patch: Partial<TaskInput> & { estimated?: boolean }): Promise<boolean> {
  const before = latest('ms_tasks', task.id) ?? task
  const settings = settingsRow()
  const next = { ...before, ...patch }
  const due_on = resolveDue(next, anchorsFor(settings?.test_date ?? null, settings?.reference))
  return updateRow('ms_tasks', before, { ...patch, due_on })
}

export async function setHidden(task: MsTask, hidden: boolean): Promise<void> {
  const before = latest('ms_tasks', task.id) ?? task
  if (!(await updateRow('ms_tasks', before, { hidden }))) return
  fire(hidden ? 'toggleOff' : 'toggleOn')
  if (hidden) {
    toast('Hidden', {
      description: `${before.title} — it's under Hidden at the end of the timeline.`,
      action: { label: 'Undo', onClick: () => void setHidden(before, false) },
    })
  }
}

/** Only tasks you added can go; the plan's own are hidden instead. */
export async function deleteTask(task: MsTask): Promise<void> {
  if (task.builtin) return setHidden(task, true)
  if (!(await removeRow('ms_tasks', task))) return
  fire('delete')
  toast('Deleted', { description: task.title, action: { label: 'Undo', onClick: () => void insertRow('ms_tasks', task) } })
}

// --- counters --------------------------------------------------------------------

export async function addLog(counter: MsCounter, on_date: Day, amount: number, note: string | null): Promise<boolean> {
  const stamp = nowIso()
  const row: MsCounterLog = { id: newId(), counter_id: counter.id, on_date, amount, note: note?.trim() || null, created_by: me(), created_at: stamp, updated_at: stamp }
  const ok = await insertRow('ms_counter_logs', row)
  if (ok) fire('success')
  return ok
}

export async function removeLog(log: MsCounterLog): Promise<void> {
  if (!(await removeRow('ms_counter_logs', log))) return
  fire('delete')
  toast('Entry removed', { action: { label: 'Undo', onClick: () => void insertRow('ms_counter_logs', log) } })
}

export const loggedFor = (counterId: string, logs: MsCounterLog[]): number =>
  logs.filter((l) => l.counter_id === counterId).reduce((s, l) => s + l.amount, 0)

/** Set the total outright: what isn't in the log becomes the undated starting amount. */
export async function setCounterTotal(counter: MsCounter, total: number): Promise<boolean> {
  const logged = loggedFor(counter.id, rows('ms_counter_logs'))
  if (total < logged) {
    toast.error(`The log already adds up to ${logged}`, { description: 'Remove entries to go lower.' })
    return false
  }
  const before = latest('ms_counters', counter.id) ?? counter
  return updateRow('ms_counters', before, { undated: Math.round((total - logged) * 100) / 100 })
}

// --- eligibility, letters, questions --------------------------------------------------

/** Tick an eligibility item. One that is the same thing as a task ticks the task. */
export async function toggleEligibility(item: MsEligibility): Promise<void> {
  if (item.task_id) {
    const task = latest('ms_tasks', item.task_id)
    if (task) return toggleTask(task)
  }
  const before = latest('ms_eligibility', item.id) ?? item
  fire(before.met ? 'toggleOff' : 'toggleOn')
  await updateRow('ms_eligibility', before, { met: !before.met })
}

const STATUS_DATE: Record<MsLetterStatus, keyof MsLetter | null> = {
  not_asked: null,
  asked: 'asked_on',
  agreed: 'agreed_on',
  received: 'received_on',
}

/**
 * Move a letter to a status, recording the day it got there. Going back
 * clears the dates of the steps it's no longer at.
 */
export async function setLetterStatus(letter: MsLetter, status: MsLetterStatus, today: Day = todayDay()): Promise<void> {
  const before = latest('ms_letters', letter.id) ?? letter
  const at = LETTER_STATUSES.indexOf(status)
  const patch: Partial<MsLetter> = { status }
  LETTER_STATUSES.forEach((s, i) => {
    const key = STATUS_DATE[s]
    if (!key) return
    if (i > at) (patch as Record<string, unknown>)[key] = null
    else if (i <= at && !before[key]) (patch as Record<string, unknown>)[key] = today
  })
  fire(status === 'received' ? 'success' : 'tap')
  await updateRow('ms_letters', before, patch)
}

/** The tap: one step on, and round to the start after "received" (with an undo). */
export async function advanceLetter(letter: MsLetter): Promise<void> {
  const before = latest('ms_letters', letter.id) ?? letter
  const next = LETTER_STATUSES[(LETTER_STATUSES.indexOf(before.status) + 1) % LETTER_STATUSES.length]
  await setLetterStatus(before, next)
  if (next === 'not_asked') {
    toast('Back to not asked', {
      description: before.title,
      action: { label: 'Undo', onClick: () => void updateRow('ms_letters', latest('ms_letters', before.id) ?? before, before) },
    })
  }
}

export async function toggleQuestion(q: MsQuestion): Promise<void> {
  const before = latest('ms_questions', q.id) ?? q
  fire(before.done ? 'toggleOff' : 'complete')
  await updateRow('ms_questions', before, { done: !before.done, done_at: before.done ? null : nowIso() })
}

export async function addQuestion(text: string): Promise<void> {
  const sort = Math.max(0, ...rows('ms_questions').map((q) => q.sort)) + 1
  await insertRow('ms_questions', { id: newId(), text: text.trim(), done: false, done_at: null, sort, updated_at: nowIso() })
}

export async function removeQuestion(q: MsQuestion): Promise<void> {
  if (!(await removeRow('ms_questions', q))) return
  fire('delete')
  toast('Question removed', { action: { label: 'Undo', onClick: () => void insertRow('ms_questions', q) } })
}

// --- courses ------------------------------------------------------------------------

export type CourseInput = Pick<MsCourse, 'term' | 'code' | 'title' | 'grade' | 'credits' | 'category' | 'category_note' | 'maybe_nonscience'>

export async function addCourse(input: CourseInput): Promise<boolean> {
  const sort = Math.max(0, ...rows('ms_courses').map((c) => c.sort)) + 1
  const ok = await insertRow('ms_courses', { id: newId(), ...input, imported: false, sort, updated_at: nowIso() })
  if (ok) fire('success')
  return ok
}

export async function updateCourse(course: MsCourse, patch: Partial<CourseInput>): Promise<boolean> {
  return updateRow('ms_courses', latest('ms_courses', course.id) ?? course, patch)
}

export async function removeCourse(course: MsCourse): Promise<void> {
  if (!(await removeRow('ms_courses', course))) return
  fire('delete')
  toast('Course removed', { description: course.code, action: { label: 'Undo', onClick: () => void insertRow('ms_courses', course) } })
}

// --- practice tests -------------------------------------------------------------------

export type PracticeInput = Pick<MsPractice, 'taken_on' | 'source' | 'total' | 'cp' | 'cars' | 'bb' | 'ps' | 'note'>

export async function savePractice(input: PracticeInput, existing?: MsPractice): Promise<boolean> {
  if (existing) return updateRow('ms_practice', latest('ms_practice', existing.id) ?? existing, input)
  const stamp = nowIso()
  const ok = await insertRow('ms_practice', { id: newId(), ...input, created_by: me(), created_at: stamp, updated_at: stamp })
  if (ok) fire('success')
  return ok
}

export async function removePractice(p: MsPractice): Promise<void> {
  if (!(await removeRow('ms_practice', p))) return
  fire('delete')
  toast('Practice test removed', { action: { label: 'Undo', onClick: () => void insertRow('ms_practice', p) } })
}

// --- import ---------------------------------------------------------------------------

/** Insert or update every row of an imported plan. Nothing is deleted. */
export async function importRows(plan: PlanRows, onProgress?: (done: number, total: number) => void): Promise<{ written: number; failed: number }> {
  const jobs: (() => Promise<void>)[] = []
  let written = 0
  let failedCount = 0

  const upsert = <T extends Exclude<MsTable, 'ms_settings'>>(table: T, row: RowOf<T>) =>
    jobs.push(async () => {
      const existing = latest(table, keyOf(table, row))
      try {
        if (existing) {
          const { id: _id, created_at: _c, ...patch } = row as RowOf<T> & { created_at?: string }
          void _id
          void _c
          put(table, { ...existing, ...patch } as RowOf<T>)
          await adapter().update(table, keyOf(table, row), patch as never)
        } else {
          put(table, row)
          await adapter().insert(table, row as never)
        }
        written++
      } catch (err) {
        if (existing) put(table, existing)
        else drop(table, keyOf(table, row))
        failedCount++
        console.error('[medschool] import', table, keyOf(table, row), err)
      }
    })

  // Tasks before eligibility, which can point at them; counters before logs.
  plan.tasks.forEach((r) => upsert('ms_tasks', r))
  plan.counters.forEach((r) => upsert('ms_counters', r))
  const total = () => jobs.length + plan.logs.length + plan.eligibility.length + plan.letters.length + plan.courses.length + plan.practice.length + plan.questions.length + 1

  const all = total()
  let done = 0
  const run = async (list: (() => Promise<void>)[]) => {
    const queue = [...list]
    const workers = Array.from({ length: 6 }, async () => {
      for (let job = queue.shift(); job; job = queue.shift()) {
        await job()
        onProgress?.(++done, all)
      }
    })
    await Promise.all(workers)
  }

  const ok = await updateSettings(plan.settings)
  onProgress?.(++done, all)
  if (!ok) failedCount++
  else written++

  await run(jobs.splice(0))
  plan.logs.forEach((r) => upsert('ms_counter_logs', r))
  plan.eligibility.forEach((r) => upsert('ms_eligibility', r))
  plan.letters.forEach((r) => upsert('ms_letters', r))
  plan.courses.forEach((r) => upsert('ms_courses', r))
  plan.practice.forEach((r) => upsert('ms_practice', r))
  plan.questions.forEach((r) => upsert('ms_questions', r))
  await run(jobs.splice(0))

  return { written, failed: failedCount }
}
