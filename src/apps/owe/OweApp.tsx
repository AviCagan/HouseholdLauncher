import { useMemo, useState } from 'react'
import { AnimatePresence, motion } from 'motion/react'
import { Icon } from '@/components/primitives/Icon'
import { Section, EmptyState } from '@/components/shell/Screen'
import { ZipperSwipe } from '@/components/primitives/ZipperSwipe'
import { useData } from '@/store/useData'
import { useProfile } from '@/store/useProfile'
import { formatPrice } from '@/lib/money'
import { fire } from '@/lib/haptics'
import { markPaid, markUnpaid, removeDebt } from './actions'
import { AddDebtBar } from './AddDebtBar'
import { DebtEditSheet } from './DebtEditSheet'
import { openDebts, outstandingTotal, paidDebts, summarise } from './summary'
import type { Debt, DebtDirection } from '@/data/types'

/**
 * Owe & Owed.
 *
 * Two lists of the same shape — money coming in, money going out — with the
 * per-person roll-up beside them, because a name appearing four times is one
 * debt and adding it up by hand is the thing a spreadsheet already failed at.
 *
 * Settling is a pull, not a tap: see ZipperSwipe. Marking a debt paid by
 * accident is not a mistake you can quietly undo, so the gesture is
 * deliberately harder than the ones that tick off a chore.
 */
export function OweApp() {
  const [direction, setDirection] = useState<DebtDirection>('owed_to_us')
  const [editing, setEditing] = useState<Debt | null>(null)
  const debts = useData((s) => s.debts)
  const profileId = useProfile((s) => s.profileId)

  const open = useMemo(() => openDebts(debts, direction), [debts, direction])
  const paid = useMemo(() => paidDebts(debts, direction), [debts, direction])
  const people = useMemo(() => summarise(debts, direction), [debts, direction])
  const total = outstandingTotal(debts, direction)

  const inbound = direction === 'owed_to_us'

  return (
    <div className="flex h-full flex-col">
      <header className="shrink-0 px-4 pb-2 pt-3">
        <Switcher direction={direction} onChange={setDirection} debts={debts} />
      </header>

      <div className="scroll-y min-h-0 flex-1 px-3 pb-[190px]">
        <SummaryPanel
          people={people}
          total={total}
          label={inbound ? 'Owed to us' : 'We owe'}
          tone={inbound ? 'var(--ok)' : 'var(--warn)'}
        />

        {open.length === 0 && paid.length === 0 ? (
          <EmptyState
            icon={<Icon name="wallet" size={34} />}
            title={inbound ? 'Nobody owes you' : 'You owe nobody'}
            hint={
              inbound
                ? 'Add someone below when you cover something for them.'
                : 'Add someone below when they cover something for you.'
            }
          />
        ) : (
          <>
            <div className="mt-3 flex flex-col gap-2">
              <AnimatePresence initial={false}>
                {open.map((debt) => (
                  <DebtRow
                    key={debt.id}
                    debt={debt}
                    tone={inbound ? 'var(--ok)' : 'var(--warn)'}
                    onPaid={() => void markPaid(debt, profileId)}
                    onEdit={() => {
                      fire('tap')
                      setEditing(debt)
                    }}
                  />
                ))}
              </AnimatePresence>
            </div>

            <Section
              label="History"
              count={paid.length}
              icon={
                <span style={{ color: 'var(--text-faint)' }}>
                  <Icon name="history" size={14} />
                </span>
              }
            >
              {paid.map((debt) => (
                <PaidRow
                  key={debt.id}
                  debt={debt}
                  onUndo={() => void markUnpaid(debt, profileId)}
                  onDelete={() => void removeDebt(debt)}
                />
              ))}
            </Section>
          </>
        )}
      </div>

      <AddDebtBar direction={direction} />
      <DebtEditSheet debt={editing} onClose={() => setEditing(null)} />
    </div>
  )
}

/** The two lists, and what each is currently worth. */
function Switcher({
  direction,
  onChange,
  debts,
}: {
  direction: DebtDirection
  onChange: (d: DebtDirection) => void
  debts: Debt[]
}) {
  const options: { id: DebtDirection; label: string; tone: string }[] = [
    { id: 'owed_to_us', label: 'Owed to us', tone: 'var(--ok)' },
    { id: 'we_owe', label: 'We owe', tone: 'var(--warn)' },
  ]

  return (
    <div
      className="relative flex gap-1 rounded-2xl p-1"
      style={{ background: 'var(--surface-2)', border: '1px solid var(--border)' }}
    >
      {options.map((option) => {
        const active = option.id === direction
        const total = outstandingTotal(debts, option.id)
        return (
          <button
            key={option.id}
            onClick={() => {
              if (active) return
              fire('snap')
              onChange(option.id)
            }}
            className="relative flex-1 rounded-xl px-3 py-2.5"
          >
            {active && (
              <motion.span
                // Shared layoutId so the pill slides between the two options
                // instead of blinking out and in.
                layoutId="owe-switcher"
                className="absolute inset-0 rounded-xl"
                style={{ background: 'var(--surface)', border: '1px solid var(--border)' }}
                transition={{ type: 'spring', stiffness: 460, damping: 36 }}
              />
            )}
            <span className="relative block text-[13px] font-semibold">{option.label}</span>
            <span
              className="relative mt-0.5 block text-[15px] font-bold tabular-nums"
              style={{ color: total > 0 ? option.tone : 'var(--text-faint)' }}
            >
              {formatPrice(total) || '$0'}
            </span>
          </button>
        )
      })}
    </div>
  )
}

/**
 * Per-person roll-up.
 *
 * Horizontally scrolling cards rather than a table: on a phone a table of
 * names and amounts either truncates the names or wraps into something you
 * have to read twice, and this list is glanced at rather than studied.
 */
function SummaryPanel({
  people,
  total,
  label,
  tone,
}: {
  people: ReturnType<typeof summarise>
  total: number
  label: string
  tone: string
}) {
  if (people.length === 0) return null

  return (
    <div className="pt-2">
      <div className="flex items-baseline justify-between px-1 pb-2">
        <span
          className="text-[11px] font-semibold uppercase tracking-wide"
          style={{ color: 'var(--text-faint)' }}
        >
          {label} · {people.length} {people.length === 1 ? 'person' : 'people'}
        </span>
        <span className="text-[15px] font-bold tabular-nums" style={{ color: tone }}>
          {formatPrice(total)}
        </span>
      </div>

      <div className="scroll-x -mx-3 flex gap-2 px-3 pb-1">
        {people.map((person) => (
          <div
            key={person.key}
            className="min-w-[124px] shrink-0 rounded-2xl px-3 py-2.5"
            style={{ background: 'var(--surface)', border: '1px solid var(--border)' }}
          >
            <span className="block truncate text-[13px] font-semibold">{person.name}</span>
            <span className="block text-[18px] font-bold tabular-nums" style={{ color: tone }}>
              {formatPrice(person.total)}
            </span>
            {/* Only shown when it's actually a roll-up — "1 entry" under every
                single-entry card is noise that makes the useful ones harder to
                spot. */}
            {person.count > 1 && (
              <span className="block text-[11px]" style={{ color: 'var(--text-faint)' }}>
                {person.count} entries
              </span>
            )}
          </div>
        ))}
      </div>
    </div>
  )
}

function DebtRow({
  debt,
  tone,
  onPaid,
  onEdit,
}: {
  debt: Debt
  tone: string
  onPaid: () => void
  onEdit: () => void
}) {
  return (
    <motion.div
      layout
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, x: 40, height: 0, marginBottom: -8 }}
      transition={{ duration: 0.22 }}
      className="flex items-center gap-3 rounded-2xl p-3"
      style={{ background: 'var(--surface)', border: '1px solid var(--border)' }}
    >
      <button onClick={onEdit} className="min-w-0 flex-1 text-left">
        <span className="flex items-baseline gap-2">
          <span className="truncate text-[15px] font-semibold">{debt.counterparty}</span>
          <span className="shrink-0 text-[16px] font-bold tabular-nums" style={{ color: tone }}>
            {formatPrice(debt.amount_cents)}
          </span>
        </span>
        {debt.reason && (
          <span
            className="mt-0.5 block truncate text-[12.5px]"
            style={{ color: 'var(--text-dim)' }}
          >
            {debt.reason}
          </span>
        )}
      </button>

      <ZipperSwipe onCommit={onPaid} label="Paid" color={tone} />
    </motion.div>
  )
}

function PaidRow({
  debt,
  onUndo,
  onDelete,
}: {
  debt: Debt
  onUndo: () => void
  onDelete: () => void
}) {
  return (
    <div
      className="flex items-center gap-3 rounded-2xl p-3"
      style={{ background: 'var(--surface-2)', border: '1px solid var(--border)' }}
    >
      <span className="shrink-0" style={{ color: 'var(--ok)' }}>
        <Icon name="checkCircle" size={18} />
      </span>

      <span className="min-w-0 flex-1">
        <span className="flex items-baseline gap-2">
          <span className="truncate text-[14px] font-medium" style={{ color: 'var(--text-dim)' }}>
            {debt.counterparty}
          </span>
          <span
            className="shrink-0 text-[14px] font-semibold tabular-nums"
            style={{ color: 'var(--text-dim)' }}
          >
            {formatPrice(debt.amount_cents)}
          </span>
        </span>
        <span className="mt-0.5 block truncate text-[11.5px]" style={{ color: 'var(--text-faint)' }}>
          {debt.reason ? `${debt.reason} · ` : ''}
          {paidLabel(debt.paid_at)}
        </span>
      </span>

      <button
        onClick={onUndo}
        aria-label="Move back to the open list"
        className="shrink-0 rounded-full px-2.5 py-1.5 text-[11px] font-semibold"
        style={{ background: 'var(--surface-3)', color: 'var(--text-dim)' }}
      >
        Undo
      </button>
      <button
        onClick={onDelete}
        aria-label="Delete"
        className="shrink-0 p-1"
        style={{ color: 'var(--text-faint)' }}
      >
        <Icon name="trash" size={15} />
      </button>
    </div>
  )
}

/** "Paid 3 Feb, 2:15 pm" — the date and time settling was recorded. */
function paidLabel(iso: string | null): string {
  if (!iso) return 'Paid'
  const when = new Date(iso)
  return `Paid ${when.toLocaleDateString(undefined, {
    day: 'numeric',
    month: 'short',
  })}, ${when.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })}`
}
