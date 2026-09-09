import { describe, expect, it } from 'vitest'
import type { Dish, ShoppingItem, Store } from '@/data/types'
import { alreadyListed, groupByStore, missingCandidates, normaliseName, planExport, rememberedStore } from './missing'

const dish = (patch: Partial<Dish>): Dish => ({
  id: 'd',
  name: 'Dish',
  emoji: '🍽️',
  kind: 'main',
  ingredients: [],
  steps: [],
  servings: 4,
  cost_cents: null,
  nutrition: {},
  source_url: null,
  source_kind: 'manual',
  image_url: null,
  notes: null,
  tags: [],
  created_by: null,
  updated_by: null,
  created_at: '2026-09-01T00:00:00.000Z',
  updated_at: '2026-09-01T00:00:00.000Z',
  ...patch,
})

const item = (patch: Partial<ShoppingItem>): ShoppingItem => ({
  id: 'i',
  title: 'Eggs',
  urgency: 1,
  claimed_by: null,
  created_by: null,
  updated_by: null,
  sort_order: 0,
  created_at: '2026-09-01T00:00:00.000Z',
  updated_at: '2026-09-01T00:00:00.000Z',
  store_id: null,
  quantity: null,
  is_done: false,
  completed_at: null,
  url: null,
  image_url: null,
  price_cents: null,
  ...patch,
})

const challah = dish({
  id: 'challah',
  name: 'Challah',
  emoji: '🍞',
  servings: 6,
  ingredients: [
    { name: 'flour', amount: '4 cups', cost_cents: null },
    { name: 'eggs', amount: '2', cost_cents: null },
    { name: 'salt', amount: 'a pinch', cost_cents: null },
  ],
})
const cake = dish({
  id: 'cake',
  name: 'Honey cake',
  emoji: '🍰',
  servings: 12,
  ingredients: [
    { name: 'Eggs', amount: '3', cost_cents: null },
    { name: 'honey', amount: '1 cup', cost_cents: null },
  ],
})
const meal = {
  name: 'Shabbat dinner',
  emoji: '🕯️',
  people: 12,
  courses: [
    { role: 'bread' as const, label: 'Challah', dish_id: 'challah' },
    { role: 'dessert' as const, label: 'Dessert', dish_id: 'cake' },
    { role: 'side' as const, label: 'Side', dish_id: null },
  ],
}

describe('candidates', () => {
  it('lists every ingredient of every dish, scaled to the headcount', () => {
    const lines = missingCandidates([meal], [challah, cake])
    expect(lines.map((l) => `${l.name} ${l.amount}`)).toEqual([
      'flour 8 cups',
      'eggs 4',
      'salt a pinch ×2',
      'Eggs 3',
      'honey 1 cup',
    ])
    expect(lines[0].batches).toBe(2)
    expect(lines[3].batches).toBe(1)
    expect(new Set(lines.map((l) => l.key)).size).toBe(5)
  })
})

describe('matching names', () => {
  it('ignores case, spacing and a plural s', () => {
    expect(normaliseName('  Eggs ')).toBe('egg')
    expect(normaliseName('egg')).toBe('egg')
    expect(normaliseName('Bus')).toBe('bus')
    expect(normaliseName('Olive   oil')).toBe('olive oil')
  })

  it('finds what is already on the list, ignoring bought items', () => {
    const items = [item({ id: 'a', title: 'eggs', is_done: true }), item({ id: 'b', title: 'Egg' })]
    expect(alreadyListed('Eggs', items)?.id).toBe('b')
    expect(alreadyListed('Flour', items)).toBeNull()
  })

  it('remembers the store from the most recent time, bought or not', () => {
    const items = [
      item({ id: 'old', title: 'Eggs', store_id: 'costco', is_done: true, updated_at: '2026-08-01T00:00:00.000Z' }),
      item({ id: 'new', title: 'eggs', store_id: 'tj', is_done: true, updated_at: '2026-09-01T00:00:00.000Z' }),
      item({ id: 'none', title: 'eggs', store_id: null, updated_at: '2026-09-05T00:00:00.000Z' }),
    ]
    expect(rememberedStore('Eggs', items)).toBe('tj')
    expect(rememberedStore('Flour', items)).toBeNull()
  })
})

describe('planning the export', () => {
  const lines = missingCandidates([meal], [challah, cake])

  it('merges the same ingredient from two dishes into one item with both amounts', () => {
    const { rows, skipped } = planExport(lines, () => null, [])
    expect(skipped).toEqual([])
    expect(rows.map((r) => r.title)).toEqual(['Flour', 'Eggs', 'Salt', 'Honey'])
    const eggs = rows.find((r) => r.title === 'Eggs')!
    expect(eggs.quantity).toBe('4 + 3 · for Shabbat dinner')
    expect(eggs.from).toHaveLength(2)
  })

  it('skips what is already on the list rather than adding it twice', () => {
    const { rows, skipped } = planExport(lines, () => null, [item({ title: 'flour' })])
    expect(rows.map((r) => r.title)).not.toContain('Flour')
    expect(skipped.map((l) => l.name)).toEqual(['flour'])
  })

  it('keeps the store the person chose', () => {
    const { rows } = planExport(lines, (l) => (l.name === 'honey' ? 'tj' : null), [])
    expect(rows.find((r) => r.title === 'Honey')?.storeId).toBe('tj')
    expect(rows.find((r) => r.title === 'Flour')?.storeId).toBeNull()
  })

  it('writes the quantity as the amount plus the meal, or just the meal', () => {
    const { rows } = planExport(lines, () => null, [])
    expect(rows.find((r) => r.title === 'Flour')?.quantity).toBe('8 cups · for Shabbat dinner')
    const milk = dish({ id: 'milk', ingredients: [{ name: 'milk', amount: null, cost_cents: null }] })
    const tuesday = { ...meal, name: 'Tuesday', people: 4, courses: [{ role: 'drink' as const, label: 'Drink', dish_id: 'milk' }] }
    const bare = planExport(missingCandidates([tuesday], [milk]), () => null, [])
    expect(bare.rows[0].quantity).toBe('for Tuesday')
  })
})

describe('grouping by store', () => {
  const store = (id: string, sort_order: number): Store => ({
    id, name: id, is_online: false, url: null, address: null, lat: null, lng: null, geocoded_at: null,
    geocode_source: null, color_hex: '#000', emoji: null, sort_order,
    created_at: '2026-09-01T00:00:00.000Z', updated_at: '2026-09-01T00:00:00.000Z',
  })
  it('puts the unsorted pile first, then stores in their own order, dropping empty ones', () => {
    const groups = groupByStore(
      [{ storeId: 'b', n: 1 }, { storeId: null, n: 2 }, { storeId: 'a', n: 3 }, { storeId: 'gone', n: 4 }],
      [store('b', 2), store('a', 1), store('c', 3)],
    )
    expect(groups.map((g) => g.store?.id ?? null)).toEqual([null, 'a', 'b'])
    expect(groups[0].rows.map((r) => r.n)).toEqual([2, 4])
  })
})
