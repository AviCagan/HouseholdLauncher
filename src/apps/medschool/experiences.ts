import type {
  MsCounter,
  MsExperience,
  MsExperienceKind,
  MsExperienceLog,
  MsExperienceStatus,
  MsExperienceStep,
  MsLetter,
} from '@/data/types'
import { addDays, daysBetween, dueStatus, isDay, type Day, type DueStatus } from './dates'
import { hoursBetween, timeRange } from './labels'

/**
 * Experiences: everything that counts towards the committee file or the
 * application, as records with their own logs. Pure — the tab, the sheets
 * and the export all read these.
 */

export interface KindMeta {
  label: string
  /** The Work & Activities experience type it goes in as. */
  amcas: string
  /** The committee target it counts towards unless told otherwise. */
  target: string | null
  /**
   * How its total is kept: dated hours, dated meetings, or one estimated
   * total for a job whose hours nobody wrote down.
   */
  tracks: 'hours' | 'meetings' | 'estimate'
}

export const KIND_META: Record<MsExperienceKind, KindMeta> = {
  shadowing: { label: 'Shadowing', amcas: 'Physician Shadowing/Clinical Observation', target: 'shadowing', tracks: 'hours' },
  service: { label: 'Community service', amcas: 'Community Service/Volunteer - Not Medical/Clinical', target: 'service', tracks: 'hours' },
  clinical_volunteer: { label: 'Clinical volunteering', amcas: 'Community Service/Volunteer - Medical/Clinical', target: null, tracks: 'hours' },
  clinical_paid: { label: 'Paid clinical work', amcas: 'Paid Employment - Medical/Clinical', target: null, tracks: 'estimate' },
  research: { label: 'Research', amcas: 'Research/Lab', target: null, tracks: 'hours' },
  club: { label: 'Club', amcas: 'Extracurricular Activities', target: 'club', tracks: 'meetings' },
  employment: { label: 'Employment', amcas: 'Paid Employment - Not Medical/Clinical', target: null, tracks: 'estimate' },
  leadership: { label: 'Leadership', amcas: 'Leadership - Not Listed Elsewhere', target: null, tracks: 'hours' },
  other: { label: 'Other', amcas: 'Other', target: null, tracks: 'hours' },
}

export const STATUS_LABEL: Record<MsExperienceStatus, string> = {
  prospect: 'Prospect',
  reached_out: 'Reached out',
  onboarding: 'Onboarding',
  active: 'Active',
  done: 'Done',
  declined: 'Declined',
}

/** Going now first, then what's being set up, then what's over. */
const STATUS_ORDER: MsExperienceStatus[] = ['active', 'onboarding', 'reached_out', 'prospect', 'done', 'declined']

export type StatusGroup = 'all' | 'current' | 'prospects' | 'past'

export const GROUP_LABEL: Record<StatusGroup, string> = {
  all: 'All',
  current: 'Going',
  prospects: 'Prospects',
  past: 'Past',
}

export function groupOf(status: MsExperienceStatus): Exclude<StatusGroup, 'all'> {
  if (status === 'active' || status === 'onboarding') return 'current'
  if (status === 'prospect' || status === 'reached_out') return 'prospects'
  return 'past'
}

export function sortExperiences(list: MsExperience[]): MsExperience[] {
  return [...list].sort(
    (a, b) =>
      STATUS_ORDER.indexOf(a.status) - STATUS_ORDER.indexOf(b.status) ||
      a.sort - b.sort ||
      (b.start_on ?? '').localeCompare(a.start_on ?? '') ||
      a.name.localeCompare(b.name),
  )
}

export const countsMeetings = (exp: Pick<MsExperience, 'kind'>): boolean => KIND_META[exp.kind].tracks === 'meetings'

/** The unit an experience's total is in. */
export const unitOf = (exp: Pick<MsExperience, 'kind'>): 'h' | 'meetings' => (countsMeetings(exp) ? 'meetings' : 'h')

/** What one entry adds: its hours, or one for a meeting. */
export const entryAmount = (exp: Pick<MsExperience, 'kind'>, log: Pick<MsExperienceLog, 'hours'>): number =>
  countsMeetings(exp) ? 1 : (log.hours ?? 0)

const round2 = (n: number) => Math.round(n * 100) / 100

export function logsFor(expId: string, logs: MsExperienceLog[]): MsExperienceLog[] {
  return logs
    .filter((l) => l.experience_id === expId)
    .sort((a, b) => b.on_date.localeCompare(a.on_date) || (b.start_time ?? '').localeCompare(a.start_time ?? '') || b.created_at.localeCompare(a.created_at))
}

/** What's in the log, summed. */
export function loggedTotal(exp: MsExperience, logs: MsExperienceLog[]): number {
  return round2(logs.filter((l) => l.experience_id === exp.id).reduce((s, l) => s + entryAmount(exp, l), 0))
}

/** The prior amount plus the log. */
export function experienceTotal(exp: MsExperience, logs: MsExperienceLog[]): number {
  return round2(exp.prior + loggedTotal(exp, logs))
}

export interface TargetTotal {
  counter: MsCounter
  total: number
  /** Each experience counting towards it, biggest first. */
  parts: { exp: MsExperience; total: number }[]
}

/** The committee's targets, each with what's counted towards it. */
export function targetTotals(counters: MsCounter[], experiences: MsExperience[], logs: MsExperienceLog[]): TargetTotal[] {
  return [...counters]
    .sort((a, b) => a.sort - b.sort)
    .map((counter) => {
      const parts = experiences
        .filter((e) => e.counts_toward === counter.id)
        .map((exp) => ({ exp, total: experienceTotal(exp, logs) }))
        .filter((p) => p.total > 0 || p.exp.status === 'active' || p.exp.status === 'onboarding')
        .sort((a, b) => b.total - a.total || a.exp.name.localeCompare(b.exp.name))
      return { counter, total: round2(parts.reduce((s, p) => s + p.total, 0)), parts }
    })
}

export interface Warning {
  tone: 'warn' | 'live'
  text: string
}

/** How near an observership is to its hour cap and its end date. */
export function capWarnings(exp: MsExperience, total: number, today: Day): Warning[] {
  if (exp.status === 'done' || exp.status === 'declined') return []
  const out: Warning[] = []
  if (exp.cap_hours) {
    const left = round2(exp.cap_hours - total)
    if (left <= 0) out.push({ tone: 'warn', text: `At the ${exp.cap_hours} h cap — hours past it may not count.` })
    else if (total >= exp.cap_hours * 0.8) out.push({ tone: 'warn', text: `${left} h left before the ${exp.cap_hours} h cap.` })
  }
  if (exp.cap_until && isDay(exp.cap_until)) {
    const days = daysBetween(today, exp.cap_until)
    if (days < 0) out.push({ tone: 'warn', text: `The window ended ${-days} ${-days === 1 ? 'day' : 'days'} ago.` })
    else if (days <= 21) out.push({ tone: 'warn', text: days === 0 ? 'The window ends today.' : `The window ends in ${days} ${days === 1 ? 'day' : 'days'}.` })
  }
  return out
}

// --- dates ---------------------------------------------------------------------------

const PARTIAL_RE = /^\d{4}(-(0[1-9]|1[0-2])(-(0[1-9]|[12]\d|3[01]))?)?$/

/** "2021", "2021-03" or a full day. */
export const isPartialDate = (s: unknown): s is string => typeof s === 'string' && PARTIAL_RE.test(s) && (s.length < 10 || isDay(s))

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

/** "2021", "Mar 2021", "Mar 5, 2021". */
export function formatPartial(s: string): string {
  if (!isPartialDate(s)) return s
  const [y, m, d] = s.split('-')
  if (!m) return y
  const month = MONTHS[Number(m) - 1]
  return d ? `${month} ${Number(d)}, ${y}` : `${month} ${y}`
}

/** "Sep 2026 – present", "2020 – 2021", "Mar 2024". */
export function dateSpan(exp: Pick<MsExperience, 'start_on' | 'end_on' | 'status'>): string | null {
  const start = exp.start_on ? formatPartial(exp.start_on) : null
  const end = exp.end_on ? formatPartial(exp.end_on) : null
  if (!start && !end) return null
  if (start && end) return start === end ? start : `${start} – ${end}`
  if (start) return exp.status === 'done' || exp.status === 'declined' ? start : `${start} – present`
  return `until ${end}`
}

/** AMCAS wants MM/YYYY. A year alone is flagged rather than guessed. */
function amcasMonth(s: string | null): string {
  if (!s) return 'present'
  const [y, m] = s.split('-')
  return m ? `${m}/${y}` : `??/${y}`
}

// --- times on a log entry ------------------------------------------------------------

/** "07:30:00" → "07:30". */
export const hhmm = (t: string | null): string => (t ? t.slice(0, 5) : '')

/** "7:30–2:00", or nothing when the entry has no times. */
export function entryTimes(log: Pick<MsExperienceLog, 'start_time' | 'end_time'>): string | null {
  return log.start_time && log.end_time ? timeRange(hhmm(log.start_time), hhmm(log.end_time)) : null
}

export { hoursBetween }

// --- onboarding ----------------------------------------------------------------------

/** What setting up an observership usually takes. Every step can be edited. */
export const SHADOWING_STEPS = [
  'Reach out and ask to shadow',
  'Get the application or forms they need',
  'Health clearance and immunization records',
  'ID badge or background check',
  'HIPAA or orientation training',
  'Schedule the first day',
]

export function defaultSteps(kind: MsExperienceKind): string[] {
  return kind === 'shadowing' ? SHADOWING_STEPS : []
}

export interface StepView {
  step: MsExperienceStep
  exp: MsExperience
  status: DueStatus
}

/** Checklist steps with a date, for the timeline. */
export function datedSteps(steps: MsExperienceStep[], experiences: MsExperience[], today: Day): StepView[] {
  const byId = new Map(experiences.map((e) => [e.id, e]))
  return steps
    .filter((s) => s.due_on && byId.has(s.experience_id))
    .map((step) => ({ step, exp: byId.get(step.experience_id)!, status: dueStatus(step.due_on, today, Boolean(step.done_at)) }))
}

export function stepsFor(expId: string, steps: MsExperienceStep[]): MsExperienceStep[] {
  return steps.filter((s) => s.experience_id === expId).sort((a, b) => a.sort - b.sort || a.title.localeCompare(b.title))
}

// --- the quick log -------------------------------------------------------------------

/** The experience most recently logged to, or the first one that takes a log. */
export function lastLogged(experiences: MsExperience[], logs: MsExperienceLog[]): MsExperience | null {
  const loggable = experiences.filter((e) => KIND_META[e.kind].tracks !== 'estimate' && e.status !== 'declined')
  const ids = new Set(loggable.map((e) => e.id))
  const newest = [...logs].filter((l) => ids.has(l.experience_id)).sort((a, b) => b.created_at.localeCompare(a.created_at))[0]
  if (newest) return loggable.find((e) => e.id === newest.experience_id) ?? null
  return sortExperiences(loggable)[0] ?? null
}

/** Club meetings are usually on a Tuesday; anything else defaults to today. */
export function defaultLogDay(exp: Pick<MsExperience, 'kind'> | null, today: Day, lastTuesday: (d: Day) => Day): Day {
  return exp && countsMeetings(exp) ? lastTuesday(today) : today
}

// --- Copy for AMCAS ------------------------------------------------------------------

export const AMCAS_DESCRIPTION_LIMIT = 700

const fmtHours = (n: number) => (Number.isInteger(n) ? String(n) : String(round2(n)))

/**
 * What Work & Activities asks for, as text to paste: the type, the name and
 * organization, the contact, where, the dates, the hours and the
 * description. A month AMCAS needs but the record doesn't have shows as
 * "??", so the gap is seen rather than guessed.
 */
export function amcasText(exp: MsExperience, logs: MsExperienceLog[], letter?: MsLetter | null): string {
  const meta = KIND_META[exp.kind]
  const total = experienceTotal(exp, logs)
  const hours =
    meta.tracks === 'meetings'
      ? `${fmtHours(total)} meetings (convert to hours)`
      : total > 0
        ? `${fmtHours(total)}${meta.tracks === 'estimate' ? ` (estimate${exp.prior_as_of ? ` as of ${exp.prior_as_of}` : ''})` : ''}`
        : 'not recorded yet'
  const name = [exp.role, exp.specialty && exp.kind === 'shadowing' ? `${exp.specialty}${exp.physician_type ? `, ${exp.physician_type}` : ''}` : null]
    .filter(Boolean)
    .join(' · ')
  const lines = [
    `Experience type: ${meta.amcas}`,
    `Experience name: ${name ? `${name} — ${exp.name}` : exp.name}`,
    `Organization: ${exp.name}`,
    `Contact: ${exp.contact ?? '—'}`,
    `Location: ${exp.location ?? '—'}`,
    `Dates: ${amcasMonth(exp.start_on)} – ${exp.end_on ? amcasMonth(exp.end_on) : 'present'}`,
    `Total hours: ${hours}`,
  ]
  if (letter) lines.push(`Letter: ${letter.title}`)
  lines.push('', `Description: ${exp.description?.trim() || '(write one — up to 700 characters)'}`)
  return lines.join('\n')
}

// --- a new record --------------------------------------------------------------------

export function blankExperience(kind: MsExperienceKind, id: string, stamp: string, createdBy: string | null): MsExperience {
  return {
    id,
    kind,
    name: '',
    role: null,
    contact: null,
    location: null,
    start_on: null,
    end_on: null,
    status: kind === 'shadowing' ? 'prospect' : 'active',
    notes: null,
    description: null,
    specialty: null,
    physician_type: null,
    cap_hours: null,
    cap_until: null,
    prior: 0,
    prior_as_of: null,
    counts_toward: KIND_META[kind].target,
    letter_id: null,
    sort: 0,
    created_by: createdBy,
    created_at: stamp,
    updated_at: stamp,
  }
}

/** Three months from a start day, the usual observership window. */
export const threeMonthsFrom = (start: Day): Day => addDays(start, 91)
