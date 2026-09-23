import { useEffect, useMemo, useState } from 'react'
import { motion } from 'motion/react'
import { toast } from 'sonner'
import { Sheet } from '@/components/primitives/Sheet'
import { useData } from '@/store/useData'
import { useProfile } from '@/store/useProfile'
import { formatPrice, parsePrice, priceToInput } from '@/lib/money'
import { fire } from '@/lib/haptics'
import { applyPayment } from './actions'
import { normaliseName, planPayment } from './summary'
import type { DebtDirection } from '@/data/types'

export interface PayTarget {
  key: string
  direction: DebtDirection
}

/**
 * "I sent Nuri $30" — knock an amount off someone's whole balance.
 *
 * The smallest entries go first, so small debts disappear and the big one
 * comes down a payment at a time. The plan is recomputed from the live list
 * on every keystroke, so what's previewed is exactly what gets written, even
 * if the other phone changed something while this was open.
 */
export function PaySheet({ target, onClose }: { target: PayTarget | null; onClose: () => void }) {
  const debts = useData((s) => s.debts)
  const profileId = useProfile((s) => s.profileId)
  const [amount, setAmount] = useState('')
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    setAmount('')
  }, [target?.key, target?.direction])

  const open = useMemo(
    () =>
      target
        ? debts.filter(
            (d) =>
              d.direction === target.direction &&
              !d.is_paid &&
              normaliseName(d.counterparty) === target.key,
          )
        : [],
    [debts, target],
  )

  // Everything paid from elsewhere while this was open: nothing left to do.
  useEffect(() => {
    if (target && open.length === 0 && !busy) onClose()
  }, [target, open.length, busy, onClose])

  if (!target || open.length === 0) return null

  const balance = open.reduce((t, d) => t + d.amount_cents, 0)
  const cents = parsePrice(amount) ?? 0
  const plan = planPayment(debts, target.key, target.direction, cents)
  const name = plan?.name ?? open[0].counterparty.trim()
  const outbound = target.direction === 'we_owe'
  const tone = outbound ? 'var(--warn)' : 'var(--ok)'
  const canPay = plan !== null && plan.excess === 0 && !busy

  const owesLine = outbound ? `You owe ${name}` : `${name} owes you`
  const after = !plan
    ? null
    : plan.remaining === 0
      ? 'All paid up'
      : outbound
        ? `You'll still owe ${formatPrice(plan.remaining)}`
        : `${name} will still owe ${formatPrice(plan.remaining)}`

  async function confirm() {
    if (!plan || !canPay) return
    setBusy(true)
    const ok = await applyPayment(plan, profileId)
    setBusy(false)
    if (!ok) return
    toast.success(
      plan.remaining === 0
        ? `All paid up with ${name}`
        : `${formatPrice(plan.amount)} recorded · ${formatPrice(plan.remaining)} left`,
    )
    onClose()
  }

  return (
    <Sheet open onClose={onClose} title={outbound ? `Pay ${name}` : `${name} paid you`}>
      <div className="flex flex-col gap-4 pb-6">
        <div
          className="flex items-baseline justify-between rounded-2xl px-4 py-3"
          style={{ background: 'var(--surface-2)', border: '1px solid var(--border)' }}
        >
          <span className="text-[13px]" style={{ color: 'var(--text-dim)' }}>
            {owesLine} · {open.length} {open.length === 1 ? 'entry' : 'entries'}
          </span>
          <span className="text-[18px] font-bold tabular-nums" style={{ color: tone }}>
            {formatPrice(balance)}
          </span>
        </div>

        <label
          className="block rounded-2xl px-3.5 py-2.5"
          style={{ background: 'var(--surface-2)', border: '1px solid var(--border)' }}
        >
          <span
            className="mb-0.5 block text-[11px] font-semibold uppercase tracking-wide"
            style={{ color: 'var(--text-faint)' }}
          >
            {outbound ? 'How much did you send?' : 'How much did they send?'}
          </span>
          <div className="flex items-center gap-1">
            <span className="text-[22px]" style={{ color: 'var(--text-faint)' }}>
              $
            </span>
            <input
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              inputMode="decimal"
              autoFocus
              placeholder="0"
              className="w-full bg-transparent text-[22px] font-bold tabular-nums outline-none placeholder:opacity-35"
            />
            <button
              onClick={(e) => {
                e.preventDefault()
                fire('snap')
                setAmount(priceToInput(balance))
              }}
              className="shrink-0 rounded-full px-3 py-1.5 text-[12px] font-semibold"
              style={{ background: 'var(--surface-3)', color: 'var(--text-dim)' }}
            >
              All {formatPrice(balance)}
            </button>
          </div>
        </label>

        {plan && plan.excess > 0 && (
          <p className="px-1 text-[12.5px] leading-snug" style={{ color: 'var(--danger)' }}>
            That's {formatPrice(plan.excess)} more than the whole {formatPrice(balance)}. Tap All to
            pay it off, or add the extra as its own entry.
          </p>
        )}

        {plan && plan.excess === 0 && (
          <>
            <motion.div
              initial={{ opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              className="rounded-2xl px-4 py-3 text-center"
              style={{ background: 'var(--accent-soft)', border: '1px solid var(--border)' }}
            >
              <span
                className="block text-[11px] font-semibold uppercase tracking-wide"
                style={{ color: 'var(--text-faint)' }}
              >
                After
              </span>
              <span className="block text-[20px] font-bold">{after}</span>
            </motion.div>

            <div className="flex flex-col gap-1.5">
              {plan.payOff.length > 0 && <Label>Cleared</Label>}
              {plan.payOff.map((d) => (
                <Row key={d.id} tone={tone}>
                  <span className="min-w-0 flex-1 truncate">{d.reason || 'No reason given'}</span>
                  <span
                    className="shrink-0 tabular-nums line-through"
                    style={{ color: 'var(--text-faint)' }}
                  >
                    {formatPrice(d.amount_cents)}
                  </span>
                </Row>
              ))}

              {plan.reduce && (
                <>
                  <Label>Reduced</Label>
                  <Row tone={tone}>
                    <span className="min-w-0 flex-1 truncate">
                      {plan.reduce.debt.reason || 'No reason given'}
                    </span>
                    <span className="shrink-0 tabular-nums">
                      <span style={{ color: 'var(--text-faint)', textDecoration: 'line-through' }}>
                        {formatPrice(plan.reduce.debt.amount_cents)}
                      </span>{' '}
                      {formatPrice(plan.reduce.debt.amount_cents - plan.reduce.by)}
                    </span>
                  </Row>
                </>
              )}
            </div>
          </>
        )}

        <p className="px-1 text-[12px] leading-snug" style={{ color: 'var(--text-faint)' }}>
          The smallest entries are paid first, so small debts clear and the big one comes down over
          time. Each entry gets a note saying which payment touched it.
        </p>

        <div className="flex flex-col gap-2">
          <motion.button
            whileTap={{ scale: 0.97 }}
            onClick={() => void confirm()}
            disabled={!canPay}
            className="w-full rounded-2xl py-3.5 text-[15px] font-semibold text-white disabled:opacity-35"
            style={{ background: 'var(--accent)' }}
          >
            {busy
              ? 'Recording…'
              : plan && plan.excess === 0
                ? `Record ${formatPrice(plan.amount)} payment`
                : 'Record payment'}
          </motion.button>
          <button
            onClick={() => {
              fire('tap')
              onClose()
            }}
            className="w-full rounded-2xl py-3 text-[14px] font-semibold"
            style={{ background: 'var(--surface-3)', color: 'var(--text-dim)' }}
          >
            Not now
          </button>
        </div>
      </div>
    </Sheet>
  )
}

function Label({ children }: { children: React.ReactNode }) {
  return (
    <span
      className="px-1 pt-1 text-[11px] font-semibold uppercase tracking-wide"
      style={{ color: 'var(--text-faint)' }}
    >
      {children}
    </span>
  )
}

function Row({ children, tone }: { children: React.ReactNode; tone: string }) {
  return (
    <div
      className="flex items-center gap-3 rounded-xl px-3 py-2 text-[13.5px]"
      style={{ background: 'var(--surface-2)', borderLeft: `3px solid ${tone}` }}
    >
      {children}
    </div>
  )
}
