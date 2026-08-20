import type { Chore, RecurrenceUnit, Weekday } from '@/data/types'
import { WEEKDAY_LABELS } from '@/data/types'

/**
 * Cooldown state is *derived on the client*, never pushed.
 *
 * When a cooldown expires no database row changes, so Postgres emits no
 * realtime event — there is nothing to subscribe to. `next_due_at` is stored
 * only so the DB can index and sort by it; the decision below is what actually
 * moves a chore between the active list and the resting drawer.
 */
export function isResting(chore: Chore, now: number): boolean {
  if (!chore.is_recurring || !chore.next_due_at) return false
  return new Date(chore.next_due_at).getTime() > now
}

/** 0 → just completed, 1 → ready again. Drives the progress ring. */
export function cooldownProgress(chore: Chore, now: number): number {
  if (!chore.last_completed_at || !chore.next_due_at) return 1
  const start = new Date(chore.last_completed_at).getTime()
  const end = new Date(chore.next_due_at).getTime()
  if (end <= start) return 1
  return Math.min(1, Math.max(0, (now - start) / (end - start)))
}

const MIN = 60_000
const HOUR = 60 * MIN
const DAY = 24 * HOUR

/** Compact relative duration: "4h 20m", "3d", "in a moment". */
export function formatDuration(ms: number): string {
  if (ms <= 0) return 'now'
  if (ms < MIN) return 'under a minute'
  if (ms < HOUR) return `${Math.round(ms / MIN)}m`
  if (ms < DAY) {
    const h = Math.floor(ms / HOUR)
    const m = Math.round((ms % HOUR) / MIN)
    return m > 0 ? `${h}h ${m}m` : `${h}h`
  }
  const d = Math.floor(ms / DAY)
  const h = Math.round((ms % DAY) / HOUR)
  return h > 0 && d < 3 ? `${d}d ${h}h` : `${d}d`
}

export function readyIn(chore: Chore, now: number): string {
  if (!chore.next_due_at) return ''
  return formatDuration(new Date(chore.next_due_at).getTime() - now)
}

export const RECURRENCE_PRESETS: {
  label: string
  count: number
  unit: Exclude<RecurrenceUnit, 'weekdays'>
}[] = [
  { label: 'Daily', count: 1, unit: 'days' },
  { label: 'Every 2 days', count: 2, unit: 'days' },
  { label: 'Weekly', count: 1, unit: 'weeks' },
  { label: 'Every 2 weeks', count: 2, unit: 'weeks' },
  { label: 'Monthly', count: 1, unit: 'months' },
  { label: 'Every 3 months', count: 3, unit: 'months' },
  { label: 'Yearly', count: 1, unit: 'years' },
]

/** "Tue & Wed", "Sun, Thu & Fri" — ordered Sun→Sat regardless of pick order. */
export function describeWeekdays(days: Weekday[]): string {
  const ordered = [...days].sort((a, b) => a - b)
  const names = ordered.map((d) => WEEKDAY_LABELS[d].short)
  if (names.length <= 1) return names.join('')
  return `${names.slice(0, -1).join(', ')} & ${names[names.length - 1]}`
}

export function describeRecurrence(
  count: number | null,
  unit: RecurrenceUnit | null,
  days: Weekday[] | null = null,
): string {
  if (!unit) return ''
  if (unit === 'weekdays') return days?.length ? describeWeekdays(days) : ''
  if (!count) return ''
  const preset = RECURRENCE_PRESETS.find((p) => p.count === count && p.unit === unit)
  if (preset) return preset.label
  const singular = unit.slice(0, -1)
  return count === 1 ? `Every ${singular}` : `Every ${count} ${unit}`
}

/**
 * Seeds the "how often" editor's local state from a chore that already has a
 * recurrence — so opening the edit sheet on an existing chore shows its real
 * settings instead of resetting to the defaults a brand-new chore starts
 * with. The inverse of what ChoreAddBar builds *toward*.
 */
export function deriveRecurrenceUI(chore: {
  is_recurring: boolean
  recurrence_count: number | null
  recurrence_unit: RecurrenceUnit | null
  recurrence_days: Weekday[] | null
}): {
  mode: 'presets' | 'every' | 'days'
  preset: (typeof RECURRENCE_PRESETS)[number]
  custom: { count: string; unit: Exclude<RecurrenceUnit, 'weekdays'> }
  days: Set<Weekday>
} {
  const fallback = {
    mode: 'presets' as const,
    preset: RECURRENCE_PRESETS[0],
    custom: { count: '3', unit: 'days' as const },
    days: new Set<Weekday>(),
  }
  if (!chore.is_recurring || !chore.recurrence_unit) return fallback

  if (chore.recurrence_unit === 'weekdays') {
    return { ...fallback, mode: 'days', days: new Set(chore.recurrence_days ?? []) }
  }

  const unit = chore.recurrence_unit
  const count = chore.recurrence_count ?? 1
  const preset = RECURRENCE_PRESETS.find((p) => p.count === count && p.unit === unit)
  return preset
    ? { ...fallback, mode: 'presets', preset }
    : { ...fallback, mode: 'every', custom: { count: String(count), unit } }
}

/**
 * Time-of-day greeting for the launcher home screen.
 *
 * Boundaries chosen so nothing reads as wrong at the edges: "evening" starting
 * at 17:00 rather than 18:00 because it's dark by then for half the year, and
 * a small-hours case so someone up at 2am isn't told good evening.
 */
export function greeting(now: Date = new Date()): string {
  const hour = now.getHours()
  if (hour < 5) return 'Still up?'
  if (hour < 12) return 'Good morning'
  if (hour < 17) return 'Good afternoon'
  return 'Good evening'
}
