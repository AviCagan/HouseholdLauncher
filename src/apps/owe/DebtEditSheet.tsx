import { useEffect, useState } from 'react'
import { Sheet } from '@/components/primitives/Sheet'
import { Icon } from '@/components/primitives/Icon'
import { useProfile } from '@/store/useProfile'
import { useData } from '@/store/useData'
import { parsePrice, priceToInput } from '@/lib/money'
import { fire } from '@/lib/haptics'
import { removeDebt, updateDebt } from './actions'
import type { Debt } from '@/data/types'

/** Edit or delete one entry. Opened by tapping the body of a row. */
export function DebtEditSheet({ debt, onClose }: { debt: Debt | null; onClose: () => void }) {
  const profileId = useProfile((s) => s.profileId)
  const profiles = useData((s) => s.profiles)
  const [name, setName] = useState('')
  const [amount, setAmount] = useState('')
  const [reason, setReason] = useState('')
  const [notes, setNotes] = useState('')
  const [confirmDelete, setConfirmDelete] = useState(false)

  /*
    Reloaded from the row every time the sheet opens.

    Keyed on `debt?.id` rather than `debt`, deliberately: the row object is
    replaced on every realtime echo of an unrelated field, and depending on it
    would blow away half-typed edits the moment the other phone touched
    anything.
  */
  useEffect(() => {
    if (!debt) return
    setName(debt.counterparty)
    setAmount(priceToInput(debt.amount_cents))
    setReason(debt.reason ?? '')
    setNotes(debt.notes ?? '')
    setConfirmDelete(false)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [debt?.id])

  if (!debt) return null

  const cents = parsePrice(amount)
  const valid = name.trim().length > 0 && cents !== null && cents > 0
  const creator = profiles.find((p) => p.id === debt.created_by)

  async function save() {
    if (!debt || !valid || cents === null) return
    fire('success')
    await updateDebt(
      debt,
      {
        counterparty: name,
        amount_cents: cents,
        reason: reason.trim() || null,
        notes: notes.trim() || null,
      },
      profileId,
    )
    onClose()
  }

  return (
    <Sheet open onClose={onClose} title="Edit entry">
      <div className="flex flex-col gap-3 pb-4">
        <Field label="Person">
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            autoCapitalize="words"
            className="w-full bg-transparent text-[16px] outline-none"
          />
        </Field>

        <Field label="Amount">
          <div className="flex items-center gap-1">
            <span className="text-[16px]" style={{ color: 'var(--text-faint)' }}>
              $
            </span>
            <input
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              inputMode="decimal"
              className="w-full bg-transparent text-[16px] font-semibold tabular-nums outline-none"
            />
          </div>
        </Field>

        <Field label="What for">
          <input
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="Optional"
            className="w-full bg-transparent text-[16px] outline-none placeholder:opacity-35"
          />
        </Field>

        <Field label="Notes">
          <textarea
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            rows={2}
            placeholder="Optional"
            className="w-full resize-none bg-transparent text-[15px] outline-none placeholder:opacity-35"
          />
        </Field>

        {creator && (
          <p className="px-1 text-[12px]" style={{ color: 'var(--text-faint)' }}>
            Added by {creator.display_name} on{' '}
            {new Date(debt.created_at).toLocaleDateString(undefined, {
              day: 'numeric',
              month: 'short',
              year: 'numeric',
            })}
          </p>
        )}

        <button
          onClick={() => void save()}
          disabled={!valid}
          className="mt-1 w-full rounded-2xl py-3.5 text-[15px] font-semibold text-white disabled:opacity-35"
          style={{ background: 'var(--accent)' }}
        >
          Save
        </button>

        {/*
          Two taps to delete, with the second one labelled with what it will
          actually do. A single destructive button next to Save is a mis-tap
          away from erasing a record of money owed.
        */}
        <button
          onClick={() => {
            if (!confirmDelete) {
              fire('warning')
              setConfirmDelete(true)
              return
            }
            void removeDebt(debt)
            onClose()
          }}
          className="flex w-full items-center justify-center gap-2 rounded-2xl py-3 text-[14px] font-semibold"
          style={{
            background: confirmDelete ? 'var(--danger)' : 'transparent',
            color: confirmDelete ? '#fff' : 'var(--danger)',
          }}
        >
          <Icon name="trash" size={15} />
          {confirmDelete ? 'Tap again to delete' : 'Delete'}
        </button>
      </div>
    </Sheet>
  )
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label
      className="block rounded-2xl px-3.5 py-2.5"
      style={{ background: 'var(--surface-2)', border: '1px solid var(--border)' }}
    >
      <span
        className="mb-0.5 block text-[11px] font-semibold uppercase tracking-wide"
        style={{ color: 'var(--text-faint)' }}
      >
        {label}
      </span>
      {children}
    </label>
  )
}
