import { useMemo, useRef, useState } from 'react'
import { AnimatePresence, motion } from 'motion/react'
import { Icon } from '@/components/primitives/Icon'
import { useData } from '@/store/useData'
import { useProfile } from '@/store/useProfile'
import { parsePrice } from '@/lib/money'
import { fire } from '@/lib/haptics'
import { addDebt } from './actions'
import { knownNames, normaliseName } from './summary'
import type { DebtDirection } from '@/data/types'

/**
 * Add an entry to whichever list is showing.
 *
 * Three fields on one line — who, how much, what for — because that is the
 * whole record and pushing it into a sheet would make adding a $6 coffee debt
 * feel heavier than just remembering it.
 *
 * The name field suggests people already on either list. That is not a
 * convenience feature: the summary groups on the name, so reusing the exact
 * spelling is what keeps one person from becoming two rows in the roll-up.
 */
export function AddDebtBar({ direction }: { direction: DebtDirection }) {
  const [name, setName] = useState('')
  const [amount, setAmount] = useState('')
  const [reason, setReason] = useState('')
  const [expanded, setExpanded] = useState(false)
  const debts = useData((s) => s.debts)
  const profileId = useProfile((s) => s.profileId)
  const nameRef = useRef<HTMLInputElement>(null)

  const cents = parsePrice(amount)
  const canSubmit = name.trim().length > 0 && cents !== null && cents > 0

  /** Names matching what's typed, minus an exact hit — nothing to suggest. */
  const suggestions = useMemo(() => {
    const typed = normaliseName(name)
    if (!typed) return []
    const all = knownNames(debts)
    return all
      .filter((candidate) => {
        const key = normaliseName(candidate)
        return key.includes(typed) && key !== typed
      })
      .slice(0, 4)
  }, [name, debts])

  async function submit() {
    if (!canSubmit || cents === null) return
    const created = await addDebt({
      direction,
      counterparty: name,
      amountCents: cents,
      reason: reason || null,
      profileId,
    })
    if (created) {
      setName('')
      setAmount('')
      setReason('')
      setExpanded(false)
      nameRef.current?.focus()
    }
  }

  return (
    <div className="pointer-events-none fixed inset-x-0 bottom-0 z-40 px-3 pb-[calc(var(--safe-bottom)+0.75rem)]">
      <AnimatePresence>
        {suggestions.length > 0 && (
          <motion.div
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 6 }}
            className="pointer-events-auto mx-auto mb-2 flex max-w-[520px] flex-wrap gap-1.5"
          >
            {suggestions.map((suggestion) => (
              <button
                key={suggestion}
                onClick={() => {
                  fire('snap')
                  setName(suggestion)
                }}
                className="rounded-full px-3 py-1.5 text-[12px] font-medium"
                style={{
                  background: 'var(--surface-3)',
                  border: '1px solid var(--border)',
                  color: 'var(--text-dim)',
                }}
              >
                {suggestion}
              </button>
            ))}
          </motion.div>
        )}
      </AnimatePresence>

      <div
        className="pointer-events-auto mx-auto max-w-[520px] rounded-3xl p-2"
        style={{
          background: 'var(--surface)',
          border: '1px solid var(--border)',
          boxShadow: 'var(--shadow-lg)',
        }}
      >
        <div className="flex items-center gap-2">
          <input
            ref={nameRef}
            value={name}
            onChange={(e) => setName(e.target.value)}
            onFocus={() => setExpanded(true)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') void submit()
            }}
            placeholder={direction === 'owed_to_us' ? 'Who owes you?' : 'Who do you owe?'}
            aria-label="Person"
            autoCapitalize="words"
            autoCorrect="off"
            className="min-w-0 flex-1 bg-transparent px-2 py-2.5 text-[15px] outline-none placeholder:opacity-40"
          />

          <div
            className="flex shrink-0 items-center rounded-xl px-2"
            style={{ background: 'var(--surface-2)' }}
          >
            <span className="text-[15px]" style={{ color: 'var(--text-faint)' }}>
              $
            </span>
            <input
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') void submit()
              }}
              placeholder="0"
              aria-label="Amount"
              // `decimal` rather than `numeric`: numeric shows a keypad with no
              // decimal point on iOS, so $12.50 cannot be typed at all.
              inputMode="decimal"
              className="w-[68px] bg-transparent py-2.5 text-[15px] font-semibold tabular-nums outline-none placeholder:opacity-40"
            />
          </div>

          <motion.button
            whileTap={{ scale: 0.9 }}
            onClick={() => void submit()}
            disabled={!canSubmit}
            aria-label="Add"
            className="grid h-10 w-10 shrink-0 place-items-center rounded-full text-white disabled:opacity-30"
            style={{ background: 'var(--accent)' }}
          >
            <Icon name="plus" size={19} strokeWidth={2.6} />
          </motion.button>
        </div>

        <AnimatePresence initial={false}>
          {expanded && (
            <motion.div
              initial={{ height: 0, opacity: 0 }}
              animate={{ height: 'auto', opacity: 1 }}
              exit={{ height: 0, opacity: 0 }}
              transition={{ duration: 0.2 }}
              className="overflow-hidden"
            >
              <input
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') void submit()
                }}
                placeholder="What for? (optional)"
                aria-label="What for"
                className="w-full bg-transparent px-2 pb-1.5 pt-1 text-[13.5px] outline-none placeholder:opacity-40"
              />
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </div>
  )
}
