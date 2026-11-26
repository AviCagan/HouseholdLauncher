import type { NanoChange } from '@/data/types'

/** "2 minutes ago", "yesterday", "Nov 3". */
export function relativeTime(iso: string, now = Date.now()): string {
  const diff = Math.max(0, now - new Date(iso).getTime())
  const minute = 60_000
  if (diff < minute) return 'just now'
  if (diff < 60 * minute) {
    const n = Math.floor(diff / minute)
    return `${n} minute${n === 1 ? '' : 's'} ago`
  }
  if (diff < 24 * 60 * minute) {
    const n = Math.floor(diff / (60 * minute))
    return `${n} hour${n === 1 ? '' : 's'} ago`
  }
  if (diff < 48 * 60 * minute) return 'yesterday'
  return new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
}

/** What each table's rows are called, for the change list. */
const NOUNS: Record<string, string> = {
  todos: 'to-do',
  chores: 'chore',
  shopping_items: 'shopping item',
  stores: 'store',
  wishlist_items: 'wishlist item',
  things_stock: 'stock count',
  debts: 'debt',
  dishes: 'dish',
  meals: 'meal',
  meal_templates: 'meal template',
  lexicon_entries: 'encyclopedia entry',
  watch_shows: 'show',
  watch_seasons: 'season',
  watch_ratings: 'rating',
  watch_views: 'episode',
  watch_settings: 'Watched setting',
  inventory_items: 'inventory item',
}

function label(row: Record<string, unknown> | null): string | null {
  if (!row) return null
  for (const key of ['title', 'name', 'term', 'counterparty', 'show_title']) {
    const value = row[key]
    if (typeof value === 'string' && value.trim()) return value.trim()
  }
  return null
}

/** "Added shopping item “Milk”". */
export function describeChange(change: Pick<NanoChange, 'op' | 'table_name' | 'before' | 'after'>): string {
  const noun = NOUNS[change.table_name] ?? (change.table_name.startsWith('ms_') ? 'Med School record' : change.table_name)
  const verb = change.op === 'insert' ? 'Added' : change.op === 'delete' ? 'Deleted' : 'Changed'
  const name = label(change.after) ?? label(change.before)
  return name ? `${verb} ${noun} “${name}”` : `${verb} ${noun}`
}
