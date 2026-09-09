import { useEffect, useMemo, useState } from 'react'
import { AnimatePresence, motion } from 'motion/react'
import { toast } from 'sonner'
import { Sheet } from '@/components/primitives/Sheet'
import { Icon } from '@/components/primitives/Icon'
import { dataActions, useData } from '@/store/useData'
import { useProfile } from '@/store/useProfile'
import { useLauncher } from '@/store/useLauncher'
import { fire } from '@/lib/haptics'
import type { Store } from '@/data/types'
import {
  alreadyListed,
  groupByStore,
  missingCandidates,
  planExport,
  rememberedStore,
  type MealLike,
  type MissingLine,
} from './missing'
import { useMealsUI } from './store'
import { BigButton, POP, Stat, TextInput } from './ui'

/**
 * "Missing ingredients?" — from a meal to the shopping list in Things.
 *
 * Two steps, both all taps. First, what's missing: every ingredient of every
 * dish, scaled to the headcount, as rows that tick when tapped. Second, which
 * store: pick a store, then tap the things that come from there, the way you
 * would with a highlighter. Things already knows where each of these was
 * bought last time, so most of the second step is already done.
 *
 * The last button says "Export to Things" and does exactly that: one shopping
 * item per ingredient, filed under its store, with the amount and the meal
 * it's for as the quantity line. Things is the household's list; Meals only
 * writes to it.
 */
export function MissingSheet({
  open,
  meals,
  onClose,
}: {
  open: boolean
  /** One meal from the meal sheet, or a whole week from the planner. */
  meals: MealLike[]
  onClose: () => void
}) {
  const dishes = useData((s) => s.dishes)
  const stores = useData((s) => s.stores)
  const items = useData((s) => s.shopping_items)
  const profileId = useProfile((s) => s.profileId)
  const openApp = useLauncher((s) => s.openApp)
  const celebrate = useMealsUI((s) => s.celebrate)

  const [step, setStep] = useState<'pick' | 'stores'>('pick')
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [storeOf, setStoreOf] = useState<Record<string, string | null>>({})
  const [brush, setBrush] = useState<string | null>(null)
  /** Lines that opened with a store already on them, from past shopping. */
  const [remembered, setRemembered] = useState<Set<string>>(new Set())
  const [busy, setBusy] = useState(false)

  const lines = useMemo(() => missingCandidates(meals, dishes), [meals, dishes])
  const listed = useMemo(
    () => new Set(lines.filter((l) => alreadyListed(l.name, items)).map((l) => l.key)),
    [lines, items],
  )

  useEffect(() => {
    if (!open) return
    setStep('pick')
    setSelected(new Set())
    setBusy(false)
    // Start every line where it was bought last time.
    const guesses: Record<string, string | null> = {}
    for (const l of lines) guesses[l.key] = rememberedStore(l.name, items)
    setStoreOf(guesses)
    setRemembered(new Set(lines.filter((l) => guesses[l.key]).map((l) => l.key)))
    setBrush(stores.slice().sort((a, b) => a.sort_order - b.sort_order)[0]?.id ?? null)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open])

  const chosen = lines.filter((l) => selected.has(l.key))
  const plan = useMemo(
    () => planExport(chosen, (l) => storeOf[l.key] ?? null, items),
    [chosen, storeOf, items],
  )
  const knownAlready = chosen.filter((l) => remembered.has(l.key)).length

  const toggle = (key: string) => {
    if (listed.has(key)) return
    fire('snap')
    setSelected((set) => {
      const next = new Set(set)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })
  }

  const toggleDish = (dishKeys: string[]) => {
    const open = dishKeys.filter((k) => !listed.has(k))
    const all = open.every((k) => selected.has(k))
    fire('snap')
    setSelected((set) => {
      const next = new Set(set)
      for (const k of open) if (all) next.delete(k)
      else next.add(k)
      return next
    })
  }

  const paint = (key: string) => {
    fire('snap')
    setStoreOf((map) => ({ ...map, [key]: map[key] === brush ? null : brush }))
  }

  async function exportToThings() {
    if (busy || plan.rows.length === 0) return
    setBusy(true)
    let sent = 0
    for (const row of plan.rows) {
      // dataActions rolls back and toasts on its own failure; a partial export
      // leaves what was written, since those items are real.
      await dataActions.addShoppingItem(row.title, 1, row.storeId, profileId, row.quantity)
      sent += 1
    }
    setBusy(false)
    fire('success')
    celebrate()
    const skipped = plan.skipped.length
    toast.success(`${sent} ${sent === 1 ? 'thing' : 'things'} sent to Things`, {
      description: skipped ? `${skipped} already on the list, left alone.` : undefined,
      action: { label: 'Open Things', onClick: () => openApp('things', { tab: 'shopping' }) },
    })
    onClose()
  }

  // Lines grouped by dish for step one, by store for step two.
  const byDish = useMemo(() => {
    const groups: { id: string; label: string; emoji: string; batches: number; meal: string; lines: MissingLine[] }[] = []
    for (const l of lines) {
      const id = `${l.mealName}:${l.dishId}`
      let g = groups.find((x) => x.id === id)
      if (!g) {
        g = { id, label: l.dishName, emoji: l.dishEmoji, batches: l.batches, meal: l.mealName, lines: [] }
        groups.push(g)
      }
      g.lines.push(l)
    }
    return groups
  }, [lines])
  const manyMeals = new Set(lines.map((l) => l.mealName)).size > 1
  const byStore = useMemo(
    () => groupByStore(chosen.map((l) => ({ ...l, storeId: storeOf[l.key] ?? null })), stores),
    [chosen, storeOf, stores],
  )

  const title = step === 'pick' ? 'What’s missing?' : 'Which store?'

  return (
    <Sheet open={open} onClose={onClose} title={<span className="m-title text-[18px]">{title}</span>} height="92vh">
      <div className="meals -mx-4 -mb-4 flex flex-col gap-4 rounded-t-[26px] px-4 pb-8 pt-2" style={{ background: 'var(--m-paper)' }}>
        <Steps step={step} />

        <AnimatePresence mode="wait" initial={false}>
          {step === 'pick' ? (
            <motion.div key="pick" initial={{ opacity: 0, x: -16 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -16 }} transition={POP} className="flex flex-col gap-4">
              <p className="text-[13px] font-semibold" style={{ color: 'var(--m-ink-dim)' }}>
                Tap everything you need to buy. Amounts are for {meals.length === 1 ? `${meals[0].people} people` : 'the whole plan'}.
              </p>

              {lines.length === 0 && (
                <p className="m-card-flat px-4 py-6 text-center text-[14px] font-bold" style={{ color: 'var(--m-ink-dim)' }}>
                  None of these dishes has ingredients written down yet.
                </p>
              )}

              {byDish.map((g) => {
                const openKeys = g.lines.filter((l) => !listed.has(l.key)).map((l) => l.key)
                const all = openKeys.length > 0 && openKeys.every((k) => selected.has(k))
                return (
                  <div key={g.id} className="flex flex-col gap-1.5">
                    <div className="flex items-center gap-2 px-0.5">
                      <span className="text-[18px]">{g.emoji}</span>
                      <span className="min-w-0 flex-1 truncate text-[14px] font-black">
                        {g.label}
                        {g.batches > 1 && <span className="ml-1.5 text-[12px] font-extrabold" style={{ color: 'var(--m-tomato)' }}>×{g.batches}</span>}
                        {manyMeals && <span className="ml-1.5 text-[11.5px] font-bold" style={{ color: 'var(--m-ink-faint)' }}>· {g.meal}</span>}
                      </span>
                      {openKeys.length > 0 && (
                        <button onClick={() => toggleDish(openKeys)} className="m-chip !py-1 !text-[11.5px]" style={{ background: all ? 'var(--m-mint-soft)' : 'var(--m-card)' }}>
                          {all ? 'None' : 'All of it'}
                        </button>
                      )}
                    </div>
                    <div className="flex flex-col gap-1.5">
                      {g.lines.map((l) => (
                        <PickRow key={l.key} line={l} on={selected.has(l.key)} listed={listed.has(l.key)} onToggle={() => toggle(l.key)} />
                      ))}
                    </div>
                  </div>
                )
              })}

              <BigButton
                onClick={() => {
                  fire('tap')
                  setStep('stores')
                }}
                disabled={chosen.length === 0}
              >
                {chosen.length === 0 ? 'Pick what’s missing' : `Next · sort ${chosen.length} into stores`}
              </BigButton>
            </motion.div>
          ) : (
            <motion.div key="stores" initial={{ opacity: 0, x: 16 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: 16 }} transition={POP} className="flex flex-col gap-4">
              <p className="text-[13px] font-semibold" style={{ color: 'var(--m-ink-dim)' }}>
                Pick a store, then tap what comes from there.
                {knownAlready > 0 && ` ${knownAlready} ${knownAlready === 1 ? 'is' : 'are'} already where you bought ${knownAlready === 1 ? 'it' : 'them'} last time.`}
              </p>

              <Brushes stores={stores} brush={brush} onPick={setBrush} />

              <div className="flex flex-col gap-3">
                {byStore.map((g) => (
                  <div key={g.store?.id ?? 'none'} className="flex flex-col gap-1.5">
                    <div className="flex items-center gap-2 px-0.5">
                      <span className="h-3 w-3 rounded-full" style={{ background: g.store?.color_hex ?? 'var(--m-ink-faint)', border: '2px solid var(--m-line)' }} />
                      <span className="text-[12px] font-black uppercase tracking-wide" style={{ color: 'var(--m-ink-dim)' }}>
                        {g.store?.name ?? 'No store yet'}
                      </span>
                      <span className="text-[12px] font-bold" style={{ color: 'var(--m-ink-faint)' }}>
                        {g.rows.length}
                      </span>
                    </div>
                    <div className="flex flex-col gap-1.5">
                      {g.rows.map((l) => (
                        <motion.button
                          key={l.key}
                          layout
                          transition={POP}
                          onClick={() => paint(l.key)}
                          className="m-card-flat flex items-center gap-2.5 px-3 py-2.5 text-left"
                          style={{ background: 'var(--m-card)' }}
                        >
                          <span className="h-4 w-4 shrink-0 rounded-full" style={{ background: g.store?.color_hex ?? 'transparent', border: '2px solid var(--m-line)' }} />
                          <span className="min-w-0 flex-1 truncate text-[14px] font-extrabold">{l.name}</span>
                          {l.amount && (
                            <span className="shrink-0 text-[12px] font-bold" style={{ color: 'var(--m-ink-dim)' }}>
                              {l.amount}
                            </span>
                          )}
                        </motion.button>
                      ))}
                    </div>
                  </div>
                ))}
              </div>

              {plan.skipped.length > 0 && (
                <p className="text-[12px] font-semibold" style={{ color: 'var(--m-ink-faint)' }}>
                  Already on the list, so not added again: {plan.skipped.map((l) => l.name).join(', ')}.
                </p>
              )}

              <div className="flex flex-col gap-2">
                <BigButton onClick={() => void exportToThings()} busy={busy} disabled={plan.rows.length === 0} tone="var(--m-mint)" ink="var(--m-ink)">
                  🛒 Export to Things · {plan.rows.length}
                </BigButton>
                <BigButton
                  onClick={() => {
                    fire('tap')
                    setStep('pick')
                  }}
                  tone="var(--m-card)"
                  ink="var(--m-ink)"
                >
                  Back
                </BigButton>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </Sheet>
  )
}

function Steps({ step }: { step: 'pick' | 'stores' }) {
  const items: { key: 'pick' | 'stores'; label: string }[] = [
    { key: 'pick', label: '1 · What’s missing' },
    { key: 'stores', label: '2 · Which store' },
  ]
  return (
    <div className="flex gap-1.5">
      {items.map((s) => (
        <Stat key={s.key} tone={s.key === step ? 'var(--m-butter)' : 'var(--m-card-2)'}>
          {s.label}
        </Stat>
      ))}
    </div>
  )
}

/** A big tick box of a row: the whole thing is the target. */
function PickRow({ line, on, listed, onToggle }: { line: MissingLine; on: boolean; listed: boolean; onToggle: () => void }) {
  return (
    <motion.button
      whileTap={listed ? undefined : { scale: 0.98 }}
      onClick={onToggle}
      disabled={listed}
      aria-pressed={on}
      className="m-card-flat flex items-center gap-2.5 px-3 py-2.5 text-left"
      style={{ background: on ? 'var(--m-mint-soft)' : 'var(--m-card)', opacity: listed ? 0.55 : 1 }}
    >
      <span
        className="grid h-6 w-6 shrink-0 place-items-center rounded-lg"
        style={{ border: '2px solid var(--m-line)', background: on ? 'var(--m-mint)' : 'transparent', color: 'var(--m-ink)' }}
      >
        <AnimatePresence>
          {on && (
            <motion.span initial={{ scale: 0 }} animate={{ scale: 1 }} exit={{ scale: 0 }} transition={POP} className="grid place-items-center">
              <Icon name="check" size={14} strokeWidth={3.5} />
            </motion.span>
          )}
        </AnimatePresence>
      </span>
      <span className="min-w-0 flex-1 truncate text-[14px] font-extrabold">{line.name}</span>
      {listed ? (
        <span className="shrink-0 text-[11px] font-black uppercase tracking-wide" style={{ color: 'var(--m-ink-faint)' }}>
          on the list
        </span>
      ) : (
        line.amount && (
          <span className="shrink-0 text-[12px] font-bold" style={{ color: 'var(--m-ink-dim)' }}>
            {line.amount}
          </span>
        )
      )}
    </motion.button>
  )
}

const NEW_STORE_COLORS = ['#4a9d7e', '#7c5cff', '#ff6ea9', '#f5a524', '#3aa0ff', '#e0563c', '#9b8cff', '#2bb673']

/**
 * The highlighters. Things' stores, in Things' order, plus "no store" and a
 * way to make a new one on the spot — because "we need a butcher" tends to
 * come up exactly here, in the middle of planning, not in a settings sheet.
 */
function Brushes({ stores, brush, onPick }: { stores: Store[]; brush: string | null; onPick: (id: string | null) => void }) {
  const [adding, setAdding] = useState(false)
  const [name, setName] = useState('')
  const ordered = [...stores].sort((a, b) => a.sort_order - b.sort_order)

  async function add() {
    const trimmed = name.trim()
    if (!trimmed) return
    await dataActions.addStore({
      name: trimmed,
      is_online: false,
      url: null,
      address: null,
      lat: null,
      lng: null,
      geocoded_at: null,
      geocode_source: null,
      color_hex: NEW_STORE_COLORS[stores.length % NEW_STORE_COLORS.length],
      emoji: null,
    })
    setName('')
    setAdding(false)
    // The new store is the last one in Things' order; paint with it next.
    const latest = useData.getState().stores.slice().sort((a, b) => b.sort_order - a.sort_order)[0]
    if (latest) onPick(latest.id)
  }

  return (
    <div className="flex flex-col gap-2">
      <div className="scroll-x -mx-4 flex gap-1.5 px-4 pb-1">
        {ordered.map((s) => {
          const on = brush === s.id
          return (
            <button
              key={s.id}
              onClick={() => {
                fire('snap')
                onPick(s.id)
              }}
              className="m-chip"
              style={{
                background: on ? s.color_hex : 'var(--m-card)',
                color: on ? '#fff' : 'var(--m-ink)',
                borderColor: on ? 'var(--m-line)' : 'var(--m-line)',
                transform: on ? 'translate(-1px, -1px)' : undefined,
                boxShadow: on ? 'var(--m-shadow-sm)' : undefined,
              }}
            >
              <span className="h-2.5 w-2.5 rounded-full" style={{ background: on ? '#fff' : s.color_hex }} />
              {s.name}
              {s.is_online && <Icon name="globe" size={11} strokeWidth={2.6} />}
            </button>
          )
        })}
        <button
          onClick={() => {
            fire('snap')
            onPick(null)
          }}
          className="m-chip"
          style={{ background: brush === null ? 'var(--m-ink)' : 'var(--m-card)', color: brush === null ? 'var(--m-paper)' : 'var(--m-ink)' }}
        >
          No store
        </button>
        <button
          onClick={() => {
            fire('tap')
            setAdding((a) => !a)
          }}
          className="m-chip"
          style={{ background: 'var(--m-card-2)', borderStyle: 'dashed' }}
        >
          <Icon name="plus" size={12} strokeWidth={3} /> New store
        </button>
      </div>
      <AnimatePresence>
        {adding && (
          <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }} exit={{ opacity: 0, height: 0 }} className="flex gap-2 overflow-hidden">
            <TextInput value={name} onChange={(e) => setName(e.target.value)} placeholder="Butcher on Main" autoFocus className="!py-2 !text-[14px]" onKeyDown={(e) => e.key === 'Enter' && void add()} />
            <BigButton onClick={() => void add()} disabled={!name.trim()} tone="var(--m-mint)" ink="var(--m-ink)" className="!w-auto !px-4 !py-2 !text-[13.5px]">
              Add
            </BigButton>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}
