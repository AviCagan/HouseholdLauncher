import { useState, type ReactNode, type RefObject } from 'react'
import { toast } from 'sonner'
import { Icon } from '@/components/primitives/Icon'
import { useData, dataActions, type Recurrence } from '@/store/useData'
import { useProfile, useSettings } from '@/store/useProfile'
import { useUI } from '@/store/useUI'
import { RECURRENCE_PRESETS } from '@/lib/time'
import { fromDateInput } from '@/lib/deadline'
import { parsePrice } from '@/lib/money'
import { URGENCY_META, type Desire, type Urgency } from '@/data/types'
import { addShoppingEntry, addWishEntry } from '@/apps/things/features/addFromLink'
import type { ColKey } from './model'

/**
 * The add box at the top of each column.
 *
 * Same rule as the phone's quick-add: Enter adds and keeps focus, so a run of
 * items goes in without touching the mouse. The extra fields each list needs
 * — a due date, how often, which store, whose wish — sit on a second line
 * that opens when the box is in use and are reached with Tab, so the board
 * stays four tidy columns while nobody is typing.
 *
 * Anything finer than this (notes, weekday schedules, a wish's link) is one
 * double-click away in the full editor, which is the same form as the phone's.
 */

const URGENCY_COLORS: Record<Urgency, string> = { 0: 'var(--u-low)', 1: 'var(--u-med)', 2: 'var(--u-urgent)' }

const PLACEHOLDER: Record<ColKey, string> = {
  todos: 'Add a to-do…',
  chores: 'Add a chore…',
  shopping: 'Add an item, or paste a link…',
  wishlist: 'Add a wish, or paste a link…',
}

export function AddBox({ col, inputRef }: { col: ColKey; inputRef: RefObject<HTMLInputElement | null> }) {
  const profileId = useProfile((s) => s.profileId)
  const settings = useSettings()
  const stores = useData((s) => s.stores)
  const profiles = useData((s) => s.profiles)

  const [value, setValue] = useState('')
  const [open, setOpen] = useState(false)
  const [urgency, setUrgency] = useState<Urgency>(1)
  const [due, setDue] = useState('')
  const [repeat, setRepeat] = useState('')
  const [storeId, setStoreId] = useState<string>('')
  const [quantity, setQuantity] = useState('')
  const [owner, setOwner] = useState<string>(profileId ?? '')
  const [desire, setDesire] = useState<Desire>(3)
  const [price, setPrice] = useState('')

  const chosen = settings?.recurrence_presets ?? []
  const presets = chosen.length ? RECURRENCE_PRESETS.filter((p) => chosen.includes(p.label)) : RECURRENCE_PRESETS
  const store = stores.find((s) => s.id === storeId) ?? null

  /**
   * Back to defaults when the box closes. The options are only on screen while
   * the box is open, and a due date or a store that outlived it would land on
   * the next item without anyone seeing it chosen.
   */
  function reset() {
    setUrgency(1)
    setDue('')
    setRepeat('')
    setStoreId('')
    setQuantity('')
    setOwner(profileId ?? '')
    setDesire(3)
    setPrice('')
  }

  function commit() {
    const title = value.trim()
    if (!title) return
    if (col === 'todos') {
      void dataActions.addTodo(title, urgency, profileId, due ? fromDateInput(due) : null)
      // A deadline belongs to one to-do; the next one starts without.
      setDue('')
    } else if (col === 'chores') {
      const preset = presets.find((p) => p.label === repeat)
      const recurrence: Recurrence | null = preset ? { unit: preset.unit, count: preset.count } : null
      void dataActions.addChore(title, urgency, profileId, recurrence)
    } else if (col === 'shopping') {
      void addShoppingEntry({ title, urgency, store, profileId, quantity: quantity.trim() || null })
      setQuantity('')
    } else {
      const cents = price.trim() ? parsePrice(price) : null
      if (price.trim() && cents === null) {
        toast.warning("That price isn't a number")
        return
      }
      void addWishEntry({ raw: title, desire, profileId, owner: owner || null, priceCents: cents })
      setPrice('')
    }
    setValue('')
    inputRef.current?.focus()
  }

  return (
    <div
      className="desk-col-add rounded-[14px] px-2.5 py-1.5"
      onFocus={() => setOpen(true)}
      onBlur={(e) => {
        // Stay open while focus moves between the box's own fields.
        if (!e.currentTarget.contains(e.relatedTarget as Node | null) && !value) {
          setOpen(false)
          reset()
        }
      }}
    >
      <div className="flex items-center gap-2">
        <span style={{ color: 'var(--text-faint)' }}>
          <Icon name="plus" size={15} strokeWidth={2.6} />
        </span>
        <input
          ref={inputRef}
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault()
              commit()
            } else if (e.key === 'Escape') {
              e.preventDefault()
              setValue('')
              e.currentTarget.blur()
              setOpen(false)
              reset()
            }
          }}
          placeholder={PLACEHOLDER[col]}
          aria-label={PLACEHOLDER[col].replace('…', '')}
          className="min-w-0 flex-1 bg-transparent py-1 text-[14px] outline-none placeholder:text-[var(--text-faint)]"
        />
        {value.trim() && (
          <span className="shrink-0 text-[11px]" style={{ color: 'var(--text-faint)' }}>
            ↵
          </span>
        )}
      </div>

      {open && (
        <div className="flex flex-wrap items-center gap-1.5 pb-1 pt-1.5" style={{ borderTop: '1px dashed var(--border)' }}>
          {col !== 'wishlist' && (
            <div className="flex items-center gap-0.5" role="radiogroup" aria-label="Urgency">
              {([0, 1, 2] as Urgency[]).map((u) => (
                <button
                  key={u}
                  role="radio"
                  aria-checked={urgency === u}
                  onClick={() => setUrgency(u)}
                  title={URGENCY_META[u].label}
                  className="flex items-center gap-1 rounded-full px-2 py-0.5 text-[11.5px] font-semibold"
                  style={{
                    background: urgency === u ? `color-mix(in oklab, ${URGENCY_COLORS[u]} 22%, transparent)` : 'transparent',
                    color: urgency === u ? 'var(--text)' : 'var(--text-faint)',
                    border: `1.5px solid ${urgency === u ? URGENCY_COLORS[u] : 'transparent'}`,
                  }}
                >
                  <span className="h-1.5 w-1.5 rounded-full" style={{ background: URGENCY_COLORS[u] }} />
                  {URGENCY_META[u].short}
                </button>
              ))}
            </div>
          )}

          {col === 'todos' && (
            <Labelled label="Due">
              <input type="date" value={due} onChange={(e) => setDue(e.target.value)} className="desk-input !w-[140px] !py-0.5 text-[12.5px]" />
            </Labelled>
          )}

          {col === 'chores' && (
            <select value={repeat} onChange={(e) => setRepeat(e.target.value)} aria-label="How often" className="desk-input !w-auto !py-0.5 text-[12.5px]">
              <option value="">Doesn't repeat</option>
              {presets.map((p) => (
                <option key={p.label} value={p.label}>
                  {p.label}
                </option>
              ))}
            </select>
          )}

          {col === 'shopping' && (
            <>
              <select value={storeId} onChange={(e) => setStoreId(e.target.value)} aria-label="Store" className="desk-input !w-auto max-w-[150px] !py-0.5 text-[12.5px]">
                <option value="">No store</option>
                {stores.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                    {s.is_online ? ' (online)' : ''}
                  </option>
                ))}
              </select>
              <input
                value={quantity}
                onChange={(e) => setQuantity(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && commit()}
                placeholder="How many"
                aria-label="Quantity"
                className="desk-input !w-[90px] !py-0.5 text-[12.5px]"
              />
              <button
                onClick={() => useUI.getState().openSheet({ kind: 'stores' })}
                className="text-[12px] font-semibold"
                style={{ color: 'var(--accent-text)' }}
              >
                Stores…
              </button>
            </>
          )}

          {col === 'wishlist' && (
            <>
              <select value={owner} onChange={(e) => setOwner(e.target.value)} aria-label="Whose wish" className="desk-input !w-auto !py-0.5 text-[12.5px]">
                {profiles.map((p) => (
                  <option key={p.id} value={p.id}>
                    For {p.id === profileId ? 'me' : p.display_name}
                  </option>
                ))}
                <option value="">For both of us</option>
              </select>
              <select
                value={desire}
                onChange={(e) => setDesire(Number(e.target.value) as Desire)}
                aria-label="How badly"
                className="desk-input !w-auto !py-0.5 text-[12.5px]"
              >
                <option value={1}>Someday</option>
                <option value={2}>Would be nice</option>
                <option value={3}>Want it</option>
                <option value={4}>Really want it</option>
                <option value={5}>Must have</option>
              </select>
              <input
                value={price}
                onChange={(e) => setPrice(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && commit()}
                placeholder="$ price"
                inputMode="decimal"
                aria-label="Price"
                className="desk-input !w-[80px] !py-0.5 text-[12.5px]"
              />
            </>
          )}
        </div>
      )}
    </div>
  )
}

function Labelled({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="flex items-center gap-1 text-[11.5px] font-semibold" style={{ color: 'var(--text-faint)' }}>
      {label}
      {children}
    </label>
  )
}
