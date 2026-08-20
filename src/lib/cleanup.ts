import { useData, dataActions } from '@/store/useData'

/**
 * Remove finished items once they've been done long enough.
 *
 * Runs on launch and then hourly. Deliberately client-side rather than a
 * scheduled database job: the household setting lives in the same row both
 * apps already read, and at this data size scanning is trivial. The tradeoff
 * is that clearing only happens when one of you opens the app — which is fine,
 * because nobody is looking at the list when neither app is open.
 */

const HOUR = 60 * 60 * 1000
let timer: ReturnType<typeof setInterval> | null = null

export async function sweepCompleted(): Promise<number> {
  const state = useData.getState()
  const days = state.household_settings[0]?.auto_clear_days ?? 0
  if (!days || days <= 0) return 0

  const cutoff = Date.now() - days * 24 * HOUR
  let removed = 0

  const stale = (completedAt: string | null, updatedAt: string) => {
    // Fall back to updated_at for rows completed before this field existed.
    const when = new Date(completedAt ?? updatedAt).getTime()
    return Number.isFinite(when) && when < cutoff
  }

  for (const todo of state.todos) {
    if (todo.is_done && stale(todo.completed_at, todo.updated_at)) {
      await dataActions.remove('todos', todo.id)
      removed++
    }
  }

  for (const item of state.shopping_items) {
    if (item.is_done && stale(item.completed_at, item.updated_at)) {
      await dataActions.remove('shopping_items', item.id)
      removed++
    }
  }

  return removed
}

export function startCleanup(): void {
  void sweepCompleted()
  if (timer !== null) return
  timer = setInterval(() => void sweepCompleted(), HOUR)
}

export const AUTO_CLEAR_OPTIONS: { days: number; label: string }[] = [
  { days: 0, label: 'Never' },
  { days: 1, label: '1 day' },
  { days: 3, label: '3 days' },
  { days: 7, label: '1 week' },
  { days: 14, label: '2 weeks' },
  { days: 30, label: '1 month' },
]
