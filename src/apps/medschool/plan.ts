import { parseISO, setHours } from 'date-fns'
import type {
  MsAnchor,
  MsCategory,
  MsCounter,
  MsCounterLog,
  MsCourse,
  MsEligibility,
  MsLetter,
  MsLetterStatus,
  MsPractice,
  MsQuestion,
  MsReference,
  MsSettings,
  MsTask,
} from '@/data/types'
import { anchorsFor, isAnchor, isDay, resolveDue, todayDay } from './dates'
import { CATEGORIES, DEFAULT_SCALE, defaultCategory, gpaSummary, NON_GPA_GRADES, type Scale } from './gpa'

/**
 * The plan as JSON: what Import reads and Export writes.
 *
 * One shape both ways, so a plan exported from the app, pasted into a
 * conversation, edited and pasted back in comes home intact. Import is an
 * upsert by id — it never deletes anything — so running it twice is safe.
 * Whatever in the blob isn't a row (the MCAT calendar, the fee table, the
 * committee's rules and contacts, notes) is kept whole in the settings row's
 * `reference` and handed back on export.
 */

export const LETTER_STATUSES: MsLetterStatus[] = ['not_asked', 'asked', 'agreed', 'received']

export interface PlanRows {
  settings: Pick<MsSettings, 'test_date' | 'booked' | 'order_number' | 'target_score' | 'show_estimated' | 'reference'>
  tasks: MsTask[]
  counters: MsCounter[]
  logs: MsCounterLog[]
  eligibility: MsEligibility[]
  letters: MsLetter[]
  courses: MsCourse[]
  practice: MsPractice[]
  questions: MsQuestion[]
}

export interface PlanCounts {
  tasks: number
  tasksDone: number
  counters: number
  logs: number
  eligibility: number
  eligibilityMet: number
  letters: number
  courses: number
  graded: number
  inProgress: number
  withdrawals: number
  practice: number
  questions: number
}

export type ParseResult =
  | { ok: true; rows: PlanRows; counts: PlanCounts; warnings: string[] }
  | { ok: false; errors: string[]; warnings: string[] }

type Obj = Record<string, unknown>
const isObj = (v: unknown): v is Obj => typeof v === 'object' && v !== null && !Array.isArray(v)
const str = (v: unknown): string | null => (typeof v === 'string' && v.trim() ? v.trim() : null)
const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null)
const bool = (v: unknown): boolean => v === true
/** A profile id, or nothing — a name here would break the reference to profiles. */
const uuid = (v: unknown): string | null =>
  typeof v === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v) ? v : null

export const slug = (s: string): string =>
  s
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')

/** A stable id for a course the plan didn't give one: its term and code. */
export const courseId = (term: string, code: string): string => `c-${slug(term)}-${slug(code)}`

/** A day-only `doneAt` becomes noon that day, local, so no time zone moves it. */
function doneAtIso(v: unknown): string | null {
  if (typeof v !== 'string' || !v) return null
  if (isDay(v)) return setHours(parseISO(v), 12).toISOString()
  const t = Date.parse(v)
  return Number.isNaN(t) ? null : new Date(t).toISOString()
}

/** Courses the plan's GPA notes name as possibly not science, by code. */
function ambiguousCodes(ref: MsReference): string[] {
  const text = ref.record?.gpaRules?.ambiguous
  if (typeof text !== 'string') return []
  return [...text.matchAll(/\b([A-Z]{2,4})\s?(\d{3})\b/g)].map((m) => `${m[1]} ${m[2]}`)
}

export function scaleOf(ref: MsReference | undefined): Scale {
  const scale = ref?.record?.gpaRules?.scale
  return isObj(scale) && Object.values(scale).every((v) => typeof v === 'number') ? (scale as Scale) : DEFAULT_SCALE
}

/** Parse and check a pasted plan. Nothing is written. */
export function parsePlan(input: string | unknown, now: Date = new Date()): ParseResult {
  const errors: string[] = []
  const warnings: string[] = []
  let blob: unknown = input
  if (typeof input === 'string') {
    try {
      blob = JSON.parse(input)
    } catch (err) {
      return { ok: false, errors: [`That isn't valid JSON: ${(err as Error).message}`], warnings }
    }
  }
  if (!isObj(blob)) return { ok: false, errors: ['Expected a JSON object with tasks, counters, letters and so on.'], warnings }

  const stamp = now.toISOString()
  const fail = (msg: string) => {
    if (errors.length < 25) errors.push(msg)
  }
  const list = (key: string, v: unknown): unknown[] => {
    if (v === undefined) return []
    if (!Array.isArray(v)) {
      fail(`"${key}" should be a list.`)
      return []
    }
    return v
  }

  // --- reference: everything that isn't a row --------------------------------
  const settingsIn = isObj(blob.settings) ? blob.settings : {}
  const committeeIn = isObj(blob.committee) ? blob.committee : {}
  const recordIn = isObj(blob.record) ? blob.record : {}
  const reference: MsReference = {}
  for (const [k, v] of Object.entries(blob)) {
    if (['tasks', 'eligibility', 'counters', 'letters', 'settings', 'committee', 'record', 'practiceTests'].includes(k)) continue
    reference[k] = v
  }
  for (const k of ['testCenter', 'commencement', 'schedulingPreference', 'contentStart'] as const) {
    if (settingsIn[k] !== undefined) reference[k] = settingsIn[k] as never
  }
  const { openQuestions, ...committeeRest } = committeeIn
  if (Object.keys(committeeRest).length) reference.committee = committeeRest as MsReference['committee']
  const { courses: coursesIn, summary: _summary, byYear: _byYear, computed: _computed, ...recordRest } = recordIn
  void _summary
  void _byYear
  void _computed
  if (Object.keys(recordRest).length) reference.record = recordRest as MsReference['record']

  const calendar = list('mcatCalendar2027', blob.mcatCalendar2027)
  calendar.forEach((row, i) => {
    if (!isObj(row) || !['testDate', 'scoreRelease', 'deadline60', 'deadline30', 'deadline10'].every((k) => isDay(row[k]))) {
      fail(`mcatCalendar2027[${i}]: needs testDate, scoreRelease and deadline60/30/10 as YYYY-MM-DD.`)
    }
  })

  // --- settings ------------------------------------------------------------------
  const testDate = settingsIn.testDate === undefined || settingsIn.testDate === null ? null : settingsIn.testDate
  if (testDate !== null && !isDay(testDate)) fail('settings.testDate should be YYYY-MM-DD.')
  const target = settingsIn.targetScore
  if (target !== undefined && target !== null && (num(target) === null || (target as number) < 472 || (target as number) > 528)) {
    fail('settings.targetScore should be between 472 and 528.')
  }
  const settings: PlanRows['settings'] = {
    test_date: isDay(testDate) ? testDate : null,
    booked: bool(settingsIn.booked),
    order_number: str(settingsIn.aamcOrderNumber),
    target_score: num(target),
    show_estimated: settingsIn.showEstimated === false ? false : true,
    reference,
  }
  const anchors = anchorsFor(settings.test_date, reference)
  if (settings.test_date && calendar.length && !anchors) {
    warnings.push(`The test date ${settings.test_date} isn't in the MCAT calendar, so dates that hang off it stay blank.`)
  }

  // --- tasks -----------------------------------------------------------------------
  const seen = new Set<string>()
  const tasks: MsTask[] = []
  list('tasks', blob.tasks).forEach((t, i) => {
    const where = `tasks[${i}]${isObj(t) && typeof t.id === 'string' ? ` (${t.id})` : ''}`
    if (!isObj(t)) return fail(`${where}: not an object.`)
    const id = str(t.id)
    const title = str(t.title)
    if (!id) return fail(`${where}: needs an id.`)
    if (seen.has(id)) return fail(`${where}: the id is used twice.`)
    seen.add(id)
    if (!title) return fail(`${where}: needs a title.`)
    const due = isObj(t.due) ? t.due : null
    const fixed = due && due.fixed !== undefined ? due.fixed : null
    const anchor = due && due.anchor !== undefined ? due.anchor : null
    if (fixed !== null && !isDay(fixed)) return fail(`${where}: due.fixed should be YYYY-MM-DD.`)
    if (anchor !== null && !isAnchor(anchor)) return fail(`${where}: "${String(anchor)}" isn't an anchor this app knows.`)
    if (fixed === null && anchor === null) return fail(`${where}: needs due.fixed or due.anchor.`)
    const offset = due && due.offsetDays !== undefined ? num(due.offsetDays) : 0
    if (offset === null || !Number.isInteger(offset)) return fail(`${where}: due.offsetDays should be a whole number.`)
    const row: MsTask = {
      id,
      title,
      area: str(t.area) ?? 'Other',
      due_fixed: fixed as string | null,
      due_anchor: fixed ? null : (anchor as MsAnchor),
      due_offset: fixed ? 0 : offset,
      due_on: null,
      hard: bool(t.hardDeadline),
      estimated: bool(t.estimated),
      note: str(t.note),
      builtin: t.custom !== true,
      hidden: bool(t.hidden),
      done_at: t.done === true ? (doneAtIso(t.doneAt) ?? stamp) : null,
      done_by: uuid(t.doneBy),
      reminded_early_for: null,
      reminded_day_for: null,
      created_by: null,
      created_at: stamp,
      updated_at: stamp,
    }
    row.due_on = resolveDue(row, anchors)
    tasks.push(row)
  })

  // --- counters ----------------------------------------------------------------------
  const counters: MsCounter[] = []
  const logs: MsCounterLog[] = []
  list('counters', blob.counters).forEach((c, i) => {
    const where = `counters[${i}]${isObj(c) && typeof c.id === 'string' ? ` (${c.id})` : ''}`
    if (!isObj(c)) return fail(`${where}: not an object.`)
    const id = str(c.id)
    const label = str(c.label)
    const targetValue = num(c.target)
    if (!id || !label) return fail(`${where}: needs an id and a label.`)
    if (targetValue === null || targetValue <= 0) return fail(`${where}: target should be a number above 0.`)
    const entries: MsCounterLog[] = []
    list(`${where}.log`, c.log).forEach((l, j) => {
      if (!isObj(l)) return fail(`${where}.log[${j}]: not an object.`)
      const amount = num(l.hours) ?? num(l.amount) ?? (c.unit === 'meetings' ? 1 : null)
      if (!isDay(l.date)) return fail(`${where}.log[${j}]: date should be YYYY-MM-DD.`)
      if (amount === null || amount <= 0) return fail(`${where}.log[${j}]: needs hours above 0.`)
      entries.push({
        id: str(l.id) ?? `${id}-${l.date}-${j + 1}`,
        counter_id: id,
        on_date: l.date,
        amount,
        note: str(l.note),
        created_by: null,
        created_at: stamp,
        updated_at: stamp,
      })
    })
    const logged = entries.reduce((s, e) => s + e.amount, 0)
    const undated = num(c.undated) ?? Math.max(0, (num(c.value) ?? logged) - logged)
    counters.push({
      id,
      label,
      unit: str(c.unit) ?? 'h',
      target: targetValue,
      undated,
      note: str(c.note),
      cap: num(c.cap),
      cap_note: str(c.capNote),
      sort: i,
      updated_at: stamp,
    })
    logs.push(...entries)
  })

  // --- eligibility ------------------------------------------------------------------
  const taskIds = new Set(tasks.map((t) => t.id))
  const eligibility: MsEligibility[] = []
  list('eligibility', blob.eligibility).forEach((e, i) => {
    if (!isObj(e) || !str(e.id) || !str(e.title)) return fail(`eligibility[${i}]: needs an id and a title.`)
    const id = str(e.id)!
    const linked = str(e.taskId) ?? (taskIds.has(id) ? id : null)
    eligibility.push({ id, title: str(e.title)!, note: str(e.note), met: bool(e.met), task_id: linked, sort: i, updated_at: stamp })
  })

  // --- letters -------------------------------------------------------------------------
  const letters: MsLetter[] = []
  list('letters', blob.letters).forEach((l, i) => {
    if (!isObj(l) || !str(l.id) || !str(l.title)) return fail(`letters[${i}]: needs an id and a title.`)
    const status = (l.status ?? 'not_asked') as MsLetterStatus
    if (!LETTER_STATUSES.includes(status)) return fail(`letters[${i}] (${l.id}): status should be one of ${LETTER_STATUSES.join(', ')}.`)
    const day = (v: unknown) => (isDay(v) ? v : null)
    letters.push({
      id: str(l.id)!,
      title: str(l.title)!,
      note: str(l.note),
      status,
      asked_on: day(l.askedOn),
      agreed_on: day(l.agreedOn),
      received_on: day(l.receivedOn),
      sort: i,
      updated_at: stamp,
    })
  })

  // --- courses ---------------------------------------------------------------------------
  const scale = scaleOf(reference)
  const doubtful = ambiguousCodes(reference)
  const courseIds = new Set<string>()
  const courses: MsCourse[] = []
  list('record.courses', coursesIn).forEach((c, i) => {
    const where = `record.courses[${i}]`
    if (!isObj(c)) return fail(`${where}: not an object.`)
    const term = str(c.term)
    const code = str(c.code)
    if (!term || !code) return fail(`${where}: needs a term and a code.`)
    const credits = num(c.credits)
    if (credits === null || credits < 0) return fail(`${where} (${code}): credits should be 0 or more.`)
    const category = (c.category ?? defaultCategory(code)) as MsCategory
    if (!CATEGORIES.includes(category)) return fail(`${where} (${code}): category should be one of ${CATEGORIES.join(', ')}.`)
    const grade = str(c.grade)?.toUpperCase() ?? null
    if (grade && !(grade in scale) && !(NON_GPA_GRADES as readonly string[]).includes(grade)) {
      warnings.push(`${code} (${term}) has a grade of "${grade}", which doesn't count towards a GPA.`)
    }
    let id = str(c.id) ?? courseId(term, code)
    for (let k = 2; courseIds.has(id); k++) id = `${courseId(term, code)}-${k}`
    courseIds.add(id)
    courses.push({
      id,
      term,
      code,
      title: str(c.title),
      grade,
      credits,
      category,
      category_note: str(c.categoryNote),
      maybe_nonscience: c.maybeNonScience === undefined ? doubtful.includes(code.toUpperCase()) : bool(c.maybeNonScience),
      imported: c.custom !== true,
      sort: i,
      updated_at: stamp,
    })
  })

  // --- practice tests, questions --------------------------------------------------------
  const practice: MsPractice[] = []
  list('practiceTests', blob.practiceTests).forEach((p, i) => {
    if (!isObj(p) || !isDay(p.date)) return fail(`practiceTests[${i}]: needs a date.`)
    const total = num(p.total)
    if (total !== null && (total < 472 || total > 528)) return fail(`practiceTests[${i}]: total should be 472–528.`)
    const section = (k: string) => {
      const v = num(p[k])
      if (v !== null && (v < 118 || v > 132)) fail(`practiceTests[${i}]: ${k} should be 118–132.`)
      return v
    }
    practice.push({
      id: str(p.id) ?? `p-${p.date}-${i + 1}`,
      taken_on: p.date,
      source: str(p.source),
      total,
      cp: section('cp'),
      cars: section('cars'),
      bb: section('bb'),
      ps: section('ps'),
      note: str(p.note),
      created_by: null,
      created_at: stamp,
      updated_at: stamp,
    })
  })

  const questions: MsQuestion[] = []
  const questionIds = new Set<string>()
  list('committee.openQuestions', openQuestions).forEach((q, i) => {
    const text = typeof q === 'string' ? str(q) : isObj(q) ? str(q.text) : null
    if (!text) return fail(`committee.openQuestions[${i}]: needs some text.`)
    let id = (isObj(q) && str(q.id)) || `q-${slug(text).slice(0, 40)}`
    for (let k = 2; questionIds.has(id); k++) id = `q-${slug(text).slice(0, 40)}-${k}`
    questionIds.add(id)
    const done = isObj(q) && q.done === true
    questions.push({ id, text, done, done_at: done ? stamp : null, sort: i, updated_at: stamp })
  })

  if (errors.length) return { ok: false, errors, warnings }

  const rows: PlanRows = { settings, tasks, counters, logs, eligibility, letters, courses, practice, questions }
  return { ok: true, rows, counts: countPlan(rows), warnings }
}

export function countPlan(rows: PlanRows): PlanCounts {
  const done = new Set(rows.tasks.filter((t) => t.done_at).map((t) => t.id))
  const scale = scaleOf(rows.settings.reference)
  return {
    tasks: rows.tasks.length,
    tasksDone: done.size,
    counters: rows.counters.length,
    logs: rows.logs.length,
    eligibility: rows.eligibility.length,
    eligibilityMet: rows.eligibility.filter((e) => (e.task_id ? done.has(e.task_id) : e.met)).length,
    letters: rows.letters.length,
    courses: rows.courses.length,
    graded: rows.courses.filter((c) => c.grade && c.grade in scale).length,
    inProgress: rows.courses.filter((c) => c.grade === 'IP').length,
    withdrawals: rows.courses.filter((c) => c.grade === 'W').length,
    practice: rows.practice.length,
    questions: rows.questions.length,
  }
}

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`

/** "63 tasks (2 done), 3 counters, …" */
export function describeCounts(c: PlanCounts): string {
  const parts = [
    `${plural(c.tasks, 'task')} (${c.tasksDone} done)`,
    plural(c.counters, 'counter'),
    `${plural(c.eligibility, 'eligibility item')} (${c.eligibilityMet} met)`,
    plural(c.letters, 'letter'),
    `${plural(c.courses, 'course')} (${c.graded} graded, ${c.inProgress} in progress, ${plural(c.withdrawals, 'withdrawal')})`,
  ]
  if (c.practice) parts.push(plural(c.practice, 'practice test'))
  if (c.questions) parts.push(plural(c.questions, 'open question'))
  return parts.join(', ')
}

// --- export --------------------------------------------------------------------------

export interface PlanState {
  settings: MsSettings | null
  tasks: MsTask[]
  counters: MsCounter[]
  logs: MsCounterLog[]
  eligibility: MsEligibility[]
  letters: MsLetter[]
  courses: MsCourse[]
  practice: MsPractice[]
  questions: MsQuestion[]
}

const drop = <T extends Obj>(o: T): T =>
  Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined && v !== null && v !== false)) as T

/** The plan as JSON in the shape Import reads, with each task's date worked out. */
export function exportPlan(state: PlanState, now: Date = new Date()): Obj {
  const ref: MsReference = state.settings?.reference ?? {}
  const { testCenter, commencement, schedulingPreference, contentStart, committee, record, ...top } = ref
  const anchors = anchorsFor(state.settings?.test_date ?? null, ref)
  const done = new Set(state.tasks.filter((t) => t.done_at).map((t) => t.id))
  const bySort = <T extends { sort: number }>(rows: T[]) => [...rows].sort((a, b) => a.sort - b.sort)
  const summary = gpaSummary(state.courses, scaleOf(ref))
  const round = (v: number | null) => (v === null ? null : Math.round(v * 1000) / 1000)

  return {
    ...top,
    snapshotDate: todayDay(now),
    settings: {
      testDate: state.settings?.test_date ?? null,
      booked: state.settings?.booked ?? false,
      aamcOrderNumber: state.settings?.order_number ?? null,
      ...(testCenter !== undefined ? { testCenter } : {}),
      targetScore: state.settings?.target_score ?? null,
      showEstimated: state.settings?.show_estimated ?? true,
      ...(contentStart ? { contentStart } : {}),
      ...(commencement ? { commencement } : {}),
      ...(schedulingPreference ? { schedulingPreference } : {}),
    },
    tasks: [...state.tasks]
      .sort((a, b) => (resolveDue(a, anchors) ?? '9999').localeCompare(resolveDue(b, anchors) ?? '9999'))
      .map((t) =>
        drop({
          id: t.id,
          title: t.title,
          area: t.area,
          due: t.due_fixed ? { fixed: t.due_fixed } : { anchor: t.due_anchor, offsetDays: t.due_offset },
          resolvedDue: resolveDue(t, anchors),
          hardDeadline: t.hard,
          estimated: t.estimated,
          note: t.note,
          done: Boolean(t.done_at),
          doneAt: t.done_at,
          doneBy: t.done_by,
          hidden: t.hidden,
          custom: !t.builtin,
        }),
      ),
    eligibility: bySort(state.eligibility).map((e) =>
      drop({ id: e.id, title: e.title, note: e.note, met: e.task_id ? done.has(e.task_id) : e.met, taskId: e.task_id && e.task_id !== e.id ? e.task_id : null }),
    ),
    counters: bySort(state.counters).map((c) => {
      const log = state.logs
        .filter((l) => l.counter_id === c.id)
        .sort((a, b) => a.on_date.localeCompare(b.on_date))
        .map((l) => drop({ id: l.id, date: l.on_date, [c.unit === 'meetings' ? 'amount' : 'hours']: l.amount, note: l.note }))
      const logged = state.logs.filter((l) => l.counter_id === c.id).reduce((s, l) => s + l.amount, 0)
      return drop({
        id: c.id,
        label: c.label,
        target: c.target,
        unit: c.unit,
        value: Math.round((c.undated + logged) * 100) / 100,
        undated: c.undated,
        log,
        note: c.note,
        cap: c.cap,
        capNote: c.cap_note,
      })
    }),
    letters: bySort(state.letters).map((l) =>
      drop({ id: l.id, title: l.title, note: l.note, status: l.status, askedOn: l.asked_on, agreedOn: l.agreed_on, receivedOn: l.received_on }),
    ),
    committee: {
      ...(committee ?? {}),
      openQuestions: bySort(state.questions).map((q) => drop({ id: q.id, text: q.text, done: q.done })),
    },
    record: {
      ...(record ?? {}),
      computed: {
        cumulative: round(summary.cumulative.gpa),
        bcpm: [round(summary.bcpm.low), round(summary.bcpm.high)],
        aacomasScience: [round(summary.aacomas.low), round(summary.aacomas.high)],
      },
      courses: bySort(state.courses).map((c) =>
        drop({
          id: c.id,
          term: c.term,
          code: c.code,
          title: c.title,
          grade: c.grade,
          credits: c.credits,
          category: c.category,
          categoryNote: c.category_note,
          maybeNonScience: c.maybe_nonscience,
          custom: !c.imported,
        }),
      ),
    },
    practiceTests: [...state.practice]
      .sort((a, b) => a.taken_on.localeCompare(b.taken_on))
      .map((p) => drop({ id: p.id, date: p.taken_on, source: p.source, total: p.total, cp: p.cp, cars: p.cars, bb: p.bb, ps: p.ps, note: p.note })),
  }
}
