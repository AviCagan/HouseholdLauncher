import { describe, expect, it } from 'vitest'
import {
  knownNames,
  normaliseName,
  openDebts,
  outstandingTotal,
  paidDebts,
  summarise,
} from './summary'
import type { Debt } from '@/data/types'

let seq = 0

function debt(patch: Partial<Debt> = {}): Debt {
  seq += 1
  return {
    id: `debt-${seq}`,
    direction: 'owed_to_us',
    counterparty: 'Sam',
    counterparty_key: 'sam',
    amount_cents: 1000,
    reason: null,
    notes: null,
    is_paid: false,
    paid_at: null,
    paid_by: null,
    created_by: null,
    updated_by: null,
    sort_order: seq,
    created_at: `2026-01-${String(seq).padStart(2, '0')}T00:00:00.000Z`,
    updated_at: `2026-01-${String(seq).padStart(2, '0')}T00:00:00.000Z`,
    ...patch,
  }
}

describe('normaliseName', () => {
  it('folds case, surrounding space and repeated spaces', () => {
    expect(normaliseName('  Sam ')).toBe('sam')
    expect(normaliseName('Mary  Jane')).toBe('mary jane')
    expect(normaliseName('MARY JANE')).toBe('mary jane')
  })
})

describe('summarise', () => {
  it('adds up one person listed several times', () => {
    const rows = [
      debt({ counterparty: 'Sam', amount_cents: 2000 }),
      debt({ counterparty: 'sam', amount_cents: 1550 }),
      debt({ counterparty: ' Sam  ', amount_cents: 450 }),
    ]
    const [sam] = summarise(rows, 'owed_to_us')
    expect(sam.total).toBe(4000)
    expect(sam.count).toBe(3)
  })

  it('prefers a capitalised spelling over a hurried lower-case one', () => {
    const rows = [debt({ counterparty: 'sam' }), debt({ counterparty: 'Sam' })]
    expect(summarise(rows, 'owed_to_us')[0].name).toBe('Sam')
  })

  it('keeps the two directions apart', () => {
    const rows = [
      debt({ counterparty: 'Sam', amount_cents: 2000, direction: 'owed_to_us' }),
      debt({ counterparty: 'Sam', amount_cents: 500, direction: 'we_owe' }),
    ]
    expect(summarise(rows, 'owed_to_us')[0].total).toBe(2000)
    expect(summarise(rows, 'we_owe')[0].total).toBe(500)
  })

  it('drops settled entries rather than netting them off', () => {
    const rows = [
      debt({ counterparty: 'Sam', amount_cents: 2000 }),
      debt({ counterparty: 'Sam', amount_cents: 900, is_paid: true, paid_at: '2026-02-01T00:00:00.000Z' }),
    ]
    const [sam] = summarise(rows, 'owed_to_us')
    expect(sam.total).toBe(2000)
    expect(sam.count).toBe(1)
  })

  it('omits a person entirely once every entry is settled', () => {
    const rows = [
      debt({ counterparty: 'Sam', is_paid: true, paid_at: '2026-02-01T00:00:00.000Z' }),
      debt({ counterparty: 'Jo', amount_cents: 300 }),
    ]
    expect(summarise(rows, 'owed_to_us').map((p) => p.name)).toEqual(['Jo'])
  })

  it('orders by amount, biggest debt first', () => {
    const rows = [
      debt({ counterparty: 'Jo', amount_cents: 500 }),
      debt({ counterparty: 'Sam', amount_cents: 9000 }),
      debt({ counterparty: 'Alex', amount_cents: 2500 }),
    ]
    expect(summarise(rows, 'owed_to_us').map((p) => p.name)).toEqual(['Sam', 'Alex', 'Jo'])
  })

  it('groups on the typed name even when the stored key disagrees', () => {
    // What an optimistic local insert looks like before the trigger runs.
    const rows = [
      debt({ counterparty: 'Sam', counterparty_key: 'sam', amount_cents: 1000 }),
      debt({ counterparty: 'Sam', counterparty_key: '', amount_cents: 1000 }),
    ]
    expect(summarise(rows, 'owed_to_us')).toHaveLength(1)
  })

  it('returns nothing for an empty list', () => {
    expect(summarise([], 'owed_to_us')).toEqual([])
  })
})

describe('outstandingTotal', () => {
  it('sums only unpaid rows in the asked-for direction', () => {
    const rows = [
      debt({ amount_cents: 1000 }),
      debt({ amount_cents: 2000, is_paid: true, paid_at: '2026-02-01T00:00:00.000Z' }),
      debt({ amount_cents: 400, direction: 'we_owe' }),
    ]
    expect(outstandingTotal(rows, 'owed_to_us')).toBe(1000)
    expect(outstandingTotal(rows, 'we_owe')).toBe(400)
  })
})

describe('openDebts / paidDebts', () => {
  it('splits by paid state and orders each sensibly', () => {
    const older = debt({ is_paid: true, paid_at: '2026-02-01T00:00:00.000Z' })
    const newer = debt({ is_paid: true, paid_at: '2026-03-01T00:00:00.000Z' })
    const open = debt()

    expect(openDebts([older, newer, open], 'owed_to_us').map((d) => d.id)).toEqual([open.id])
    // Most recently settled first, so history reads newest-down.
    expect(paidDebts([older, newer, open], 'owed_to_us').map((d) => d.id)).toEqual([
      newer.id,
      older.id,
    ])
  })
})

describe('knownNames', () => {
  it('offers each person once, spanning both directions and settled rows', () => {
    const rows = [
      debt({ counterparty: 'Sam' }),
      debt({ counterparty: 'sam', direction: 'we_owe' }),
      debt({ counterparty: 'Jo', is_paid: true, paid_at: '2026-02-01T00:00:00.000Z' }),
    ]
    const names = knownNames(rows)
    expect(names).toHaveLength(2)
    expect(names.map((n) => n.toLowerCase()).sort()).toEqual(['jo', 'sam'])
  })

  it('suggests the most recent spelling of a name', () => {
    const rows = [
      debt({ counterparty: 'sam', created_at: '2026-01-01T00:00:00.000Z' }),
      debt({ counterparty: 'Sam R', created_at: '2026-05-01T00:00:00.000Z' }),
    ]
    expect(knownNames(rows)[0]).toBe('Sam R')
  })
})
