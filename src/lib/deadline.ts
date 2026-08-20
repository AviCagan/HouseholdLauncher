/**
 * Deadlines on to-dos, in the app's own terms.
 *
 * A deadline is a date someone chose, so it is always stored as the end of
 * that day: "by Friday" means any time up to Friday night, and storing
 * midnight would quietly make everything a day early.
 */

export interface DeadlineOption {
  key: string
  label: string
  /** Null is the "no deadline" choice, which stays the normal case. */
  at: string | null
}

const endOfDay = (d: Date): Date => {
  const out = new Date(d)
  out.setHours(23, 59, 0, 0)
  return out
}

const addDays = (d: Date, n: number): Date => {
  const out = new Date(d)
  out.setDate(out.getDate() + n)
  return out
}

export const endOfDayIso = (d: Date): string => endOfDay(d).toISOString()

/** The choices offered right after adding a to-do. */
export function deadlineOptions(now: Date = new Date()): DeadlineOption[] {
  const weekend = 6 - now.getDay() // Saturday
  return [
    { key: 'today', label: 'Today', at: endOfDayIso(now) },
    { key: 'tomorrow', label: 'Tomorrow', at: endOfDayIso(addDays(now, 1)) },
    // Skipped when today already is the weekend, so the row never offers two
    // buttons that mean the same day.
    ...(weekend > 1
      ? [{ key: 'weekend', label: 'Weekend', at: endOfDayIso(addDays(now, weekend)) }]
      : []),
    { key: 'week', label: 'Next week', at: endOfDayIso(addDays(now, 7)) },
  ]
}

const startOfDay = (d: Date): number => {
  const out = new Date(d)
  out.setHours(0, 0, 0, 0)
  return out.getTime()
}

/** Whole days from today to that date: 0 today, 1 tomorrow, -1 yesterday. */
export function daysUntil(iso: string, now: Date = new Date()): number {
  const diff = startOfDay(new Date(iso)) - startOfDay(now)
  return Math.round(diff / 86_400_000)
}

export const isOverdue = (iso: string, now: Date = new Date()): boolean =>
  new Date(iso).getTime() < now.getTime()

/**
 * "Today", "Tomorrow", "Fri", "3 days late" — short enough to sit inline on a
 * row without pushing the title around.
 */
export function formatDeadline(iso: string, now: Date = new Date()): string {
  const days = daysUntil(iso, now)
  if (days === 0) return 'Today'
  if (days === 1) return 'Tomorrow'
  if (days === -1) return 'Yesterday'
  if (days < 0) return `${Math.abs(days)} days late`
  if (days < 7) {
    return new Date(iso).toLocaleDateString(undefined, { weekday: 'short' })
  }
  return new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
}

/** `<input type="date">` wants YYYY-MM-DD in local time, not a UTC slice. */
export function toDateInput(iso: string | null): string {
  if (!iso) return ''
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

/**
 * The reverse. Parsed as local rather than letting `new Date("2026-08-16")`
 * treat it as UTC, which lands on the previous evening in western timezones
 * and shows the deadline as a day early.
 */
export function fromDateInput(value: string): string | null {
  const m = value.match(/^(\d{4})-(\d{2})-(\d{2})$/)
  if (!m) return null
  const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]))
  if (Number.isNaN(d.getTime())) return null
  return endOfDayIso(d)
}
