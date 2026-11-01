import type { Chore, Meal, ShoppingItem, Store, Todo } from '@/data/types'
import { isResting } from '@/lib/time'
import { planWeeks, type PlanDay } from '@/apps/meals/plan'

/**
 * What the laptop home screen shows, worked out from the same rows the apps
 * read. Pure, so it can be tested without a window.
 */

/** Most urgent first; within a level, newest first — the To-do tab's default. */
const byUrgency = <T extends { urgency: number; sort_order: number }>(a: T, b: T): number =>
  b.urgency - a.urgency || b.sort_order - a.sort_order

export const activeTodos = (todos: Todo[]): Todo[] => todos.filter((t) => !t.is_done).sort(byUrgency)

export const activeChores = (chores: Chore[], now: number): Chore[] =>
  chores.filter((c) => !c.is_done && !isResting(c, now)).sort(byUrgency)

export const restingChores = (chores: Chore[], now: number): Chore[] =>
  chores.filter((c) => isResting(c, now))

export const activeShopping = (items: ShoppingItem[]): ShoppingItem[] =>
  items.filter((i) => !i.is_done).sort(byUrgency)

export interface StoreCount {
  /** null is the "no store yet" bucket. */
  store: Store | null
  count: number
}

/** How many open items each store has, in the stores' own order; the storeless ones last. */
export function shoppingByStore(items: ShoppingItem[], stores: Store[]): StoreCount[] {
  const active = items.filter((i) => !i.is_done)
  const known = new Set(stores.map((s) => s.id))
  const counts = new Map<string, number>()
  let loose = 0
  for (const item of active) {
    if (item.store_id && known.has(item.store_id)) counts.set(item.store_id, (counts.get(item.store_id) ?? 0) + 1)
    else loose += 1
  }
  const out: StoreCount[] = [...stores]
    .sort((a, b) => a.sort_order - b.sort_order)
    .filter((s) => counts.has(s.id))
    .map((s) => ({ store: s, count: counts.get(s.id)! }))
  if (loose > 0) out.push({ store: null, count: loose })
  return out
}

/** Today and the six days after it, with whatever is planned on each. */
export const weekAhead = (meals: Meal[], today: Date): PlanDay[] =>
  planWeeks(meals, today, 7)
    .flatMap((w) => w.days)
    .slice(0, 7)

const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']
const MONTHS = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
]

/** "Saturday 1 November" — spelled out by hand so it reads the same everywhere. */
export const longDate = (d: Date): string => `${DAYS[d.getDay()]} ${d.getDate()} ${MONTHS[d.getMonth()]}`
