import { describe, expect, it } from 'vitest'
import {
  appendNote,
  knownNames,
  normaliseName,
  openDebts,
  outstandingTotal,
  paidDebts,
  planPayment,
  planSettlement,
  settleCandidates,
  settledAgainst,
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

describe('settling balances', () => {
  const nuri = (patch: Partial<Debt>) => debt({ counterparty: 'Nuri', counterparty_key: 'nuri', ...patch })

  it('only offers people who are open on both lists', () => {
    const rows = [
      nuri({ direction: 'we_owe', amount_cents: 20000 }),
      nuri({ direction: 'owed_to_us', amount_cents: 10000 }),
      debt({ counterparty: 'Sam', counterparty_key: 'sam', direction: 'owed_to_us' }),
      // Paid rows don't count as "on the list".
      debt({ counterparty: 'Sam', counterparty_key: 'sam', direction: 'we_owe', is_paid: true, paid_at: 'x' }),
    ]
    const c = settleCandidates(rows)
    expect(c).toHaveLength(1)
    expect(c[0]).toMatchObject({ name: 'Nuri', owedToUs: 10000, weOwe: 20000 })
    expect(planSettlement(rows, 'sam')).toBeNull()
  })

  it('pays the small entries off in full and leaves the big one alone', () => {
    // We owe Nuri 100 + 100; he owes us 6 + 94. His side is wiped; on ours
    // the smallest entry that fits is paid and the other is untouched.
    const rows = [
      nuri({ id: 'a', direction: 'we_owe', amount_cents: 10000, reason: 'flights' }),
      nuri({ id: 'b', direction: 'we_owe', amount_cents: 10000, reason: 'hotel' }),
      nuri({ id: 'c', direction: 'owed_to_us', amount_cents: 600, reason: 'coffee' }),
      nuri({ id: 'd', direction: 'owed_to_us', amount_cents: 9400, reason: 'dinner' }),
    ]
    const plan = planSettlement(rows, 'nuri')!
    expect(plan.smaller).toBe('owed_to_us')
    expect(plan.amount).toBe(10000)
    expect(plan.wipe.map((d) => d.id).sort()).toEqual(['c', 'd'])
    expect(plan.payOff.map((d) => d.id)).toEqual(['a'])
    expect(plan.reduce).toBeNull()
    expect(plan.remaining).toBe(10000)
  })

  it('reduces one entry when nothing fits exactly', () => {
    // We owe 100 in one entry, Nuri owes us 50: our entry comes down to 50.
    const rows = [
      nuri({ id: 'ours', direction: 'we_owe', amount_cents: 10000, reason: 'flights' }),
      nuri({ id: 'his', direction: 'owed_to_us', amount_cents: 5000, reason: 'coffee' }),
    ]
    const plan = planSettlement(rows, 'nuri')!
    expect(plan.wipe.map((d) => d.id)).toEqual(['his'])
    expect(plan.payOff).toEqual([])
    expect(plan.reduce).toEqual({ debt: rows[0], by: 5000 })
    expect(plan.remaining).toBe(5000)
    expect(settledAgainst(plan)).toBe('"coffee"')
  })

  it('goes smallest-first and trims at most one entry', () => {
    // Larger side: 30, 40, 80. Absorb 100: 30 and 40 paid, 80 reduced by 30.
    const rows = [
      nuri({ id: 'x', direction: 'we_owe', amount_cents: 8000 }),
      nuri({ id: 'y', direction: 'we_owe', amount_cents: 3000 }),
      nuri({ id: 'z', direction: 'we_owe', amount_cents: 4000 }),
      nuri({ id: 'w', direction: 'owed_to_us', amount_cents: 10000 }),
    ]
    const plan = planSettlement(rows, 'nuri')!
    expect(plan.payOff.map((d) => d.id)).toEqual(['y', 'z'])
    expect(plan.reduce?.debt.id).toBe('x')
    expect(plan.reduce?.by).toBe(3000)
    expect(plan.remaining).toBe(5000)
  })

  it('wipes both lists when they are equal', () => {
    const rows = [
      nuri({ id: 'a', direction: 'we_owe', amount_cents: 5000 }),
      nuri({ id: 'b', direction: 'owed_to_us', amount_cents: 2000 }),
      nuri({ id: 'c', direction: 'owed_to_us', amount_cents: 3000 }),
    ]
    const plan = planSettlement(rows, 'nuri')!
    expect([...plan.wipe, ...plan.payOff].map((d) => d.id).sort()).toEqual(['a', 'b', 'c'])
    expect(plan.reduce).toBeNull()
    expect(plan.remaining).toBe(0)
  })

  it('works the other way round too', () => {
    // Nuri owes us more than we owe him: our side is wiped, his comes down.
    const rows = [
      nuri({ id: 'a', direction: 'we_owe', amount_cents: 2500 }),
      nuri({ id: 'b', direction: 'owed_to_us', amount_cents: 9000 }),
    ]
    const plan = planSettlement(rows, 'nuri')!
    expect(plan.smaller).toBe('we_owe')
    expect(plan.larger).toBe('owed_to_us')
    expect(plan.wipe.map((d) => d.id)).toEqual(['a'])
    expect(plan.reduce).toEqual({ debt: rows[1], by: 2500 })
    expect(plan.remaining).toBe(6500)
  })

  it('appends to notes without eating what was there', () => {
    expect(appendNote(null, 'x')).toBe('x')
    expect(appendNote('  ', 'x')).toBe('x')
    expect(appendNote('keep this', 'x')).toBe('keep this\nx')
  })
})

describe('paying down', () => {
  const nuri = (patch: Partial<Debt>) =>
    debt({ counterparty: 'Nuri', counterparty_key: 'nuri', direction: 'we_owe', ...patch })

  /** What the rows look like once a plan has been written, as the app would. */
  function apply(rows: Debt[], plan: NonNullable<ReturnType<typeof planPayment>>): Debt[] {
    const paid = new Set(plan.payOff.map((d) => d.id))
    return rows.map((d) =>
      paid.has(d.id)
        ? { ...d, is_paid: true, paid_at: 'x' }
        : plan.reduce?.debt.id === d.id
          ? { ...d, amount_cents: d.amount_cents - plan.reduce.by }
          : d,
    )
  }

  it('clears the smallest entry, then trims the next one', () => {
    // We owe Nuri 482 + 30 + 2 and send him 30: the 2 is paid off and the 30
    // comes down by the remaining 28. The 482 isn't touched.
    const rows = [
      nuri({ id: 'big', amount_cents: 48200 }),
      nuri({ id: 'mid', amount_cents: 3000 }),
      nuri({ id: 'small', amount_cents: 200 }),
    ]
    const plan = planPayment(rows, 'nuri', 'we_owe', 3000)!
    expect(plan.payOff.map((d) => d.id)).toEqual(['small'])
    expect(plan.reduce).toEqual({ debt: rows[1], by: 2800 })
    expect(plan.before).toBe(51400)
    expect(plan.remaining).toBe(48400)
    expect(plan.excess).toBe(0)
  })

  it('carries on with the same pattern on the next payment', () => {
    const rows = [
      nuri({ id: 'big', amount_cents: 48200 }),
      nuri({ id: 'mid', amount_cents: 3000 }),
      nuri({ id: 'small', amount_cents: 200 }),
    ]
    const afterFirst = apply(rows, planPayment(rows, 'nuri', 'we_owe', 3000)!)

    // The 30 is now the 2 that's left of it, so a 50 payment finishes it and
    // starts on the 482.
    const second = planPayment(afterFirst, 'nuri', 'we_owe', 5000)!
    expect(second.payOff.map((d) => d.id)).toEqual(['mid'])
    expect(second.reduce?.debt.id).toBe('big')
    expect(second.reduce?.by).toBe(4800)
    expect(second.remaining).toBe(43400)
  })

  it('pays an entry off rather than trimming it to zero', () => {
    // The database refuses a zero amount, so an exact fit has to be "paid".
    const rows = [nuri({ id: 'a', amount_cents: 1000 }), nuri({ id: 'b', amount_cents: 2500 })]
    const plan = planPayment(rows, 'nuri', 'we_owe', 1000)!
    expect(plan.payOff.map((d) => d.id)).toEqual(['a'])
    expect(plan.reduce).toBeNull()
  })

  it('pays everything off when the amount is the whole balance', () => {
    const rows = [nuri({ amount_cents: 1000 }), nuri({ amount_cents: 2500 })]
    const plan = planPayment(rows, 'nuri', 'we_owe', 3500)!
    expect(plan.payOff).toHaveLength(2)
    expect(plan.reduce).toBeNull()
    expect(plan.remaining).toBe(0)
  })

  it('reports an overpayment instead of quietly swallowing it', () => {
    const rows = [nuri({ amount_cents: 1000 })]
    const plan = planPayment(rows, 'nuri', 'we_owe', 1500)!
    expect(plan.amount).toBe(1000)
    expect(plan.excess).toBe(500)
  })

  it('only touches that person, in that direction, and only open entries', () => {
    const rows = [
      nuri({ id: 'mine', amount_cents: 2000 }),
      nuri({ id: 'theirs', direction: 'owed_to_us', amount_cents: 100 }),
      nuri({ id: 'done', amount_cents: 50, is_paid: true, paid_at: 'x' }),
      debt({ id: 'sam', counterparty: 'Sam', counterparty_key: 'sam', direction: 'we_owe', amount_cents: 100 }),
    ]
    const plan = planPayment(rows, 'nuri', 'we_owe', 500)!
    expect(plan.payOff).toEqual([])
    expect(plan.reduce?.debt.id).toBe('mine')
    expect(plan.before).toBe(2000)
  })

  it('picks the older of two equal entries, so both phones agree', () => {
    const rows = [nuri({ id: 'newer', amount_cents: 500 }), nuri({ id: 'older', amount_cents: 500 })]
    rows[1].created_at = '2025-01-01T00:00:00.000Z'
    expect(planPayment(rows, 'nuri', 'we_owe', 300)!.reduce?.debt.id).toBe('older')
  })

  it('has nothing to plan without an amount or a balance', () => {
    const rows = [nuri({ amount_cents: 1000 })]
    expect(planPayment(rows, 'nuri', 'we_owe', 0)).toBeNull()
    expect(planPayment(rows, 'nuri', 'owed_to_us', 500)).toBeNull()
    expect(planPayment(rows, 'sam', 'we_owe', 500)).toBeNull()
  })
})
