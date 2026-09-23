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

// --- Settling balances ---------------------------------------------------------

/**
 * The marker written into the notes of every row a settlement touched, so the
 * history can show which payments were real money and which were the two
 * lists cancelling each other out.
 */
export const SETTLED_MARK = 'settled balances'

export interface SettleCandidate {
  key: string
  name: string
  owedToUs: number
  weOwe: number
}

/** People who are open on both lists at once. */
export function settleCandidates(debts: Debt[]): SettleCandidate[] {
  const inbound = new Map(summarise(debts, 'owed_to_us').map((p) => [p.key, p]))
  const outbound = summarise(debts, 'we_owe')
  const out: SettleCandidate[] = []
  for (const o of outbound) {
    const i = inbound.get(o.key)
    if (!i) continue
    out.push({ key: o.key, name: i.name, owedToUs: i.total, weOwe: o.total })
  }
  return out.sort((a, b) => Math.min(b.owedToUs, b.weOwe) - Math.min(a.owedToUs, a.weOwe))
}

export interface SettlePlan {
  key: string
  name: string
  /** The list wiped out entirely. */
  smaller: DebtDirection
  larger: DebtDirection
  /** What moves across: the smaller list's whole balance, in cents. */
  amount: number
  /** Every open entry on the smaller list — all marked paid. */
  wipe: Debt[]
  /** Entries on the larger list marked paid in full, smallest first. */
  payOff: Debt[]
  /** The one larger-list entry trimmed rather than paid, and by how much. */
  reduce: { debt: Debt; by: number } | null
  /** What the larger list still shows for this person afterwards. */
  remaining: number
}

/**
 * Work out how two lists cancel for one person.
 *
 * The smaller balance is paid off entirely. The larger absorbs that amount
 * smallest-entry-first: whole entries are marked paid while they fit, and the
 * first one that does not fit is reduced by whatever is left. At most one
 * entry is ever partially changed, so the history reads as "these were paid,
 * this one came down" rather than as a spread of odd fractions.
 *
 * Smallest-first is a choice, and the reason is legibility: if you owe Nuri
 * $6 and $94 and he owes you $100, the two small entries closing is the
 * story a person expects, and "the $6 was reduced to $0 and the $94 to $0"
 * is the same arithmetic told worse.
 */
export function planSettlement(debts: Debt[], key: string): SettlePlan | null {
  const open = debts.filter((d) => !d.is_paid && normaliseName(d.counterparty) === key)
  const inbound = open.filter((d) => d.direction === 'owed_to_us')
  const outbound = open.filter((d) => d.direction === 'we_owe')
  if (inbound.length === 0 || outbound.length === 0) return null

  const sum = (rows: Debt[]) => rows.reduce((t, d) => t + d.amount_cents, 0)
  const inTotal = sum(inbound)
  const outTotal = sum(outbound)

  // Equal balances wipe both; the tie-break only decides which list is
  // labelled "smaller" and makes no difference to what gets written.
  const smallerIsInbound = inTotal <= outTotal
  const smaller: DebtDirection = smallerIsInbound ? 'owed_to_us' : 'we_owe'
  const larger: DebtDirection = smallerIsInbound ? 'we_owe' : 'owed_to_us'
  const wipe = smallerIsInbound ? inbound : outbound
  const amount = smallerIsInbound ? inTotal : outTotal

  const { payOff, reduce } = allocateSmallestFirst(smallerIsInbound ? outbound : inbound, amount)

  return {
    key,
    name: pickDisplayName(open),
    smaller,
    larger,
    amount,
    wipe,
    payOff,
    reduce,
    remaining: Math.max(inTotal, outTotal) - amount,
  }
}

export interface Allocation {
  /** Entries the amount covers in full — marked paid. */
  payOff: Debt[]
  /** The first entry it doesn't cover, trimmed by what was left. */
  reduce: { debt: Debt; by: number } | null
}

/**
 * Spend an amount across entries, smallest first.
 *
 * Shared by settling and by paying down, so both tell the same story: whole
 * entries close while they fit, then at most one is trimmed. The trimmed
 * entry is now smaller, so the next payment reaches it first — repeated
 * payments finish off the small debts before they start on the big one.
 *
 * An entry is only trimmed when it is bigger than what's left, so it never
 * reaches zero; an exact fit is paid instead. The database refuses a zero
 * amount, so this is load-bearing rather than tidy.
 *
 * Ties go to the older entry, so both phones pick the same one.
 */
export function allocateSmallestFirst(rows: Debt[], amount: number): Allocation {
  const ascending = [...rows].sort(
    (a, b) => a.amount_cents - b.amount_cents || a.created_at.localeCompare(b.created_at),
  )

  const payOff: Debt[] = []
  let reduce: Allocation['reduce'] = null
  let left = amount
  for (const debt of ascending) {
    if (left <= 0) break
    if (debt.amount_cents <= left) {
      payOff.push(debt)
      left -= debt.amount_cents
    } else {
      reduce = { debt, by: left }
      left = 0
    }
  }
  return { payOff, reduce }
}

// --- Paying down ---------------------------------------------------------------

/** Written into the notes of every entry a payment touched. */
export const PAYMENT_MARK = 'paid down'

export interface PaymentPlan extends Allocation {
  key: string
  name: string
  direction: DebtDirection
  /** What gets recorded, in cents — never more than the balance. */
  amount: number
  /** How far the typed amount went over the balance. The sheet refuses it. */
  excess: number
  /** The person's balance in this direction, before and after. */
  before: number
  remaining: number
}

/**
 * One payment against a person's balance in one direction.
 *
 * Null when there's nothing open or no amount yet. An amount over the
 * balance is reported as `excess` rather than quietly capped: money that
 * went nowhere in the books is a typo to point out, not something to absorb.
 */
export function planPayment(
  debts: Debt[],
  key: string,
  direction: DebtDirection,
  amountCents: number,
): PaymentPlan | null {
  const open = debts.filter(
    (d) => d.direction === direction && !d.is_paid && normaliseName(d.counterparty) === key,
  )
  if (open.length === 0 || amountCents <= 0) return null

  const before = open.reduce((t, d) => t + d.amount_cents, 0)
  const amount = Math.min(amountCents, before)

  return {
    key,
    name: pickDisplayName(open),
    direction,
    amount,
    excess: amountCents - amount,
    before,
    remaining: before - amount,
    ...allocateSmallestFirst(open, amount),
  }
}

/** What the entries on the wiped side were for, for the reduced row's note. */
export function settledAgainst(plan: SettlePlan): string {
  const reasons = plan.wipe.map((d) => (d.reason ? `"${d.reason}"` : null)).filter(Boolean)
  if (reasons.length === 0) return `${plan.wipe.length} ${plan.wipe.length === 1 ? 'entry' : 'entries'}`
  return reasons.join(', ')
}

/** Append a line to a notes field that may or may not already have text. */
export const appendNote = (notes: string | null, line: string): string =>
  notes && notes.trim() ? `${notes.trimEnd()}\n${line}` : line
