import type { MsCategory, MsCourse } from '@/data/types'

/**
 * The application GPAs, worked out from the course rows every time — never
 * stored, so a grade entered when it posts moves every figure at once.
 *
 * AMCAS science ("BCPM") is biology, chemistry, physics and math. AACOMAS
 * science leaves math out. A course flagged `maybe_nonscience` is one the
 * services might classify differently (an ethics course under a BIO code),
 * so both science GPAs are a range: with it counted as science and without.
 * W, IP and P never count towards any GPA, though they stay on the record.
 */

export const DEFAULT_SCALE: Record<string, number> = {
  'A+': 4.0,
  A: 4.0,
  'A-': 3.7,
  'B+': 3.3,
  B: 3.0,
  'B-': 2.7,
  'C+': 2.3,
  C: 2.0,
  'C-': 1.7,
  'D+': 1.3,
  D: 1.0,
  F: 0,
}

/** Grades that are on the record but not in any GPA. */
export const NON_GPA_GRADES = ['W', 'IP', 'P'] as const

export const CATEGORIES: MsCategory[] = ['bio', 'chem', 'phys', 'math', 'other']

export const CATEGORY_LABEL: Record<MsCategory, string> = {
  bio: 'Biology',
  chem: 'Chemistry',
  phys: 'Physics',
  math: 'Math',
  other: 'Other',
}

const BCPM: MsCategory[] = ['bio', 'chem', 'phys', 'math']
const AACOMAS_SCIENCE: MsCategory[] = ['bio', 'chem', 'phys']

/** What a course's subject code suggests: BIO, CHM, PHY, MTH. */
export function defaultCategory(code: string): MsCategory {
  const subject = code.trim().toUpperCase().match(/^[A-Z]+/)?.[0] ?? ''
  if (subject === 'BIO' || subject === 'BIOL') return 'bio'
  if (subject === 'CHM' || subject === 'CHEM') return 'chem'
  if (subject === 'PHY' || subject === 'PHYS') return 'phys'
  if (subject === 'MTH' || subject === 'MATH') return 'math'
  return 'other'
}

/** Set by hand rather than following the subject code. */
export const isOverridden = (c: Pick<MsCourse, 'code' | 'category'>): boolean => c.category !== defaultCategory(c.code)

export type Scale = Record<string, number>

const normal = (grade: string | null) => (grade ?? '').trim().toUpperCase()

/** The grade's points, or null when it doesn't count. */
export function gradePoints(grade: string | null, scale: Scale = DEFAULT_SCALE): number | null {
  const g = normal(grade)
  if (!g || (NON_GPA_GRADES as readonly string[]).includes(g)) return null
  return g in scale ? scale[g] : null
}

export interface GpaResult {
  gpa: number | null
  credits: number
}

export function gpaOf(courses: MsCourse[], scale: Scale = DEFAULT_SCALE): GpaResult {
  let credits = 0
  let points = 0
  for (const c of courses) {
    const p = gradePoints(c.grade, scale)
    if (p === null || !(c.credits > 0)) continue
    credits += c.credits
    points += p * c.credits
  }
  return { gpa: credits > 0 ? points / credits : null, credits }
}

export interface Range {
  low: number | null
  high: number | null
  /** Credits at the inclusive end. */
  credits: number
}

/** A science GPA both ways: flagged courses counted as science, and not. */
function scienceRange(courses: MsCourse[], cats: MsCategory[], scale: Scale): Range {
  const inScience = courses.filter((c) => cats.includes(c.category))
  const counted = gpaOf(inScience, scale)
  const strict = gpaOf(inScience.filter((c) => !c.maybe_nonscience), scale)
  const values = [counted.gpa, strict.gpa].filter((v): v is number => v !== null)
  return {
    low: values.length ? Math.min(...values) : null,
    high: values.length ? Math.max(...values) : null,
    credits: counted.credits,
  }
}

export interface GpaSummary {
  cumulative: GpaResult
  bcpm: Range
  aacomas: Range
}

export function gpaSummary(courses: MsCourse[], scale: Scale = DEFAULT_SCALE): GpaSummary {
  return {
    cumulative: gpaOf(courses, scale),
    bcpm: scienceRange(courses, BCPM, scale),
    aacomas: scienceRange(courses, AACOMAS_SCIENCE, scale),
  }
}

/** Three places, as the services show it. "—" when there's nothing to count. */
export const fmtGpa = (v: number | null): string => (v === null ? '—' : v.toFixed(3))

export function fmtRange(r: Range): string {
  if (r.low === null || r.high === null) return '—'
  const low = r.low.toFixed(3)
  const high = r.high.toFixed(3)
  return low === high ? low : `${low}–${high}`
}

// --- terms -------------------------------------------------------------------------

const SEASONS = ['winter', 'spring', 'summer', 'fall'] as const

/** "Fall 2026" → a number that sorts terms in calendar order. Winter is January. */
export function termOrder(term: string): number {
  const m = term.trim().toLowerCase().match(/^(winter|spring|summer|fall)\s+(\d{4})$/)
  if (!m) return Number.MAX_SAFE_INTEGER
  return Number(m[2]) * 4 + SEASONS.indexOf(m[1] as (typeof SEASONS)[number])
}

/**
 * The AMCAS academic year a term belongs to. Years run Fall → Summer, so
 * Fall 2025 and Summer 2026 are both 2025–26, and a January winter term goes
 * with the spring after it.
 */
export function academicYear(term: string): string | null {
  const m = term.trim().toLowerCase().match(/^(winter|spring|summer|fall)\s+(\d{4})$/)
  if (!m) return null
  const year = Number(m[2])
  const start = m[1] === 'fall' ? year : year - 1
  return `${start}–${String((start + 1) % 100).padStart(2, '0')}`
}

export interface YearRow {
  year: string
  terms: string[]
  credits: number
  all: number | null
  science: number | null
}

/** One row per academic year, oldest first. Science here is BCPM as classified. */
export function byYear(courses: MsCourse[], scale: Scale = DEFAULT_SCALE): YearRow[] {
  const years = new Map<string, MsCourse[]>()
  for (const c of courses) {
    const y = academicYear(c.term)
    if (!y) continue
    years.set(y, [...(years.get(y) ?? []), c])
  }
  return [...years.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([year, list]) => {
      const all = gpaOf(list, scale)
      const sci = gpaOf(list.filter((c) => BCPM.includes(c.category)), scale)
      const terms = [...new Set(list.map((c) => c.term))].sort((a, b) => termOrder(a) - termOrder(b))
      return { year, terms, credits: all.credits, all: all.gpa, science: sci.gpa }
    })
}

/** Courses grouped by term, in calendar order. */
export function byTerm(courses: MsCourse[]): { term: string; courses: MsCourse[] }[] {
  const terms = new Map<string, MsCourse[]>()
  for (const c of courses) terms.set(c.term, [...(terms.get(c.term) ?? []), c])
  return [...terms.entries()]
    .sort(([a], [b]) => termOrder(a) - termOrder(b))
    .map(([term, list]) => ({ term, courses: [...list].sort((a, b) => a.sort - b.sort || a.code.localeCompare(b.code)) }))
}
