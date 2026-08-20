import type { Debt, DebtDirection } from '@/data/types'

/**
 * Rolling up the two lists per person.
 *
 * The point of the summary panel is that a name appearing four times is one
 * debt, not four: a Google Sheet with "Sam — $20 — dinner" three rows apart
 * tells you nothing about what Sam actually owes without adding it up by hand.
 *
 * Grouping is on `counterparty_key`, which a Postgres trigger maintains as the
 * lower-cased, whitespace-collapsed form of the name. Doing the same fold here
 * rather than trusting the stored value matters for one specific case: a row
 * written optimistically on this device has not been near the database yet, so
 * its key is whatever the client put there — and if the two disagree, a debt
 * splits into two entries the moment it is added and silently merges again on
 * the next sync.
 */

export const normaliseName = (name: string): string =>
  name.trim().replace(/\s+/g, ' ').toLowerCase()

export interface PersonTotal {
  /** The key rows are grouped on. */
  key: string
  /** The nicest spelling seen — see pickDisplayName. */
  name: string
  /** Sum of unpaid entries, in cents. */
  total: number
  /** How many unpaid entries make it up. */
  count: number
  /** Newest unpaid entry, for ordering by recency. */
  latest: string
}

/**
 * Which spelling of a name to show when the rows disagree.
 *
 * "sam" and "Sam" group together, and the panel has to print one of them.
 * Preferring the capitalised spelling means a hurried lower-case entry doesn't
 * rename someone who was entered properly the first time; the newest row wins
 * only among spellings of equal quality, so a genuine correction still takes
 * effect.
 */
function pickDisplayName(rows: Debt[]): string {
  let best = rows[0].counterparty.trim()
  let bestScore = -1
  for (const row of rows) {
    const name = row.counterparty.trim()
    const score = /^[a-z]/.test(name) ? 0 : 1
    if (score > bestScore) {
      best = name
      bestScore = score
    }
  }
  return best
}

/**
 * Unpaid totals per person for one direction, largest first.
 *
 * Paid rows are excluded outright rather than netted off: they have moved to
 * history, and "who owes us money" should not quietly shrink because someone
 * settled up last month.
 */
export function summarise(debts: Debt[], direction: DebtDirection): PersonTotal[] {
  const groups = new Map<string, Debt[]>()

  for (const debt of debts) {
    if (debt.direction !== direction || debt.is_paid) continue
    const key = normaliseName(debt.counterparty)
    const bucket = groups.get(key)
    if (bucket) bucket.push(debt)
    else groups.set(key, [debt])
  }

  return [...groups.entries()]
    .map(([key, rows]) => ({
      key,
      name: pickDisplayName(rows),
      total: rows.reduce((sum, r) => sum + r.amount_cents, 0),
      count: rows.length,
      latest: rows.reduce((newest, r) => (r.created_at > newest ? r.created_at : newest), ''),
    }))
    .sort((a, b) => b.total - a.total || a.name.localeCompare(b.name))
}

/** Everything still outstanding in one direction. */
export const outstandingTotal = (debts: Debt[], direction: DebtDirection): number =>
  debts.reduce(
    (sum, d) => (d.direction === direction && !d.is_paid ? sum + d.amount_cents : sum),
    0,
  )

/** Open entries, newest first. */
export const openDebts = (debts: Debt[], direction: DebtDirection): Debt[] =>
  debts
    .filter((d) => d.direction === direction && !d.is_paid)
    .sort((a, b) => b.sort_order - a.sort_order)

/** Settled entries, most recently paid first. */
export const paidDebts = (debts: Debt[], direction: DebtDirection): Debt[] =>
  debts
    .filter((d) => d.direction === direction && d.is_paid)
    .sort((a, b) => (b.paid_at ?? '').localeCompare(a.paid_at ?? ''))

/**
 * Names already on either list, for the add form's autocomplete.
 *
 * Deliberately spans both directions and includes settled rows: the whole
 * point is to reuse the exact spelling used last time so the totals group, and
 * the person you paid back in March is exactly the person likely to come up
 * again.
 */
export function knownNames(debts: Debt[]): string[] {
  const seen = new Map<string, { name: string; at: string }>()
  for (const debt of debts) {
    const key = normaliseName(debt.counterparty)
    const existing = seen.get(key)
    if (!existing || debt.created_at > existing.at) {
      seen.set(key, { name: debt.counterparty.trim(), at: debt.created_at })
    }
  }
  return [...seen.values()].sort((a, b) => b.at.localeCompare(a.at)).map((v) => v.name)
}
