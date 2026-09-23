import { toast } from 'sonner'
import { useData } from '@/store/useData'
import { newId, nowIso } from '@/data/adapter'
import { fire } from '@/lib/haptics'
import { formatPrice } from '@/lib/money'
import {
  PAYMENT_MARK,
  SETTLED_MARK,
  appendNote,
  normaliseName,
  settledAgainst,
  type Allocation,
  type PaymentPlan,
  type SettlePlan,
} from './summary'
import type { Debt, DebtDirection } from '@/data/types'

/**
 * Writes for the Owe list.
 *
 * Same optimistic shape as Things' `dataActions`: apply locally, fire the
 * haptic, then commit — so a row appears under the finger rather than after a
 * round trip, and a failure puts the list back exactly as it was.
 */

function replaceRow(id: string, next: Debt | null): void {
  const rows = useData.getState().debts
  useData.setState({
    debts: next
      ? rows.some((d) => d.id === id)
        ? rows.map((d) => (d.id === id ? next : d))
        : [...rows, next]
      : rows.filter((d) => d.id !== id),
  })
}

export async function addDebt(input: {
  direction: DebtDirection
  counterparty: string
  amountCents: number
  reason: string | null
  profileId: string | null
}): Promise<string | null> {
  const name = input.counterparty.trim()
  if (!name || input.amountCents <= 0) return null

  const row: Debt = {
    id: newId(),
    direction: input.direction,
    counterparty: name,
    // Set client-side to match what the Postgres trigger will compute, so the
    // summary groups this row correctly during the window before it syncs.
    counterparty_key: normaliseName(name),
    amount_cents: input.amountCents,
    reason: input.reason?.trim() || null,
    notes: null,
    is_paid: false,
    paid_at: null,
    paid_by: null,
    created_by: input.profileId,
    updated_by: null,
    sort_order: Date.now(),
    created_at: nowIso(),
    updated_at: nowIso(),
  }

  fire('tap')
  useData.setState({ debts: [...useData.getState().debts, row] })

  try {
    await useData.getState().adapter.insert('debts', row)
    return row.id
  } catch (err) {
    replaceRow(row.id, null)
    fire('error')
    toast.error("Couldn't add that")
    console.error('[debts]', err)
    return null
  }
}

/**
 * Mark one entry settled.
 *
 * The timestamp is what moves it into history, and the database's
 * `paid_has_timestamp` CHECK refuses a paid row without one — so both fields
 * are always written together rather than `is_paid` alone.
 */
export async function markPaid(debt: Debt, profileId: string | null): Promise<void> {
  if (debt.is_paid) return
  const before = debt
  const patch = { is_paid: true, paid_at: nowIso(), paid_by: profileId, updated_by: profileId }

  replaceRow(debt.id, { ...debt, ...patch })

  try {
    await useData.getState().adapter.update('debts', debt.id, patch)
  } catch (err) {
    replaceRow(debt.id, before)
    fire('error')
    toast.error("Couldn't mark that paid")
    console.error('[debts]', err)
  }
}

/** Undo a settlement — the row goes back to the open list at its old place. */
export async function markUnpaid(debt: Debt, profileId: string | null): Promise<void> {
  if (!debt.is_paid) return
  const before = debt
  const patch = { is_paid: false, paid_at: null, paid_by: null, updated_by: profileId }

  fire('toggleOff')
  replaceRow(debt.id, { ...debt, ...patch })

  try {
    await useData.getState().adapter.update('debts', debt.id, patch)
  } catch (err) {
    replaceRow(debt.id, before)
    fire('error')
    toast.error("Couldn't undo that")
    console.error('[debts]', err)
  }
}

export async function updateDebt(
  debt: Debt,
  patch: Partial<Pick<Debt, 'counterparty' | 'amount_cents' | 'reason' | 'notes'>>,
  profileId: string | null,
): Promise<void> {
  const before = debt
  const full: Partial<Debt> = { ...patch, updated_by: profileId, updated_at: nowIso() }
  // Renaming has to move the grouping key with it, or an edited row keeps
  // totalling under the old spelling until the next full refetch.
  if (patch.counterparty !== undefined) {
    full.counterparty = patch.counterparty.trim()
    full.counterparty_key = normaliseName(patch.counterparty)
  }

  replaceRow(debt.id, { ...debt, ...full } as Debt)

  try {
    await useData.getState().adapter.update('debts', debt.id, full)
  } catch (err) {
    replaceRow(debt.id, before)
    fire('error')
    toast.error("Couldn't save that")
    console.error('[debts]', err)
  }
}

export async function removeDebt(debt: Debt): Promise<void> {
  const before = debt
  fire('delete')
  replaceRow(debt.id, null)

  try {
    await useData.getState().adapter.remove('debts', debt.id)
  } catch (err) {
    replaceRow(debt.id, before)
    fire('error')
    toast.error("Couldn't delete that")
    console.error('[debts]', err)
  }
}

/**
 * Carry out a settlement plan.
 *
 * Several rows change in one go, each with a line in its notes saying it was
 * the two lists cancelling out rather than money changing hands.
 */
export async function applySettlement(plan: SettlePlan, profileId: string | null): Promise<boolean> {
  const at = nowIso()
  const stamp = shortDate(at)
  const changes = allocationChanges(
    { payOff: [...plan.wipe, ...plan.payOff], reduce: plan.reduce },
    at,
    profileId,
    `Paid via ${SETTLED_MARK} with ${plan.name} · ${stamp}`,
    (by) =>
      `-${formatPrice(by)} via ${SETTLED_MARK} with ${plan.name}, for ${settledAgainst(plan)} · ${stamp}`,
  )
  return commitChanges(changes, at, {
    none: "Couldn't settle that",
    some: 'Settled part of it — check the lists',
  })
}

/**
 * Record one payment to or from a person, smallest entries first.
 *
 * Written exactly like a settlement — cleared entries marked paid, at most
 * one trimmed — with a note on each saying which payment did it, so an entry
 * that reads $2 still shows it started life as $30.
 */
export async function applyPayment(plan: PaymentPlan, profileId: string | null): Promise<boolean> {
  const at = nowIso()
  const stamp = shortDate(at)
  const whom = plan.direction === 'we_owe' ? `to ${plan.name}` : `from ${plan.name}`
  const payment = `${formatPrice(plan.amount)} ${whom}`
  const changes = allocationChanges(
    plan,
    at,
    profileId,
    `Cleared · ${PAYMENT_MARK} ${payment} · ${stamp}`,
    (by) => `-${formatPrice(by)} · ${PAYMENT_MARK} ${payment} · ${stamp}`,
  )
  return commitChanges(changes, at, {
    none: "Couldn't record that payment",
    some: 'Recorded part of it — check the list',
  })
}

type Change = { before: Debt; patch: Partial<Debt> }

const shortDate = (iso: string) =>
  new Date(iso).toLocaleDateString(undefined, { day: 'numeric', month: 'short' })

/**
 * The row writes for an allocation. Paid rows carry `is_paid` and `paid_at`
 * together, so the database's `paid_has_timestamp` check accepts them.
 */
function allocationChanges(
  allocation: Allocation,
  at: string,
  profileId: string | null,
  paidLine: string,
  reducedLine: (by: number) => string,
): Change[] {
  const changes: Change[] = allocation.payOff.map((debt) => ({
    before: debt,
    patch: {
      is_paid: true,
      paid_at: at,
      paid_by: profileId,
      updated_by: profileId,
      notes: appendNote(debt.notes, paidLine),
    },
  }))
  if (allocation.reduce) {
    const { debt, by } = allocation.reduce
    changes.push({
      before: debt,
      patch: {
        amount_cents: debt.amount_cents - by,
        updated_by: profileId,
        notes: appendNote(debt.notes, reducedLine(by)),
      },
    })
  }
  return changes
}

/**
 * Applied optimistically as a set, committed one row at a time. If a write
 * fails part way, only the rows not yet committed are put back: the ones
 * already written are real and realtime will confirm them, and undoing them
 * locally would show a state the database no longer agrees with.
 */
async function commitChanges(
  changes: Change[],
  at: string,
  failure: { none: string; some: string },
): Promise<boolean> {
  fire('zipperDone')
  for (const c of changes) replaceRow(c.before.id, { ...c.before, ...c.patch, updated_at: at })

  const adapter = useData.getState().adapter
  for (let i = 0; i < changes.length; i++) {
    try {
      await adapter.update('debts', changes[i].before.id, changes[i].patch)
    } catch (err) {
      for (const c of changes.slice(i)) replaceRow(c.before.id, c.before)
      fire('error')
      toast.error(i === 0 ? failure.none : failure.some)
      console.error('[debts]', err)
      return false
    }
  }
  return true
}
