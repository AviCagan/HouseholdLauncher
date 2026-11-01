import { describe, expect, it } from 'vitest'
import { matchScore, searchEverything, type SearchSource } from './search'
import type { Debt, LexiconEntry, ShoppingItem, Todo } from '@/data/types'

const base = { claimed_by: null, created_by: null, updated_by: null, sort_order: 0, created_at: '2026-01-01T00:00:00Z', updated_at: '2026-01-01T00:00:00Z' }

const todo = (id: string, title: string, is_done = false): Todo => ({
  ...base,
  id,
  title,
  urgency: 1,
  notes: null,
  is_done,
  completed_by: null,
  completed_at: null,
  due_at: null,
})

const item = (id: string, title: string, is_done = false): ShoppingItem => ({
  ...base,
  id,
  title,
  urgency: 1,
  store_id: null,
  quantity: null,
  is_done,
  completed_at: null,
  url: null,
  image_url: null,
  price_cents: null,
})

const debt = (id: string, counterparty: string, reason: string | null): Debt => ({
  ...base,
  id,
  direction: 'owed_to_us',
  counterparty,
  counterparty_key: counterparty.toLowerCase(),
  amount_cents: 1250,
  reason,
  notes: null,
  is_paid: false,
  paid_at: null,
  paid_by: null,
})

const word = (id: string, term: string, definition: string): LexiconEntry => ({
  id,
  term,
  pronunciation: null,
  part_of_speech: 'noun',
  definition,
  example: null,
  origin: null,
  tags: [],
  created_by: null,
  updated_by: null,
  created_at: base.created_at,
  updated_at: base.updated_at,
})

const empty: SearchSource = {
  todos: [],
  chores: [],
  shopping_items: [],
  wishlist_items: [],
  stores: [],
  debts: [],
  dishes: [],
  meals: [],
  lexicon_entries: [],
  watch_shows: [],
}

const everything = () => true

describe('matchScore', () => {
  it('ranks a prefix over a word start over a substring', () => {
    const q = 'mi'
    expect(matchScore('Milk', q)).toBeGreaterThan(matchScore('Hummus mix', q))
    expect(matchScore('Hummus mix', q)).toBeGreaterThan(matchScore('Tzimmes', q))
    expect(matchScore('Bread', q)).toBe(0)
  })

  it('treats regex characters in the query as text', () => {
    expect(matchScore('C++ book', 'c++')).toBe(3)
    expect(matchScore('a (b)', '(b')).toBe(2)
  })
})

describe('searchEverything', () => {
  it('finds rows across apps and links each to its own app', () => {
    const hits = searchEverything('sam', { ...empty, todos: [todo('t1', 'Call Sam')], debts: [debt('d1', 'Sam', 'Pizza')] }, everything)
    expect(hits.map((h) => h.appId).sort()).toEqual(['owe', 'things'])
    expect(hits.find((h) => h.appId === 'things')?.deepLink).toEqual({ tab: 'todos', table: 'todos', id: 't1' })
    expect(hits.find((h) => h.appId === 'owe')?.deepLink).toEqual({ id: 'd1' })
  })

  it('never searches an app the member cannot open', () => {
    const src = { ...empty, todos: [todo('t1', 'Sam')], debts: [debt('d1', 'Sam', null)] }
    expect(searchEverything('sam', src, (id) => id !== 'owe').every((h) => h.appId !== 'owe')).toBe(true)
  })

  it('puts a live match above a finished one of the same strength', () => {
    const hits = searchEverything('milk', { ...empty, shopping_items: [item('old', 'Milk', true), item('new', 'Milk')] }, everything)
    expect(hits.map((h) => h.key)).toEqual(['shop:new', 'shop:old'])
  })

  it('still lets a far better finished match beat a weak live one', () => {
    const hits = searchEverything('milk', { ...empty, shopping_items: [item('a', 'Buttermilk'), item('b', 'Milk', true)] }, everything)
    expect(hits[0].key).toBe('shop:b')
  })

  it('weighs a hit in the definition below a hit in the headword', () => {
    const hits = searchEverything(
      'rain',
      { ...empty, lexicon_entries: [word('w1', 'schlumpy', 'Rained on, emotionally'), word('w2', 'rainbird', 'Someone who loves weather')] },
      everything,
    )
    expect(hits[0].title).toBe('rainbird')
  })

  it('returns nothing for a blank query', () => {
    expect(searchEverything('   ', { ...empty, todos: [todo('t', 'x')] }, everything)).toEqual([])
  })
})
