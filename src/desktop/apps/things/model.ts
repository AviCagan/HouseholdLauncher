import { compareBy } from '@/components/shell/SortBar'
import { isResting } from '@/lib/time'
import type { SortKey, WishOwner } from '@/store/useUI'
import type { Chore, ShoppingItem, Store, TabKey, Todo, WishlistItem } from '@/data/types'

/**
 * Things as four columns, worked out once.
 *
 * The phone shows one list at a time and each tab sorts its own rows. On the
 * laptop all four are on screen together and the keyboard moves across them,
 * so the board needs one answer to "what is in each column, in what order" —
 * the same answer the rows are drawn from, or j and k would walk a different
 * list from the one you're looking at. Pure, so that answer is testable.
 *
 * The grouping matches the phone tab for tab: chores split into ready,
 * resting and done; shopping by store, physical shops first and online ones
 * apart; the wishlist filtered by whose wish it is.
 */

export type ColKey = TabKey

export const COLUMNS: { key: ColKey; title: string }[] = [
  { key: 'todos', title: 'To-do' },
  { key: 'chores', title: 'Chores' },
  { key: 'shopping', title: 'Shopping' },
  { key: 'wishlist', title: 'Wishlist' },
]

export type RowModel =
  | { kind: 'todo'; id: string; row: Todo; done: boolean }
  | { kind: 'chore'; id: string; row: Chore; done: boolean; resting: boolean }
  | { kind: 'shop'; id: string; row: ShoppingItem; done: boolean; store: Store | null }
  | { kind: 'wish'; id: string; row: WishlistItem; done: boolean }

export type ItemTable = 'todos' | 'chores' | 'shopping_items' | 'wishlist_items'

export const tableOf = (m: RowModel): ItemTable =>
  m.kind === 'todo' ? 'todos' : m.kind === 'chore' ? 'chores' : m.kind === 'shop' ? 'shopping_items' : 'wishlist_items'

export interface Group {
  /** Unique within the column; also the key its open/closed state is kept under. */
  id: string
  label: string
  color?: string
  online?: boolean
  rows: RowModel[]
  /** Done, bought: folded away until asked for, as on the phone. */
  tail: boolean
  /** A heading to sit above this group, for the start of the online stores. */
  divider?: string
}

export interface Column {
  key: ColKey
  title: string
  /** Live rows — what the phone shows beside the tab title. */
  count: number
  groups: Group[]
}

export interface BoardInput {
  todos: Todo[]
  chores: Chore[]
  shopping_items: ShoppingItem[]
  stores: Store[]
  wishlist_items: WishlistItem[]
  now: number
  sortBy: Record<TabKey, SortKey>
  sortDesc: Record<TabKey, boolean>
  wishOwner: WishOwner
}

export const UNSORTED = '__unsorted__'

export function buildBoard(input: BoardInput): Record<ColKey, Column> {
  const { now, sortBy, sortDesc } = input

  // --- to-do
  const todos = [...input.todos].sort(compareBy(sortBy.todos, sortDesc.todos))
  const todoLive = todos.filter((t) => !t.is_done)
  const todoDone = todos
    .filter((t) => t.is_done)
    .sort((a, b) => (b.completed_at ?? '').localeCompare(a.completed_at ?? ''))
  const todo = (t: Todo): RowModel => ({ kind: 'todo', id: t.id, row: t, done: t.is_done })

  // --- chores
  const chores = [...input.chores].sort(compareBy(sortBy.chores, sortDesc.chores))
  const chore = (c: Chore): RowModel => ({
    kind: 'chore',
    id: c.id,
    row: c,
    done: c.is_done && !isResting(c, now),
    resting: isResting(c, now),
  })
  const choreLive = chores.filter((c) => !c.is_done && !isResting(c, now))
  // Soonest back first, so the group reads as a countdown.
  const choreResting = chores
    .filter((c) => isResting(c, now))
    .sort((a, b) => (a.next_due_at ?? '').localeCompare(b.next_due_at ?? ''))
  // `!isResting`, not `!is_recurring` — see ChoresTab for the chore that
  // otherwise fell between every bucket and vanished.
  const choreDone = chores.filter((c) => c.is_done && !isResting(c, now))

  // --- shopping
  const storeById = new Map(input.stores.map((s) => [s.id, s]))
  const shop = (i: ShoppingItem): RowModel => ({
    kind: 'shop',
    id: i.id,
    row: i,
    done: i.is_done,
    store: (i.store_id && storeById.get(i.store_id)) || null,
  })
  const liveItems = input.shopping_items.filter((i) => !i.is_done)
  const byStore = new Map<string, ShoppingItem[]>()
  for (const item of liveItems) {
    // An item pointing at a deleted store lands with the unsorted ones
    // rather than in a group nobody can see.
    const key = item.store_id && storeById.has(item.store_id) ? item.store_id : UNSORTED
    byStore.set(key, [...(byStore.get(key) ?? []), item])
  }
  for (const list of byStore.values()) list.sort(compareBy(sortBy.shopping, sortDesc.shopping))
  const ordered = [...input.stores].sort((a, b) => a.sort_order - b.sort_order).filter((s) => byStore.has(s.id))
  const storeGroup = (s: Store): Group => ({
    id: `store:${s.id}`,
    label: s.name,
    color: s.color_hex,
    online: s.is_online,
    rows: byStore.get(s.id)!.map(shop),
    tail: false,
  })
  const physical = ordered.filter((s) => !s.is_online).map(storeGroup)
  const online = ordered.filter((s) => s.is_online).map(storeGroup)
  if (online[0]) online[0].divider = 'Online'
  const unsorted = byStore.get(UNSORTED)
  const bought = input.shopping_items
    .filter((i) => i.is_done)
    .sort((a, b) => (b.completed_at ?? '').localeCompare(a.completed_at ?? ''))

  // --- wishlist
  const owner = input.wishOwner
  const mine = (w: WishlistItem) =>
    owner === null ? true : owner === 'shared' ? w.owner_id === null : w.owner_id === owner
  const wishes = input.wishlist_items.filter(mine).sort(compareBy(sortBy.wishlist, sortDesc.wishlist))
  const wish = (w: WishlistItem): RowModel => ({ kind: 'wish', id: w.id, row: w, done: w.is_purchased })

  const groups = (list: (Group | null | false | undefined)[]): Group[] => list.filter((g): g is Group => !!g)

  return {
    todos: {
      key: 'todos',
      title: 'To-do',
      count: todoLive.length,
      groups: groups([
        { id: 'live', label: '', rows: todoLive.map(todo), tail: false },
        todoDone.length > 0 && { id: 'done', label: 'Done', rows: todoDone.map(todo), tail: true },
      ]),
    },
    chores: {
      key: 'chores',
      title: 'Chores',
      count: choreLive.length,
      groups: groups([
        { id: 'live', label: '', rows: choreLive.map(chore), tail: false },
        choreResting.length > 0 && { id: 'resting', label: 'Resting', rows: choreResting.map(chore), tail: false },
        choreDone.length > 0 && { id: 'done', label: 'Done', rows: choreDone.map(chore), tail: true },
      ]),
    },
    shopping: {
      key: 'shopping',
      title: 'Shopping',
      count: liveItems.length,
      groups: groups([
        ...physical,
        unsorted && { id: 'store:none', label: 'No store yet', color: '#8e8e9c', rows: unsorted.map(shop), tail: false },
        ...online,
        bought.length > 0 && { id: 'done', label: 'Bought', rows: bought.map(shop), tail: true },
      ]),
    },
    wishlist: {
      key: 'wishlist',
      title: 'Wishlist',
      count: wishes.filter((w) => !w.is_purchased).length,
      groups: groups([
        { id: 'live', label: '', rows: wishes.filter((w) => !w.is_purchased).map(wish), tail: false },
        wishes.some((w) => w.is_purchased) && {
          id: 'done',
          label: 'Bought',
          rows: wishes.filter((w) => w.is_purchased).map(wish),
          tail: true,
        },
      ]),
    },
  }
}

/** Is this group showing? Tails start folded, everything else open. */
export function groupOpen(col: ColKey, g: Group, toggled: ReadonlySet<string>): boolean {
  const flipped = toggled.has(`${col}:${g.id}`)
  return g.tail ? flipped : !flipped
}

/** The rows the keyboard can reach in a column, top to bottom. */
export function navOrder(col: Column, toggled: ReadonlySet<string>): RowModel[] {
  return col.groups.filter((g) => groupOpen(col.key, g, toggled)).flatMap((g) => g.rows)
}

/** One step up or down from `id`, clamped to the ends. Null id starts at the top. */
export function step(rows: RowModel[], id: string | null, by: 1 | -1): RowModel | null {
  if (rows.length === 0) return null
  const i = id === null ? -1 : rows.findIndex((r) => r.id === id)
  if (i < 0) return by === 1 ? rows[0] : rows[rows.length - 1]
  return rows[Math.min(rows.length - 1, Math.max(0, i + by))]
}

/** Which column holds a row, for a deep link that names only its id. */
export function findRow(board: Record<ColKey, Column>, id: string): { col: ColKey; row: RowModel; group: Group } | null {
  for (const c of COLUMNS) {
    for (const g of board[c.key].groups) {
      const row = g.rows.find((r) => r.id === id)
      if (row) return { col: c.key, row, group: g }
    }
  }
  return null
}
