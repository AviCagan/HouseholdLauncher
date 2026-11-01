import { describe, expect, it } from 'vitest'
import type { Chore, ShoppingItem, Store, Todo } from '@/data/types'
import { activeChores, activeTodos, longDate, restingChores, shoppingByStore } from './dashboard'

const base = {
  claimed_by: null,
  created_by: null,
  updated_by: null,
  created_at: '2026-01-01T00:00:00.000Z',
  updated_at: '2026-01-01T00:00:00.000Z',
}

const todo = (id: string, urgency: 0 | 1 | 2, sort_order: number, is_done = false): Todo => ({
  ...base,
  id,
  title: id,
  urgency,
  sort_order,
  notes: null,
  is_done,
  completed_by: null,
  completed_at: null,
  due_at: null,
})

const chore = (id: string, extra: Partial<Chore> = {}): Chore => ({
  ...base,
  id,
  title: id,
  urgency: 1,
  sort_order: 1,
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
  ...extra,
})

const item = (id: string, store_id: string | null, is_done = false): ShoppingItem => ({
  ...base,
  id,
  title: id,
  urgency: 1,
  sort_order: 1,
  store_id,
  quantity: null,
  is_done,
  completed_at: null,
  url: null,
  image_url: null,
  price_cents: null,
})

const store = (id: string, sort_order: number): Store => ({
  id,
  name: id,
  is_online: false,
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

describe('activeTodos', () => {
  it('drops finished ones and puts the most urgent first, newest within a level', () => {
    const rows = [todo('low', 0, 5), todo('done', 2, 9, true), todo('urgent-old', 2, 1), todo('urgent-new', 2, 3)]
    expect(activeTodos(rows).map((t) => t.id)).toEqual(['urgent-new', 'urgent-old', 'low'])
  })
})

describe('activeChores', () => {
  const now = Date.parse('2026-06-01T12:00:00.000Z')
  const resting = chore('resting', { is_recurring: true, next_due_at: '2026-06-03T00:00:00.000Z' })
  const ready = chore('ready', { is_recurring: true, next_due_at: '2026-05-30T00:00:00.000Z' })
  const plain = chore('plain')
  const finished = chore('finished', { is_done: true })

  it('leaves out what is resting or finished', () => {
    expect(activeChores([resting, ready, plain, finished], now).map((c) => c.id)).toEqual(['ready', 'plain'])
  })

  it('counts the resting ones separately', () => {
    expect(restingChores([resting, ready, plain, finished], now).map((c) => c.id)).toEqual(['resting'])
  })
})

describe('shoppingByStore', () => {
  it('counts open items per store in store order, with the storeless ones last', () => {
    const stores = [store('b', 2), store('a', 1), store('empty', 3)]
    const items = [item('1', 'b'), item('2', 'a'), item('3', 'b'), item('4', null), item('5', 'gone'), item('6', 'a', true)]
    expect(shoppingByStore(items, stores).map((g) => [g.store?.id ?? null, g.count])).toEqual([
      ['a', 1],
      ['b', 2],
      [null, 2],
    ])
  })

  it('is empty when there is nothing to buy', () => {
    expect(shoppingByStore([item('1', 'a', true)], [store('a', 1)])).toEqual([])
  })
})

describe('longDate', () => {
  it('spells the day out', () => {
    expect(longDate(new Date(2026, 10, 1, 12))).toBe('Sunday 1 November')
  })
})
