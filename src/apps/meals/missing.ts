import type { Dish, Meal, ShoppingItem, Store } from '@/data/types'
import { shoppingList } from './nutrition'

/**
 * The bridge from a meal to the shopping list in Things.
 *
 * Pure: what is on the meal, what is already on the list, where each thing
 * was bought last time, and what an export would actually write. The sheet
 * that drives it is all taps; the decisions are here, where they can be
 * tested.
 */

export interface MissingLine {
  /** Stable across re-renders: dish id plus the ingredient's position. */
  key: string
  dishId: string
  dishName: string
  dishEmoji: string
  batches: number
  /** Which meal it came from — one meal's lines all share it. */
  mealName: string
  mealEmoji: string
  name: string
  /** Already scaled to the batches. */
  amount: string | null
}

export type MealLike = Pick<Meal, 'name' | 'emoji' | 'courses' | 'people'>

/** Every ingredient of every dish in the meal(s), scaled, in course order. */
export function missingCandidates(meals: MealLike[], dishes: Dish[]): MissingLine[] {
  const out: MissingLine[] = []
  meals.forEach((meal, m) => {
    for (const group of shoppingList(meal, dishes)) {
      group.lines.forEach((line, i) => {
        if (!line.name.trim()) return
        out.push({
          key: `${m}:${group.dish.id}:${i}`,
          dishId: group.dish.id,
          dishName: group.dish.name,
          dishEmoji: group.dish.emoji,
          batches: group.batches,
          mealName: meal.name,
          mealEmoji: meal.emoji,
          name: line.name.trim(),
          amount: line.amount,
        })
      })
    }
  })
  return out
}

/**
 * "Eggs", "eggs " and "egg" are the same thing on a shopping list. Lowercase,
 * squeeze the spaces, drop a trailing s — good enough to match what was
 * bought before without a thesaurus.
 */
export function normaliseName(name: string): string {
  const n = name.toLowerCase().replace(/\s+/g, ' ').trim()
  return n.length > 3 && n.endsWith('s') ? n.slice(0, -1) : n
}

/** The active shopping item that already covers this, if there is one. */
export function alreadyListed(name: string, items: ShoppingItem[]): ShoppingItem | null {
  const key = normaliseName(name)
  return items.find((i) => !i.is_done && normaliseName(i.title) === key) ?? null
}

/**
 * Where this was bought last time: the store on the most recent shopping
 * item with the same name, done or not. Null when it has never been listed,
 * or was never given a store.
 */
export function rememberedStore(name: string, items: ShoppingItem[]): string | null {
  const key = normaliseName(name)
  const past = items
    .filter((i) => normaliseName(i.title) === key && i.store_id)
    .sort((a, b) => b.updated_at.localeCompare(a.updated_at))
  return past[0]?.store_id ?? null
}

/** "eggs" → "Eggs". Shopping items read better with a capital. */
export const shoppingTitle = (name: string): string => {
  const t = name.trim()
  return t ? t[0].toUpperCase() + t.slice(1) : t
}

export interface ExportRow {
  title: string
  storeId: string | null
  /** "4 + 2 · for Shabbat dinner" — amounts from every line that merged in. */
  quantity: string | null
  /** The lines this row was made from, for the summary. */
  from: MissingLine[]
}

/**
 * What an export writes.
 *
 * Lines with the same name merge into one item — eggs for the challah and
 * eggs for the cake are one thing to buy — with both amounts kept, so the
 * list says "4 + 2" rather than pretending to have added cups to eggs. An
 * ingredient that is already on the list is skipped and reported, not
 * duplicated. The store is whichever the person chose; two merged lines with
 * different stores go with the first, which is what the sheet showed.
 */
export function planExport(
  selected: MissingLine[],
  storeOf: (line: MissingLine) => string | null,
  items: ShoppingItem[],
): { rows: ExportRow[]; skipped: MissingLine[] } {
  const rows = new Map<string, ExportRow>()
  const skipped: MissingLine[] = []
  for (const line of selected) {
    if (alreadyListed(line.name, items)) {
      skipped.push(line)
      continue
    }
    const key = normaliseName(line.name)
    const existing = rows.get(key)
    if (existing) {
      existing.from.push(line)
      continue
    }
    rows.set(key, { title: shoppingTitle(line.name), storeId: storeOf(line), quantity: null, from: [line] })
  }
  for (const row of rows.values()) {
    const amounts = row.from.map((l) => l.amount).filter((a): a is string => !!a)
    const meals = [...new Set(row.from.map((l) => l.mealName))].filter(Boolean)
    const parts = [amounts.length ? amounts.join(' + ') : null, meals.length ? `for ${meals.join(', ')}` : null]
    row.quantity = parts.filter(Boolean).join(' · ') || null
  }
  return { rows: [...rows.values()], skipped }
}

/** Store groups in Things' own order, with the unsorted pile first. */
export function groupByStore<T extends { storeId: string | null }>(
  rows: T[],
  stores: Store[],
): { store: Store | null; rows: T[] }[] {
  const ordered = [...stores].sort((a, b) => a.sort_order - b.sort_order)
  const groups: { store: Store | null; rows: T[] }[] = [
    { store: null, rows: rows.filter((r) => !r.storeId || !stores.some((s) => s.id === r.storeId)) },
    ...ordered.map((store) => ({ store, rows: rows.filter((r) => r.storeId === store.id) })),
  ]
  return groups.filter((g) => g.rows.length > 0)
}
