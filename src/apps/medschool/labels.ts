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
