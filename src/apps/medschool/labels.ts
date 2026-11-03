import type { MsLetterStatus } from '@/data/types'

/** Words and small helpers the tabs share. Kept out of the component files. */

/** The areas, in the order the plan thinks about them. Others follow. */
export const AREAS = ['MCAT', 'CSI', 'Letters', 'Hours', 'Apply', 'AMCAS', 'AACOMAS', 'School']

export const LETTER_LABEL: Record<MsLetterStatus, string> = {
  not_asked: 'Not asked',
  asked: 'Asked',
  agreed: 'Agreed',
  received: 'Received',
}

/** "1 meeting", "3 meetings", "20.75 h". */
export function amount(value: number, unit: string): string {
  const n = Math.round(value * 100) / 100
  if (unit === 'h') return `${n} h`
  return `${n} ${n === 1 ? unit.replace(/s$/, '') : unit}`
}

/** "A: … B: … C: …" in the score-day task's note, as three plans. */
export function scorePlan(note: string | null): { letter: string; text: string }[] | null {
  if (!note) return null
  const parts = [...note.matchAll(/(?:^|\s)([ABC]):\s*([\s\S]*?)(?=\s[ABC]:\s|$)/g)].map((m) => ({ letter: m[1], text: m[2].trim() }))
  return parts.length >= 2 ? parts : null
}

const TIME_RE = /^(\d{1,2}):(\d{2})$/

const minutesOf = (t: string): number | null => {
  const m = TIME_RE.exec(t)
  if (!m) return null
  const h = Number(m[1])
  const min = Number(m[2])
  return h < 24 && min < 60 ? h * 60 + min : null
}

/**
 * Hours from a start and end time ("07:30", "12:00" → 4.5), as a time input
 * gives them. An end before the start runs past midnight. Null when either is
 * missing or they're the same.
 */
export function hoursBetween(start: string, end: string): number | null {
  const a = minutesOf(start)
  const b = minutesOf(end)
  if (a === null || b === null || a === b) return null
  const minutes = b > a ? b - a : b + 24 * 60 - a
  return Math.round((minutes / 60) * 100) / 100
}

/** "07:30", "14:00" → "7:30–2:00", the way the log's notes already write it. */
export function timeRange(start: string, end: string): string {
  const show = (t: string) => {
    const mins = minutesOf(t) ?? 0
    const h = Math.floor(mins / 60) % 12 || 12
    return `${h}:${String(mins % 60).padStart(2, '0')}`
  }
  return `${show(start)}–${show(end)}`
}
