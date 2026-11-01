import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { AnimatePresence, motion } from 'motion/react'
import { Icon } from '@/components/primitives/Icon'
import { useData } from '@/store/useData'
import { useProfile } from '@/store/useProfile'
import { formatPrice, parsePrice } from '@/lib/money'
import { fire } from '@/lib/haptics'
import { addDebt, markPaid, markUnpaid, removeDebt } from '@/apps/owe/actions'
import { DebtEditSheet } from '@/apps/owe/DebtEditSheet'
import { SettleSheet } from '@/apps/owe/SettleSheet'
import { PaySheet, type PayTarget } from '@/apps/owe/PaySheet'
import {
  PAYMENT_MARK,
  SETTLED_MARK,
  knownNames,
  normaliseName,
  openDebts,
  outstandingTotal,
  paidDebts,
  planSettlement,
  settleCandidates,
  summarise,
  type SettlePlan,
} from '@/apps/owe/summary'
import type { Debt, DebtDirection } from '@/data/types'
import { useKeys } from '../keys'
import { Kbd } from '../ui'
import { useDeepLink } from '../useDeepLink'

/**
 * Owe & Owed on a laptop: both lists at once.
 *
 * The phone switches between "owed to us" and "we owe" because there's room
 * for one. Side by side, the thing the phone makes you remember — that Sam is
 * on both — is simply visible, and a table of people with a total each is
 * the view a spreadsheet would give you, minus the spreadsheet.
 *
 * Settling stays deliberate. The phone's zipper exists because marking a debt
 * paid by accident is undone with a conversation, not a tap; a pull gesture
 * means nothing to a trackpad, so here it is two clicks — Paid, then Confirm —
 * with the second one only live for a few seconds.
 */
export function DeskOwe() {
  const debts = useData((s) => s.debts)
  const [editing, setEditing] = useState<Debt | null>(null)
  const [settling, setSettling] = useState<SettlePlan | null>(null)
  const [paying, setPaying] = useState<PayTarget | null>(null)
  const [filter, setFilter] = useState('')
  const [prefill, setPrefill] = useState<{ name: string; n: number } | null>(null)
  const filterRef = useRef<HTMLInputElement>(null)
  const addRef = useRef<HTMLInputElement>(null)

  const candidates = useMemo(() => settleCandidates(debts), [debts])
  const inbound = outstandingTotal(debts, 'owed_to_us')
  const outbound = outstandingTotal(debts, 'we_owe')
  const net = inbound - outbound

  const openSettle = (key: string) => {
    const plan = planSettlement(debts, key)
    if (plan) setSettling(plan)
  }

  useKeys([
    { keys: 'n', run: () => addRef.current?.focus(), label: 'Add an entry', group: 'Owe & Owed' },
    { keys: '/', run: () => filterRef.current?.focus(), label: 'Filter by name', group: 'Owe & Owed' },
  ])

  useDeepLink('owe', (link) => {
    if (typeof link.id === 'string') {
      const debt = debts.find((d) => d.id === link.id)
      if (debt) setEditing(debt)
    }
    if (typeof link.add === 'string') {
      setPrefill((p) => ({ name: link.add as string, n: (p?.n ?? 0) + 1 }))
    }
  })

  const closePay = useCallback(() => setPaying(null), [])

  return (
    <div className="flex h-full flex-col">
      <header className="flex shrink-0 flex-wrap items-center gap-x-6 gap-y-2 px-6 pb-3 pt-5">
        <h1 className="text-[26px] font-bold tracking-tight" style={{ color: '#3fa96b' }}>
          Owe &amp; Owed
        </h1>
        <div className="flex items-baseline gap-5 text-[13px]" style={{ color: 'var(--text-dim)' }}>
          <span>
            Owed to us{' '}
            <b className="text-[15px] tabular-nums" style={{ color: inbound ? 'var(--ok)' : 'var(--text-faint)' }}>
              {formatPrice(inbound) || '$0'}
            </b>
          </span>
          <span>
            We owe{' '}
            <b className="text-[15px] tabular-nums" style={{ color: outbound ? 'var(--warn)' : 'var(--text-faint)' }}>
              {formatPrice(outbound) || '$0'}
            </b>
          </span>
          {inbound > 0 && outbound > 0 && (
            <span>
              Net{' '}
              <b className="text-[15px] tabular-nums" style={{ color: 'var(--text)' }}>
                {net === 0 ? 'even' : `${formatPrice(Math.abs(net))} ${net > 0 ? 'to us' : 'from us'}`}
              </b>
            </span>
          )}
        </div>
        <div className="relative ml-auto w-[240px]">
          <span className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2" style={{ color: 'var(--text-faint)' }}>
            <Icon name="search" size={14} />
          </span>
          <input
            ref={filterRef}
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Escape') {
                setFilter('')
                e.currentTarget.blur()
              }
            }}
            placeholder="Filter by name or reason"
            aria-label="Filter by name or reason"
            className="desk-input !pl-8"
          />
        </div>
      </header>

      <div className="desk-scroll min-h-0 flex-1 overflow-y-auto px-6 pb-8">
        <AddRow inputRef={addRef} prefill={prefill} />

        <AnimatePresence initial={false}>
          {candidates.map((c) => {
            const n = c.owedToUs - c.weOwe
            return (
              <motion.div
                key={c.key}
                layout
                initial={{ opacity: 0, y: -6 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0 }}
                className="mt-3 flex items-center gap-3 rounded-2xl px-4 py-2.5"
                style={{ background: 'var(--accent-soft)', border: '1px solid var(--border)' }}
              >
                <span className="text-[18px]" aria-hidden>
                  ⚖️
                </span>
                <span className="min-w-0 flex-1 text-[13.5px]">
                  <b>{c.name}</b> is on both lists —{' '}
                  {n === 0 ? 'it cancels out exactly' : n > 0 ? `nets to ${formatPrice(n)} owed to you` : `nets to ${formatPrice(-n)} you owe`}
                </span>
                <button
                  onClick={() => openSettle(c.key)}
                  className="rounded-full px-3.5 py-1.5 text-[12.5px] font-semibold text-white"
                  style={{ background: 'var(--accent)' }}
                >
                  Settle
                </button>
              </motion.div>
            )
          })}
        </AnimatePresence>

        <div className="mt-4 grid gap-5 xl:grid-cols-2">
          {(['owed_to_us', 'we_owe'] as DebtDirection[]).map((dir) => (
            <Pane
              key={dir}
              direction={dir}
              debts={debts}
              filter={filter}
              settleable={new Set(candidates.map((c) => c.key))}
              onEdit={setEditing}
              onPay={(key) => setPaying({ key, direction: dir })}
              onSettle={openSettle}
            />
          ))}
        </div>
      </div>

      <DebtEditSheet debt={editing} onClose={() => setEditing(null)} />
      <SettleSheet plan={settling} onClose={() => setSettling(null)} />
      <PaySheet target={paying} onClose={closePay} />
    </div>
  )
}

/** Who, how much, what for, which way — one line, Enter to add. */
function AddRow({ inputRef, prefill }: { inputRef: React.RefObject<HTMLInputElement | null>; prefill: { name: string; n: number } | null }) {
  const debts = useData((s) => s.debts)
  const profileId = useProfile((s) => s.profileId)
  const [direction, setDirection] = useState<DebtDirection>('owed_to_us')
  const [name, setName] = useState('')
  const [amount, setAmount] = useState('')
  const [reason, setReason] = useState('')
  const amountRef = useRef<HTMLInputElement>(null)
  const names = useMemo(() => knownNames(debts), [debts])
  const cents = parsePrice(amount)
  const ready = name.trim().length > 0 && cents !== null && cents > 0

  useEffect(() => {
    if (!prefill) return
    setName(prefill.name)
    requestAnimationFrame(() => amountRef.current?.focus())
  }, [prefill])

  async function submit() {
    if (!ready || cents === null) return
    const typed = { name, amount, reason }
    // Clear before the save, not after it: the row is on the list at once
    // (see addDebt), and clearing on the way back from the network wiped
    // whatever had been typed for the next entry in the meantime.
    setName('')
    setAmount('')
    setReason('')
    inputRef.current?.focus()
    const created = await addDebt({ direction, counterparty: typed.name, amountCents: cents, reason: typed.reason || null, profileId })
    if (!created) {
      // It didn't go in; give the words back, unless something new is there.
      setName((n) => n || typed.name)
      setAmount((a) => a || typed.amount)
      setReason((r) => r || typed.reason)
    }
  }

  const onEnter = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      e.preventDefault()
      void submit()
    }
  }

  // Exactly how the phone suggests names: an existing spelling is what keeps
  // one person from becoming two rows in the roll-up.
  const exact = names.find((n) => normaliseName(n) === normaliseName(name))

  return (
    <div className="flex flex-wrap items-center gap-2 rounded-2xl p-2" style={{ background: 'var(--surface)', border: '1px solid var(--border)' }}>
      <div className="flex shrink-0 gap-0.5 rounded-xl p-0.5" style={{ background: 'var(--surface-2)' }} role="radiogroup" aria-label="Which list">
        {(
          [
            ['owed_to_us', 'Owes us', 'var(--ok)'],
            ['we_owe', 'We owe', 'var(--warn)'],
          ] as const
        ).map(([id, label, tone]) => (
          <button
            key={id}
            role="radio"
            aria-checked={direction === id}
            onClick={() => setDirection(id)}
            className="rounded-[10px] px-3 py-1.5 text-[12.5px] font-semibold"
            style={{
              background: direction === id ? 'var(--surface)' : 'transparent',
              color: direction === id ? tone : 'var(--text-faint)',
              boxShadow: direction === id ? '0 1px 2px rgb(0 0 0 / 0.12)' : undefined,
            }}
          >
            {label}
          </button>
        ))}
      </div>
      <input
        ref={inputRef}
        value={name}
        onChange={(e) => setName(e.target.value)}
        onKeyDown={onEnter}
        list="owe-names"
        placeholder={direction === 'owed_to_us' ? 'Who owes us?' : 'Who do we owe?'}
        aria-label="Who"
        className="desk-input !w-[200px]"
      />
      <datalist id="owe-names">
        {names.map((n) => (
          <option key={n} value={n} />
        ))}
      </datalist>
      <div className="relative">
        <span className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-[14px]" style={{ color: 'var(--text-faint)' }}>
          $
        </span>
        <input
          ref={amountRef}
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
          onKeyDown={onEnter}
          inputMode="decimal"
          placeholder="0.00"
          aria-label="How much"
          className="desk-input !w-[110px] !pl-6 tabular-nums"
        />
      </div>
      <input value={reason} onChange={(e) => setReason(e.target.value)} onKeyDown={onEnter} placeholder="What for (optional)" aria-label="What for" className="desk-input min-w-[160px] flex-1" />
      <button
        onClick={() => void submit()}
        disabled={!ready}
        className="flex items-center gap-1.5 rounded-xl px-4 py-2 text-[13px] font-semibold text-white disabled:opacity-40"
        style={{ background: direction === 'owed_to_us' ? 'var(--ok)' : 'var(--warn)' }}
      >
        Add <Kbd combo="enter" />
      </button>
      {name.trim() && !exact && names.length > 0 && (
        <span className="w-full px-1 text-[11.5px]" style={{ color: 'var(--text-faint)' }}>
          New name — pick an existing spelling from the list to keep one person on one row.
        </span>
      )}
    </div>
  )
}

function Pane({
  direction,
  debts,
  filter,
  settleable,
  onEdit,
  onPay,
  onSettle,
}: {
  direction: DebtDirection
  debts: Debt[]
  filter: string
  settleable: Set<string>
  onEdit: (d: Debt) => void
  onPay: (key: string) => void
  onSettle: (key: string) => void
}) {
  const profileId = useProfile((s) => s.profileId)
  const [historyOpen, setHistoryOpen] = useState(false)
  const inbound = direction === 'owed_to_us'
  const tone = inbound ? 'var(--ok)' : 'var(--warn)'
  const q = normaliseName(filter)

  const { people, open, paid } = useMemo(() => {
    const matches = (d: Debt) => !q || d.counterparty_key.includes(q) || normaliseName(d.reason ?? '').includes(q)
    return {
      people: summarise(debts, direction).filter((p) => !q || p.key.includes(q)),
      open: openDebts(debts, direction).filter(matches),
      paid: paidDebts(debts, direction).filter(matches),
    }
  }, [debts, direction, q])
  const total = outstandingTotal(debts, direction)

  return (
    <section className="flex flex-col rounded-2xl" style={{ background: 'var(--surface)', border: '1px solid var(--border)' }}>
      <div className="flex items-baseline justify-between px-5 pb-2 pt-4">
        <h2 className="text-[16px] font-bold">{inbound ? 'Owed to us' : 'We owe'}</h2>
        <span className="text-[20px] font-bold tabular-nums" style={{ color: total ? tone : 'var(--text-faint)' }}>
          {formatPrice(total) || '$0'}
        </span>
      </div>

      {people.length > 0 && (
        <table className="mx-5 mb-2 text-[13.5px]" style={{ width: 'calc(100% - 40px)' }}>
          <thead>
            <tr className="text-left text-[11px] font-semibold uppercase tracking-wide" style={{ color: 'var(--text-faint)' }}>
              <th className="pb-1 font-semibold">Person</th>
              <th className="pb-1 text-right font-semibold">Entries</th>
              <th className="pb-1 text-right font-semibold">Total</th>
              <th className="pb-1" />
            </tr>
          </thead>
          <tbody>
            {people.map((p) => (
              <tr key={p.key} style={{ borderTop: '1px solid var(--border)' }}>
                <td className="py-1.5 font-semibold">{p.name}</td>
                <td className="py-1.5 text-right tabular-nums" style={{ color: 'var(--text-faint)' }}>
                  {p.count}
                </td>
                <td className="py-1.5 text-right font-bold tabular-nums" style={{ color: tone }}>
                  {formatPrice(p.total)}
                </td>
                <td className="py-1.5 pl-3 text-right">
                  <span className="inline-flex items-center gap-1">
                    {settleable.has(p.key) && (
                      <button
                        onClick={() => onSettle(p.key)}
                        title={`Settle both lists with ${p.name}`}
                        className="desk-hover rounded-full px-2 py-0.5 text-[12px]"
                        style={{ background: 'var(--accent-soft)' }}
                      >
                        ⚖️
                      </button>
                    )}
                    <button
                      onClick={() => onPay(p.key)}
                      className="desk-hover rounded-full px-2.5 py-0.5 text-[12px] font-semibold"
                      style={{ border: '1px solid var(--border)', color: 'var(--accent-text)' }}
                      title={inbound ? `Record money ${p.name} paid back` : `Record money paid to ${p.name}`}
                    >
                      {inbound ? 'Got paid' : 'Pay'}
                    </button>
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      <div className="flex flex-col px-3 pb-3">
        <p className="px-2 pb-1 pt-3 text-[11px] font-semibold uppercase tracking-wide" style={{ color: 'var(--text-faint)' }}>
          Open entries · {open.length}
        </p>
        {open.length === 0 ? (
          <p className="px-2 py-6 text-center text-[13px]" style={{ color: 'var(--text-faint)' }}>
            {q ? 'Nothing matches.' : inbound ? 'Nobody owes you.' : 'You owe nobody.'}
          </p>
        ) : (
          <AnimatePresence initial={false}>
            {open.map((d) => (
              <OpenRow key={d.id} debt={d} tone={tone} onEdit={() => onEdit(d)} onPaid={() => void markPaid(d, profileId)} />
            ))}
          </AnimatePresence>
        )}

        {paid.length > 0 && (
          <>
            <button onClick={() => setHistoryOpen((o) => !o)} className="mt-3 flex items-center gap-2 px-2 py-1 text-left" aria-expanded={historyOpen}>
              <motion.span animate={{ rotate: historyOpen ? 90 : 0 }} style={{ color: 'var(--text-faint)' }}>
                <Icon name="chevron" size={13} strokeWidth={2.6} />
              </motion.span>
              <span className="text-[11px] font-semibold uppercase tracking-wide" style={{ color: 'var(--text-faint)' }}>
                History · {paid.length}
              </span>
            </button>
            {historyOpen &&
              paid.map((d) => (
                <div key={d.id} className="desk-row flex items-center gap-3 rounded-xl px-2 py-1.5 text-[13px]" style={{ color: 'var(--text-dim)' }}>
                  <span style={{ color: 'var(--ok)' }}>
                    <Icon name="checkCircle" size={15} />
                  </span>
                  <span className="w-[120px] shrink-0 truncate font-medium">{d.counterparty}</span>
                  <span className="min-w-0 flex-1 truncate text-[12px]" style={{ color: 'var(--text-faint)' }}>
                    {marker(d) === 'settled' ? '⚖️ Settled · ' : marker(d) === 'paid' ? '💸 Paid down · ' : ''}
                    {d.reason ? `${d.reason} · ` : ''}
                    {d.paid_at ? `paid ${shortDate(d.paid_at)}` : 'paid'}
                  </span>
                  <span className="w-[80px] shrink-0 text-right tabular-nums">{formatPrice(d.amount_cents)}</span>
                  <span className="desk-row-actions flex shrink-0 gap-1">
                    <button onClick={() => void markUnpaid(d, profileId)} className="desk-hover rounded-full px-2 py-0.5 text-[11.5px] font-semibold" style={{ background: 'var(--surface-3)' }}>
                      Undo
                    </button>
                    <button onClick={() => void removeDebt(d)} aria-label="Delete" title="Delete" className="desk-hover grid h-6 w-6 place-items-center rounded-full" style={{ color: 'var(--text-faint)' }}>
                      <Icon name="trash" size={13} />
                    </button>
                  </span>
                </div>
              ))}
          </>
        )}
      </div>
    </section>
  )
}

/** How long the second click of Paid → Confirm stays live. */
const CONFIRM_MS = 4000

function OpenRow({ debt, tone, onEdit, onPaid }: { debt: Debt; tone: string; onEdit: () => void; onPaid: () => void }) {
  const [arming, setArming] = useState(false)
  useEffect(() => {
    if (!arming) return
    const t = setTimeout(() => setArming(false), CONFIRM_MS)
    return () => clearTimeout(t)
  }, [arming])
  const m = marker(debt)

  return (
    <motion.div
      layout
      initial={{ opacity: 0, y: 4 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, x: 24 }}
      transition={{ duration: 0.18 }}
      className="desk-row flex items-center gap-3 rounded-xl px-2 py-2"
      style={{ borderTop: '1px solid var(--border)' }}
      onDoubleClick={onEdit}
    >
      <span className="w-[120px] shrink-0 truncate text-[14px] font-semibold" title={debt.counterparty}>
        {debt.counterparty}
      </span>
      <span className="min-w-0 flex-1 truncate text-[13px]" style={{ color: 'var(--text-dim)' }} title={debt.reason ?? undefined}>
        {m === 'paid' ? '💸 Partly paid · ' : m === 'settled' ? '⚖️ ' : ''}
        {debt.reason ?? ''}
      </span>
      <span className="w-[52px] shrink-0 text-right text-[11.5px]" style={{ color: 'var(--text-faint)' }}>
        {shortDate(debt.created_at)}
      </span>
      <span className="w-[80px] shrink-0 text-right text-[15px] font-bold tabular-nums" style={{ color: tone }}>
        {formatPrice(debt.amount_cents)}
      </span>
      <span className="flex shrink-0 items-center justify-end gap-1">
        <button onClick={onEdit} aria-label="Edit" title="Edit" className="desk-row-actions desk-hover grid h-7 w-7 place-items-center rounded-full" style={{ color: 'var(--text-faint)' }}>
          <Icon name="pencil" size={13} />
        </button>
        {arming ? (
          <button
            autoFocus
            onClick={() => {
              setArming(false)
              fire('success')
              onPaid()
            }}
            className="rounded-full px-3 py-1 text-[12px] font-bold text-white"
            style={{ background: tone }}
          >
            Confirm paid
          </button>
        ) : (
          <button
            onClick={() => {
              fire('warning')
              setArming(true)
            }}
            className="desk-hover rounded-full px-3 py-1 text-[12px] font-semibold"
            style={{ border: `1.5px solid ${tone}`, color: tone }}
            title="Mark this entry paid — asks once more"
          >
            Paid
          </button>
        )}
      </span>
    </motion.div>
  )
}

function marker(debt: Debt): 'settled' | 'paid' | null {
  const notes = debt.notes ?? ''
  const settled = notes.lastIndexOf(SETTLED_MARK)
  const paid = notes.lastIndexOf(PAYMENT_MARK)
  if (settled < 0 && paid < 0) return null
  return paid > settled ? 'paid' : 'settled'
}

const shortDate = (iso: string): string => new Date(iso).toLocaleDateString(undefined, { day: 'numeric', month: 'short' })
