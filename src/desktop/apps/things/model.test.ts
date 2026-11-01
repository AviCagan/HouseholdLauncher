import { describe, expect, it } from 'vitest'
import { buildBoard, findRow, navOrder, step, type BoardInput } from './model'
import type { Chore, ShoppingItem, Store, Todo, WishlistItem } from '@/data/types'

const NOW = Date.parse('2026-06-01T12:00:00Z')
const base = { claimed_by: null, created_by: null, updated_by: null, created_at: '2026-01-01T00:00:00Z', updated_at: '2026-01-01T00:00:00Z' }

const todo = (id: string, patch: Partial<Todo> = {}): Todo => ({
  ...base,
  id,
  title: id,
  urgency: 1,
  sort_order: 0,
  notes: null,
  is_done: false,
  completed_by: null,
  completed_at: null,
  due_at: null,
  ...patch,
})

const chore = (id: string, patch: Partial<Chore> = {}): Chore => ({
  ...base,
  id,
  title: id,
  urgency: 1,
  sort_order: 0,
  notes: null,
  is_recurring: false,
  recurrence_count: null,
  recurrence_unit: null,
  recurrence_days: null,
  last_completed_at: null,
  last_completed_by: null,
  next_due_at: null,
  cooldown_notified_at: null,
  is_done: false,
  ...patch,
})

const store = (id: string, sort_order: number, is_online = false): Store => ({
  id,
  name: id,
  is_online,
  url: null,
  address: null,
  lat: null,
  lng: null,
  geocoded_at: null,
  geocode_source: null,
  color_hex: '#000',
  emoji: null,
  sort_order,
  created_at: base.created_at,
  updated_at: base.updated_at,
})

const item = (id: string, store_id: string | null, patch: Partial<ShoppingItem> = {}): ShoppingItem => ({
  ...base,
  id,
  title: id,
  urgency: 1,
  sort_order: 0,
  store_id,
  quantity: null,
  is_done: false,
  completed_at: null,
  url: null,
  image_url: null,
  price_cents: null,
  ...patch,
})

const wish = (id: string, owner_id: string | null, patch: Partial<WishlistItem> = {}): WishlistItem => ({
  id,
  title: id,
  notes: null,
  url: null,
  price_cents: null,
  image_url: null,
  desire_level: 3,
  owner_id,
  is_purchased: false,
  purchased_at: null,
  created_by: null,
  updated_by: null,
  sort_order: 0,
  created_at: base.created_at,
  updated_at: base.updated_at,
  ...patch,
})

const input = (patch: Partial<BoardInput>): BoardInput => ({
  todos: [],
  chores: [],
  shopping_items: [],
  stores: [],
  wishlist_items: [],
  now: NOW,
  sortBy: { todos: 'urgency', chores: 'urgency', shopping: 'urgency', wishlist: 'desire' },
  sortDesc: { todos: true, chores: true, shopping: true, wishlist: true },
  wishOwner: null,
  ...patch,
})

const ids = (rows: { id: string }[]) => rows.map((r) => r.id)
const none = new Set<string>()

describe('buildBoard', () => {
  it('sorts live to-dos by urgency and folds the done ones', () => {
    const board = buildBoard(input({ todos: [todo('low', { urgency: 0 }), todo('hot', { urgency: 2 }), todo('gone', { is_done: true })] }))
    expect(board.todos.count).toBe(2)
    expect(ids(navOrder(board.todos, none))).toEqual(['hot', 'low'])
    // Unfolding the tail brings the done ones into reach of the keyboard.
    expect(ids(navOrder(board.todos, new Set(['todos:done'])))).toEqual(['hot', 'low', 'gone'])
  })

  it('splits chores into ready, resting and done', () => {
    const board = buildBoard(
      input({
        chores: [
          chore('ready'),
          chore('resting', { is_recurring: true, next_due_at: '2026-06-03T00:00:00Z' }),
          chore('due-again', { is_recurring: true, next_due_at: '2026-05-01T00:00:00Z' }),
          chore('finished', { is_done: true }),
        ],
      }),
    )
    const groups = Object.fromEntries(board.chores.groups.map((g) => [g.id, ids(g.rows)]))
    expect(groups.live.sort()).toEqual(['due-again', 'ready'])
    expect(groups.resting).toEqual(['resting'])
    expect(groups.done).toEqual(['finished'])
  })

  it('groups shopping by store order, unsorted after, online last', () => {
    const board = buildBoard(
      input({
        stores: [store('web', 0, true), store('b', 2), store('a', 1)],
        shopping_items: [item('i1', 'b'), item('i2', 'a'), item('i3', null), item('i4', 'web'), item('i5', 'gone-store')],
      }),
    )
    expect(board.shopping.groups.map((g) => g.id)).toEqual(['store:a', 'store:b', 'store:none', 'store:web'])
    // An item whose store was deleted lands with the unsorted ones rather
    // than vanishing.
    expect(ids(board.shopping.groups[2].rows).sort()).toEqual(['i3', 'i5'])
    expect(board.shopping.groups[3].divider).toBe('Online')
  })

  it('filters the wishlist by whose wish it is', () => {
    const wishes = [wish('mine', 'me'), wish('theirs', 'them'), wish('ours', null)]
    expect(ids(navOrder(buildBoard(input({ wishlist_items: wishes, wishOwner: 'me' })).wishlist, none))).toEqual(['mine'])
    expect(ids(navOrder(buildBoard(input({ wishlist_items: wishes, wishOwner: 'shared' })).wishlist, none))).toEqual(['ours'])
    expect(buildBoard(input({ wishlist_items: wishes })).wishlist.count).toBe(3)
  })

  it('finds which column a row is in', () => {
    const board = buildBoard(input({ shopping_items: [item('eggs', null)] }))
    expect(findRow(board, 'eggs')?.col).toBe('shopping')
    expect(findRow(board, 'nope')).toBeNull()
  })
})

describe('step', () => {
  const rows = [{ id: 'a' }, { id: 'b' }, { id: 'c' }] as never[]

  it('starts at the top going down and at the bottom going up', () => {
    expect(step(rows, null, 1)).toMatchObject({ id: 'a' })
    expect(step(rows, null, -1)).toMatchObject({ id: 'c' })
  })

  it('clamps at both ends', () => {
    expect(step(rows, 'c', 1)).toMatchObject({ id: 'c' })
    expect(step(rows, 'a', -1)).toMatchObject({ id: 'a' })
    expect(step(rows, 'a', 1)).toMatchObject({ id: 'b' })
  })

  it('has nothing to step to in an empty column', () => {
    expect(step([], null, 1)).toBeNull()
  })
})
