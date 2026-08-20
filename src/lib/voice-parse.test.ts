import { describe, expect, it } from 'vitest'
import {
  parseCommand,
  resolveList,
  resolveStore,
  resolveWho,
  URGENT_LEVEL,
} from '../../supabase/functions/add/parse'
import { URGENCY } from '@/data/types'

/**
 * Tests the exact module the Edge Function ships, imported directly rather
 * than duplicated — same arrangement as notify/classify.ts, and for the same
 * reason: a threshold that drifts out of step with the app is invisible until
 * someone notices a feature quietly stopped working.
 */

describe('URGENT_LEVEL', () => {
  it('tracks the app-wide urgency scale', () => {
    expect(URGENT_LEVEL).toBe(URGENCY.URGENT)
  })
})

describe('resolveList', () => {
  it('accepts the names people actually say', () => {
    expect(resolveList('groceries')).toBe('shopping_items')
    expect(resolveList('shopping list')).toBe('shopping_items')
    expect(resolveList('to-do')).toBe('todos')
    expect(resolveList('chores')).toBe('chores')
    expect(resolveList('wishlist')).toBe('wishlist_items')
  })

  it('accepts the raw table names a shortcut would be configured with', () => {
    expect(resolveList('shopping_items')).toBe('shopping_items')
    expect(resolveList('todos')).toBe('todos')
  })

  it('returns null for anything it does not recognise', () => {
    expect(resolveList('fridge')).toBeNull()
    expect(resolveList('')).toBeNull()
    expect(resolveList(null)).toBeNull()
  })
})

describe('parseCommand', () => {
  it('takes the list hint when one is given', () => {
    const c = parseCommand('milk', 'shopping')
    expect(c).toEqual({
      list: 'shopping_items',
      title: 'Milk',
      urgency: 1,
      store: null,
      storeSpoken: null,
      who: null,
    })
  })

  it('infers the list from the sentence when there is no hint', () => {
    const c = parseCommand('add milk to the shopping list')
    expect(c?.list).toBe('shopping_items')
    expect(c?.title).toBe('Milk')
  })

  it('strips assistant filler', () => {
    expect(parseCommand('Hey Google, add bread')?.title).toBe('Bread')
    expect(parseCommand('please add bread')?.title).toBe('Bread')
    expect(parseCommand('OK Google can you add bread')?.title).toBe('Bread')
  })

  it('picks up urgency and removes the word from the title', () => {
    const c = parseCommand('urgent: call the plumber', 'todos')
    expect(c?.urgency).toBe(URGENT_LEVEL)
    expect(c?.title).not.toMatch(/urgent/i)
  })

  it('defaults to medium urgency', () => {
    expect(parseCommand('call the plumber', 'todos')?.urgency).toBe(1)
  })

  it('does not strip a trailing phrase that is not a list name', () => {
    const c = parseCommand('add a note to the fridge', 'todos')
    expect(c?.title).toBe('Note to the fridge')
  })

  it('falls back to to-dos when nothing names a list', () => {
    expect(parseCommand('water the plants')?.list).toBe('todos')
  })

  it('rejects empty and filler-only input', () => {
    expect(parseCommand('')).toBeNull()
    expect(parseCommand('   ')).toBeNull()
    expect(parseCommand('add')).toBeNull()
  })

  it('tidies punctuation and capitalises', () => {
    expect(parseCommand('add  eggs.', 'shopping')?.title).toBe('Eggs')
  })

  it('does not leak regex state between calls', () => {
    // URGENT_WORDS is a global regex; a stale lastIndex would make the second
    // call miss a match at the start of its own string.
    parseCommand('urgent thing one', 'todos')
    expect(parseCommand('urgent thing two', 'todos')?.urgency).toBe(URGENT_LEVEL)
    expect(parseCommand('urgent thing three', 'todos')?.urgency).toBe(URGENT_LEVEL)
  })
})

describe('resolveStore', () => {
  const stores = ["Trader Joe's", 'Costco', 'Amazon']

  it('matches case-insensitively', () => {
    expect(resolveStore('costco', stores)).toBe('Costco')
    expect(resolveStore('COSTCO', stores)).toBe('Costco')
  })

  it("matches when speech-to-text drops the apostrophe", () => {
    expect(resolveStore('trader joes', stores)).toBe("Trader Joe's")
  })

  it('returns null for something that is not a store', () => {
    expect(resolveStore('noon', stores)).toBeNull()
    expect(resolveStore('', stores)).toBeNull()
    expect(resolveStore(null, stores)).toBeNull()
  })
})

describe('parseCommand: stores', () => {
  const stores = ["Trader Joe's", 'Costco']

  it('reads a store out of the sentence and picks the shopping list', () => {
    const c = parseCommand('add milk at Costco', null, null, stores)
    expect(c?.store).toBe('Costco')
    expect(c?.list).toBe('shopping_items')
    expect(c?.title).toBe('Milk')
  })

  it('takes an explicit store hint, which is how a per-store shortcut works', () => {
    const c = parseCommand('milk', 'shopping', 'costco', stores)
    expect(c?.store).toBe('Costco')
    expect(c?.title).toBe('Milk')
  })

  it('handles a list and a store in either order', () => {
    const a = parseCommand('add milk to shopping at Costco', null, null, stores)
    expect([a?.list, a?.store, a?.title]).toEqual(['shopping_items', 'Costco', 'Milk'])
    const b = parseCommand('add milk at Costco to shopping', null, null, stores)
    expect([b?.list, b?.store, b?.title]).toEqual(['shopping_items', 'Costco', 'Milk'])
  })

  it('leaves the words alone when the trailing phrase is not a real store', () => {
    // The whole reason store names are passed in rather than guessed.
    const c = parseCommand('meet Sam at noon', 'todos', null, stores)
    expect(c?.store).toBeNull()
    expect(c?.title).toBe('Meet Sam at noon')
  })

  it('does not attach a store to a list that has no stores', () => {
    const c = parseCommand('batteries at Costco', 'todos', null, stores)
    expect(c?.store).toBeNull()
  })

  it('reports an unknown store rather than burying it in the title', () => {
    // Nothing matches, but on the shopping list "at Costco" is plainly a shop.
    // Keeping it in the title would file the item as "Milk at Costco" with no
    // store — the worst of both. The caller asks which store was meant.
    const c = parseCommand('add milk at Costco', 'shopping', null, [])
    expect(c?.store).toBeNull()
    expect(c?.storeSpoken).toBe('Costco')
    expect(c?.title).toBe('Milk')
  })

  it('does not treat a trailing phrase on other lists as a store', () => {
    const c = parseCommand('meet Sam at noon', 'todos', null, stores)
    expect(c?.storeSpoken).toBeNull()
    expect(c?.title).toBe('Meet Sam at noon')
  })

  it('leaves storeSpoken empty once the store actually resolves', () => {
    const c = parseCommand('add milk at Costco', 'shopping', null, stores)
    expect(c?.store).toBe('Costco')
    expect(c?.storeSpoken).toBeNull()
  })
})

describe('resolveWho', () => {
  const people = [
    { slug: 'avi', name: 'Avi' },
    { slug: 'jackie', name: 'Jackie' },
  ]

  it('matches by slug or display name, case-insensitively', () => {
    expect(resolveWho('avi', people)).toBe('avi')
    expect(resolveWho('Jackie', people)).toBe('jackie')
    expect(resolveWho('JACKIE', people)).toBe('jackie')
  })

  it('returns null for anyone not in the household', () => {
    expect(resolveWho('Sam', people)).toBeNull()
    expect(resolveWho('', people)).toBeNull()
    expect(resolveWho(null, people)).toBeNull()
  })
})

describe('parseCommand: who', () => {
  const people = [
    { slug: 'avi', name: 'Avi' },
    { slug: 'jackie', name: 'Jackie' },
  ]

  it('reads a spoken sign-off and attributes it', () => {
    expect(parseCommand('add milk, this is Avi', 'shopping', null, [], people)?.who).toBe('avi')
    expect(parseCommand("call the plumber it's Jackie", 'todos', null, [], people)?.who).toBe(
      'jackie',
    )
    expect(parseCommand("water the plants I'm Avi", 'todos', null, [], people)?.who).toBe('avi')
  })

  it('strips the sign-off out of the title', () => {
    const c = parseCommand('add milk, this is Avi', 'shopping', null, [], people)
    expect(c?.title).toBe('Milk')
  })

  it('leaves the words alone when the name is not one of ours', () => {
    const c = parseCommand("tell Sam I'm running late", 'todos', null, [], people)
    expect(c?.who).toBeNull()
    expect(c?.title).toBe("Tell Sam I'm running late")
  })

  it('is unattributed when no sign-off was said', () => {
    expect(parseCommand('milk', 'shopping', null, [], people)?.who).toBeNull()
  })

  it('resolves the store and the sign-off together, in either order', () => {
    const stores = ['Costco']
    const a = parseCommand('add milk at Costco, this is Avi', null, null, stores, people)
    expect([a?.store, a?.who, a?.title]).toEqual(['Costco', 'avi', 'Milk'])
  })
})
