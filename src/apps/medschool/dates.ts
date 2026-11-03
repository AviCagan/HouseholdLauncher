import { addDays as dfAddDays, differenceInCalendarDays, format, getDay, isValid, parseISO } from 'date-fns'
import type { MsAnchor, MsCalendarRow, MsReference, MsTask } from '@/data/types'

/**
 * The plan's calendar arithmetic.
 *
 * Everything here is a calendar day, `YYYY-MM-DD`, and every step goes
 * through date-fns on a local Date. Never through UTC milliseconds: a day is
 * not always 86 400 000 ms (the clocks change twice a year), and a date
 * parsed as UTC and shown in New York is the day before. Both mistakes move
 * a deadline by a day, which is the one thing this app may not do.
 *
 * Pure: no store, no clock unless one is handed in.
 */

export type Day = string

const DAY_RE = /^\d{4}-\d{2}-\d{2}$/

export const isDay = (s: unknown): s is Day => typeof s === 'string' && DAY_RE.test(s) && isValid(parseISO(s))

/** Local midnight of that day. */
const toDate = (d: Day): Date => parseISO(d)
const fromDate = (d: Date): Day => format(d, 'yyyy-MM-dd')

export const addDays = (d: Day, n: number): Day => fromDate(dfAddDays(toDate(d), n))

/** Whole days from `from` to `to`: positive when `to` is later. */
export const daysBetween = (from: Day, to: Day): number => differenceInCalendarDays(toDate(to), toDate(from))

/** 0 is Sunday, as with Date#getDay. */
export const weekday = (d: Day): number => getDay(toDate(d))

export const todayDay = (now: Date = new Date()): Day => fromDate(now)

/** "Apr 7". */
export const shortDay = (d: Day): string => format(toDate(d), 'MMM d')
/** "Fri, May 7". */
export const weekdayDay = (d: Day): string => format(toDate(d), 'EEE, MMM d')
/** "Fri, May 7, 2027". */
export const longDay = (d: Day): string => format(toDate(d), 'EEE, MMM d, yyyy')
/** "May 2027". */
export const monthLabel = (d: Day): string => format(toDate(d), 'MMMM yyyy')
export const monthKey = (d: Day): string => d.slice(0, 7)

// --- the committee ---------------------------------------------------------------

/**
 * The days the pre-health committee meets in a month: the first Tuesday and
 * the third Thursday.
 */
export function committeeMeetings(year: number, month: number): Day[] {
  const first = `${year}-${String(month).padStart(2, '0')}-01`
  const firstTuesday = addDays(first, (2 - weekday(first) + 7) % 7)
  const firstThursday = addDays(first, (4 - weekday(first) + 7) % 7)
  const thirdThursday = addDays(firstThursday, 14)
  return [firstTuesday, thirdThursday].sort()
}

/** The first committee meeting on or after `day`. */
export function nextCommitteeMeeting(day: Day): Day {
  let year = Number(day.slice(0, 4))
  let month = Number(day.slice(5, 7))
  for (let i = 0; i < 24; i++) {
    const hit = committeeMeetings(year, month).find((m) => m >= day)
    if (hit) return hit
    month += 1
    if (month > 12) {
      month = 1
      year += 1
    }
  }
  throw new Error(`No committee meeting found after ${day}`)
}

// --- anchors -----------------------------------------------------------------------

/** The day dedicated study starts, unless the plan says otherwise. */
export const DEFAULT_CONTENT_START: Day = '2027-01-04'

export const ANCHORS: MsAnchor[] = [
  'T',
  'score',
  'd60',
  'd30',
  'd10',
  'contentStart',
  'practice',
  'fl',
  'taper',
  'csiFile',
  'csiInterview',
  'csiLetter',
  'studyBlock1End',
  'studyBlock2End',
  'studyBlock3End',
  'studyBlock4End',
]

export const isAnchor = (s: unknown): s is MsAnchor => ANCHORS.includes(s as MsAnchor)

export const ANCHOR_LABEL: Record<MsAnchor, string> = {
  T: 'MCAT test day',
  score: 'Score release',
  d60: '60-day deadline',
  d30: '30-day deadline',
  d10: '10-day deadline',
  contentStart: 'Study start',
  practice: 'Practice phase',
  fl: 'First AAMC full-length',
  taper: 'Taper',
  csiFile: 'Committee file due',
  csiInterview: 'Committee interview',
  csiLetter: 'Committee letter',
  studyBlock1End: 'End of block 1',
  studyBlock2End: 'End of block 2',
  studyBlock3End: 'End of block 3',
  studyBlock4End: 'End of block 4',
}

export type Anchors = Record<MsAnchor, Day>

/**
 * Every anchor for one test date, from its row in the MCAT calendar.
 *
 * The four content blocks split the days from `contentStart` to the day
 * before practice: the first three get floor(total / 4) days each and the
 * last gets the rest.
 */
export function computeAnchors(row: MsCalendarRow, contentStart: Day = DEFAULT_CONTENT_START): Anchors {
  const T = row.testDate
  const score = row.scoreRelease
  const practice = addDays(T, -56)
  const studyEnd = addDays(practice, -1)
  const total = daysBetween(contentStart, studyEnd) + 1
  const size = Math.max(1, Math.floor(total / 4))
  const b1 = addDays(contentStart, size - 1)
  const b2 = addDays(b1, size)
  const b3 = addDays(b2, size)
  const csiInterview = nextCommitteeMeeting(addDays(score, 3))
  return {
    T,
    score,
    d60: row.deadline60,
    d30: row.deadline30,
    d10: row.deadline10,
    contentStart,
    practice,
    fl: addDays(T, -42),
    taper: addDays(T, -5),
    csiFile: addDays(score, -7),
    csiInterview,
    csiLetter: addDays(csiInterview, 14),
    studyBlock1End: b1,
    studyBlock2End: b2,
    studyBlock3End: b3,
    studyBlock4End: studyEnd,
  }
}

export const calendarOf = (ref: MsReference | undefined): MsCalendarRow[] =>
  Array.isArray(ref?.mcatCalendar2027) ? ref.mcatCalendar2027 : []

/** Anchors for the plan's chosen date, or null when it isn't in the calendar. */
export function anchorsFor(testDate: Day | null, ref: MsReference | undefined): Anchors | null {
  if (!testDate) return null
  const row = calendarOf(ref).find((r) => r.testDate === testDate)
  if (!row) return null
  return computeAnchors(row, isDay(ref?.contentStart) ? ref.contentStart : DEFAULT_CONTENT_START)
}

/** A task's date: fixed, or so many days from its anchor. */
export function resolveDue(
  task: Pick<MsTask, 'due_fixed' | 'due_anchor' | 'due_offset'>,
  anchors: Anchors | null,
): Day | null {
  if (task.due_fixed) return task.due_fixed
  if (!task.due_anchor || !anchors) return null
  const base = anchors[task.due_anchor]
  return base ? addDays(base, task.due_offset || 0) : null
}

/** "{d30}" in a note becomes "Apr 7". Unknown names are left as they are. */
export function renderNote(note: string, anchors: Anchors | null): string {
  if (!anchors) return note
  return note.replace(/\{(\w+)\}/g, (whole, name: string) => (isAnchor(name) ? shortDay(anchors[name]) : whole))
}

// --- status ------------------------------------------------------------------------

export type DueStatus =
  | { kind: 'done' }
  | { kind: 'late'; days: number }
  | { kind: 'today' }
  | { kind: 'soon'; days: number }
  | { kind: 'later'; days: number }
  | { kind: 'undated' }

export function dueStatus(due: Day | null, today: Day, done: boolean): DueStatus {
  if (done) return { kind: 'done' }
  if (!due) return { kind: 'undated' }
  const days = daysBetween(today, due)
  if (days < 0) return { kind: 'late', days: -days }
  if (days === 0) return { kind: 'today' }
  if (days <= 7) return { kind: 'soon', days }
  return { kind: 'later', days }
}

/** The chip a status gets, or null for none. */
export function chipText(status: DueStatus): string | null {
  switch (status.kind) {
    case 'done':
      return 'done'
    case 'late':
      return `${status.days}d late`
    case 'today':
      return 'today'
    case 'soon':
      return `in ${status.days}d`
    default:
      return null
  }
}

// --- the MCAT date -----------------------------------------------------------------

export interface DateFlags {
  saturday: boolean
  selectCenters: boolean
  /** Within 14 days of commencement, either side. */
  nearCommencement: boolean
}

export function dateFlags(row: MsCalendarRow, commencement: Day | null): DateFlags {
  return {
    saturday: weekday(row.testDate) === 6,
    selectCenters: row.selectCentersOnly === true,
    nearCommencement: commencement ? Math.abs(daysBetween(row.testDate, commencement)) <= 14 : false,
  }
}

export interface FeeStep {
  /** Last day this applies, inclusive. Null for "after the last one". */
  until: Day | null
  from: Day | null
  label: string
}

/**
 * What changing or cancelling costs on the way to test day.
 *
 * Rescheduling is $55 up to the 60-day deadline, $110 up to the 30-day,
 * $210 up to the 10-day, and not allowed after it. Cancelling refunds $180
 * up to the 30-day deadline and nothing after. Amounts come from the plan's
 * fee table when it has one.
 */
export function feeSteps(row: MsCalendarRow, fees: MsReference['mcatFees']): FeeStep[] {
  const money = (v: unknown, fallback: number) => `$${typeof v === 'number' ? v : fallback}`
  const r = fees?.reschedule ?? {}
  const refund = fees?.cancelRefund ?? {}
  return [
    { from: null, until: row.deadline60, label: `Reschedule for ${money(r['60plus'], 55)}` },
    { from: addDays(row.deadline60, 1), until: row.deadline30, label: `Reschedule for ${money(r['30to59'], 110)}; last day to cancel for a ${money(refund['30plus'], 180)} refund is the 30-day deadline` },
    { from: addDays(row.deadline30, 1), until: row.deadline10, label: `Reschedule for ${money(r['10to29'], 210)}; no refund` },
    { from: addDays(row.deadline10, 1), until: null, label: 'No changes allowed' },
  ]
}

// --- study phases ------------------------------------------------------------------

export interface Phase {
  id: string
  label: string
  start: Day | null
  end: Day
  focus?: string
}

/**
 * The run-up to test day, in order: a light start, four content blocks,
 * practice, the AAMC full-lengths, the taper, and the day itself.
 */
export function studyPhases(
  anchors: Anchors,
  lightStart: Day | null,
  blocks: MsReference['studyBlocks'] = [],
): Phase[] {
  const block = (n: 1 | 2 | 3 | 4, start: Day, end: Day): Phase => {
    const info = blocks?.find((b) => b.id === `m-b${n}`)
    return { id: `block${n}`, label: info?.title ? `Block ${n}: ${info.title}` : `Content block ${n}`, start, end, focus: info?.focus }
  }
  return [
    { id: 'light', label: 'Light start', start: lightStart, end: addDays(anchors.contentStart, -1) },
    block(1, anchors.contentStart, anchors.studyBlock1End),
    block(2, addDays(anchors.studyBlock1End, 1), anchors.studyBlock2End),
    block(3, addDays(anchors.studyBlock2End, 1), anchors.studyBlock3End),
    block(4, addDays(anchors.studyBlock3End, 1), anchors.studyBlock4End),
    { id: 'practice', label: 'Practice', start: anchors.practice, end: addDays(anchors.fl, -1) },
    { id: 'fl', label: 'AAMC full-lengths', start: anchors.fl, end: addDays(anchors.taper, -1) },
    { id: 'taper', label: 'Taper', start: anchors.taper, end: addDays(anchors.T, -1) },
    { id: 'test', label: 'Test day', start: anchors.T, end: anchors.T },
  ]
}

/** The phase today falls in, or null before the first and after the last. */
export function currentPhase(phases: Phase[], today: Day): Phase | null {
  return phases.find((p) => (p.start === null ? today <= p.end : p.start <= today && today <= p.end)) ?? null
}

/** How far through a phase today is, 0–1. */
export function phaseProgress(phase: Phase, today: Day): number {
  if (!phase.start) return today <= phase.end ? 0.5 : 1
  const length = daysBetween(phase.start, phase.end) + 1
  return Math.min(1, Math.max(0, (daysBetween(phase.start, today) + 1) / length))
}

// --- countdowns --------------------------------------------------------------------

export interface CountdownStep {
  label: string
  date: Day | null
  /** A task that, once done, moves the ring on early. */
  doneEarly?: boolean
}

export interface Countdown {
  label: string
  date: Day
  days: number
  /** Share of the span still to go, 0–1, for the lit segments. */
  remaining: number
  /** Nothing left in the chain. */
  finished: false
}

export interface CountdownFinished {
  label: string
  finished: true
}

/**
 * The next milestone in a chain. A step whose date has passed (or whose task
 * is done) gives way to the one after it, so a ring never counts below zero.
 * The ring's span runs from the step before — or `spanStart` for the first.
 */
export function nextCountdown(
  steps: CountdownStep[],
  today: Day,
  spanStart: Day,
  finishedLabel: string,
): Countdown | CountdownFinished {
  let prev: Day = spanStart
  for (const step of steps) {
    if (!step.date) continue
    if (step.date >= today && !step.doneEarly) {
      const span = Math.max(1, daysBetween(prev < step.date ? prev : addDays(step.date, -1), step.date))
      const days = daysBetween(today, step.date)
      return { label: step.label, date: step.date, days, remaining: Math.min(1, days / span), finished: false }
    }
    prev = step.date
  }
  return { label: finishedLabel, finished: true }
}

// --- meetings ----------------------------------------------------------------------

/** Today if it's a Tuesday, otherwise the Tuesday before it. */
export function lastTuesday(today: Day): Day {
  return addDays(today, -((weekday(today) - 2 + 7) % 7))
}
