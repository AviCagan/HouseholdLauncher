import { useState } from 'react'
import { motion } from 'motion/react'
import { Sheet } from '@/components/primitives/Sheet'
import { Icon } from '@/components/primitives/Icon'
import { useProfile } from '@/store/useProfile'
import { formatPrice } from '@/lib/money'
import { fire } from '@/lib/haptics'
import { applySettlement } from './actions'
import type { SettlePlan } from './summary'

/**
 * "You owe Nuri $200, Nuri owes you $100 — settle?"
 *
 * Shows exactly what will change before it changes, entry by entry. This is
 * a bookkeeping act that touches several rows at once and marks things paid
 * that nobody paid, so it is not something to do from a single tap on an
 * icon: the icon opens this, and this asks.
 */
export function SettleSheet({ plan, onClose }: { plan: SettlePlan | null; onClose: () => void }) {
  const profileId = useProfile((s) => s.profileId)
  const [busy, setBusy] = useState(false)

  if (!plan) return null

  const inbound = plan.smaller === 'owed_to_us' ? plan.amount : plan.amount + plan.remaining
  const outbound = plan.smaller === 'we_owe' ? plan.amount : plan.amount + plan.remaining
  const after =
    plan.remaining === 0
      ? 'All square'
      : plan.larger === 'we_owe'
        ? `You owe ${plan.name} ${formatPrice(plan.remaining)}`
        : `${plan.name} owes you ${formatPrice(plan.remaining)}`

  async function confirm() {
    if (!plan || busy) return
    setBusy(true)
    const ok = await applySettlement(plan, profileId)
    setBusy(false)
    if (ok) onClose()
  }

  return (
    <Sheet open={plan !== null} onClose={onClose} title={`Settle up with ${plan.name}`}>
      <div className="flex flex-col gap-4 pb-6">
        <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-2">
          <Side label={`${plan.name} owes you`} amount={inbound} tone="var(--ok)" />
          <span style={{ color: 'var(--text-faint)' }}>
            <Icon name="repeat" size={18} />
          </span>
          <Side label={`You owe ${plan.name}`} amount={outbound} tone="var(--warn)" />
        </div>

        <motion.div
          initial={{ opacity: 0, y: 6 }}
          animate={{ opacity: 1, y: 0 }}
          className="rounded-2xl px-4 py-3 text-center"
          style={{ background: 'var(--accent-soft)', border: '1px solid var(--border)' }}
        >
          <span className="block text-[11px] font-semibold uppercase tracking-wide" style={{ color: 'var(--text-faint)' }}>
            After
          </span>
          <span className="block text-[20px] font-bold">{after}</span>
        </motion.div>

        <div className="flex flex-col gap-1.5">
          <Label>Marked paid</Label>
          {[...plan.wipe, ...plan.payOff].map((d) => (
            <Row key={d.id} tone={d.direction === 'owed_to_us' ? 'var(--ok)' : 'var(--warn)'}>
              <span className="min-w-0 flex-1 truncate">
                {d.direction === 'owed_to_us' ? `${plan.name} → you` : `you → ${plan.name}`}
                {d.reason ? ` · ${d.reason}` : ''}
              </span>
              <span className="shrink-0 tabular-nums line-through" style={{ color: 'var(--text-faint)' }}>
                {formatPrice(d.amount_cents)}
              </span>
            </Row>
          ))}

          {plan.reduce && (
            <>
              <Label>Reduced</Label>
              <Row tone={plan.reduce.debt.direction === 'owed_to_us' ? 'var(--ok)' : 'var(--warn)'}>
                <span className="min-w-0 flex-1 truncate">
                  {plan.reduce.debt.direction === 'owed_to_us' ? `${plan.name} → you` : `you → ${plan.name}`}
                  {plan.reduce.debt.reason ? ` · ${plan.reduce.debt.reason}` : ''}
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

        <p className="px-1 text-[12px] leading-snug" style={{ color: 'var(--text-faint)' }}>
          Each entry gets a line in its notes saying it was settled this way, so the history still
          shows what happened. Nothing is deleted.
        </p>

        <div className="flex flex-col gap-2">
          <motion.button
            whileTap={{ scale: 0.97 }}
            onClick={() => void confirm()}
            disabled={busy}
            className="w-full rounded-2xl py-3.5 text-[15px] font-semibold text-white disabled:opacity-50"
            style={{ background: 'var(--accent)' }}
          >
            {busy ? 'Settling…' : 'Settle balances'}
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

function Side({ label, amount, tone }: { label: string; amount: number; tone: string }) {
  return (
    <div className="rounded-2xl px-3 py-2.5 text-center" style={{ background: 'var(--surface-2)', border: '1px solid var(--border)' }}>
      <span className="block truncate text-[11.5px] font-semibold" style={{ color: 'var(--text-dim)' }}>
        {label}
      </span>
      <span className="block text-[18px] font-bold tabular-nums" style={{ color: tone }}>
        {formatPrice(amount)}
      </span>
    </div>
  )
}

function Label({ children }: { children: React.ReactNode }) {
  return (
    <span className="px-1 pt-1 text-[11px] font-semibold uppercase tracking-wide" style={{ color: 'var(--text-faint)' }}>
      {children}
    </span>
  )
}

function Row({ children, tone }: { children: React.ReactNode; tone: string }) {
  return (
    <div className="flex items-center gap-3 rounded-xl px-3 py-2 text-[13.5px]" style={{ background: 'var(--surface-2)', borderLeft: `3px solid ${tone}` }}>
      {children}
    </div>
  )
}
