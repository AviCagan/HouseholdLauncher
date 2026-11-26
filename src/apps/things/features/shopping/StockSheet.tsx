import { useMemo, useState } from 'react'
import { toast } from 'sonner'
import { Sheet } from '@/components/primitives/Sheet'
import { Icon } from '@/components/primitives/Icon'
import { useData } from '@/store/useData'
import { useProfile } from '@/store/useProfile'
import { newId, nowIso } from '@/data/adapter'
import { fire } from '@/lib/haptics'
import type { ThingsStock } from '@/data/types'
import { isLow } from './stock'

/**
 * Stock: counts of what the household uses up.
 *
 * Each count has a level that counts as low. When it gets there, the
 * database puts the item on the shopping list (once, linked to this count,
 * so it is never added twice). Nano lowers counts when she's told something
 * ran out, and raises them from receipts once someone confirms.
 */
export function StockSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  const stock = useData((s) => s.things_stock)
  const stores = useData((s) => s.stores)
  const profileId = useProfile((s) => s.profileId)
  const [name, setName] = useState('')
  const [low, setLow] = useState('1')

  const rows = useMemo(() => [...stock].sort((a, b) => a.name.localeCompare(b.name)), [stock])

  async function add() {
    const title = name.trim()
    if (!title) return
    const lowAt = low.trim() === '' ? null : Math.max(0, Number(low))
    const row: ThingsStock = {
      id: newId(),
      name: title,
      unit: null,
      on_hand: (lowAt ?? 0) + 1,
      low_at: Number.isFinite(lowAt) ? lowAt : null,
      store_id: null,
      auto_add: true,
      shopping_item_id: null,
      sort_order: Date.now(),
      created_by: profileId,
      updated_by: profileId,
      created_at: nowIso(),
      updated_at: nowIso(),
    }
    fire('success')
    setName('')
    useData.getState().applyChange({ table: 'things_stock', type: 'insert', row })
    try {
      await useData.getState().adapter.insert('things_stock', row)
    } catch {
      useData.getState().applyChange({ table: 'things_stock', type: 'delete', id: row.id })
      toast.error("Couldn't add that")
    }
  }

  return (
    <Sheet open={open} onClose={onClose} title="Stock" height="80vh">
      <div className="flex h-full flex-col px-4 pb-4">
        <p className="pb-3 text-[13px] leading-snug" style={{ color: 'var(--text-dim)' }}>
          What you keep in the house. When a count drops to its low level, it goes on the shopping list by itself.
        </p>
        <div className="min-h-0 flex-1 overflow-y-auto">
          {rows.length === 0 ? (
            <p className="py-8 text-center text-[14px]" style={{ color: 'var(--text-faint)' }}>
              Nothing counted yet. Add something below, like paper towels or coffee.
            </p>
          ) : (
            rows.map((row) => (
              <StockRow key={row.id} row={row} storeName={stores.find((s) => s.id === row.store_id)?.name ?? null} />
            ))
          )}
        </div>
        <div className="flex gap-2 pt-3">
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && void add()}
            placeholder="Something to count"
            aria-label="Name of the thing to count"
            className="min-w-0 flex-1 rounded-xl px-3 py-2.5 text-[15px] outline-none placeholder:opacity-40"
            style={{ background: 'var(--surface-3)' }}
          />
          <input
            value={low}
            onChange={(e) => setLow(e.target.value.replace(/[^\d.]/g, ''))}
            inputMode="decimal"
            aria-label="Low at"
            title="Low at"
            className="w-16 rounded-xl px-2 py-2.5 text-center text-[15px] outline-none"
            style={{ background: 'var(--surface-3)' }}
          />
          <button
            onClick={() => void add()}
            disabled={!name.trim()}
            aria-label="Add to stock"
            className="grid h-11 w-11 shrink-0 place-items-center rounded-full text-white disabled:opacity-40"
            style={{ background: 'var(--accent)' }}
          >
            <Icon name="plus" size={18} strokeWidth={2.6} />
          </button>
        </div>
        <p className="pt-1.5 text-[11.5px]" style={{ color: 'var(--text-faint)' }}>
          The small box is the low level: at or below it, it goes on the list.
        </p>
      </div>
    </Sheet>
  )
}

function StockRow({ row, storeName }: { row: ThingsStock; storeName: string | null }) {
  const profileId = useProfile((s) => s.profileId)
  const low = isLow(row)

  async function patch(change: Partial<ThingsStock>) {
    const before = row
    const next = { ...row, ...change, updated_by: profileId, updated_at: nowIso() }
    useData.getState().applyChange({ table: 'things_stock', type: 'update', row: next })
    try {
      await useData.getState().adapter.update('things_stock', row.id, { ...change, updated_by: profileId })
    } catch {
      useData.getState().applyChange({ table: 'things_stock', type: 'update', row: before })
      toast.error("Couldn't save that")
    }
  }

  async function remove() {
    if (!window.confirm(`Stop counting ${row.name}?`)) return
    useData.getState().applyChange({ table: 'things_stock', type: 'delete', id: row.id })
    try {
      await useData.getState().adapter.remove('things_stock', row.id)
    } catch {
      useData.getState().applyChange({ table: 'things_stock', type: 'insert', row })
      toast.error("Couldn't remove that")
    }
  }

  return (
    <div className="flex items-center gap-2 py-2" style={{ borderBottom: '1px solid var(--border)' }}>
      <button onClick={() => void remove()} className="min-w-0 flex-1 text-left" aria-label={`${row.name}, tap to stop counting`}>
        <p className="truncate text-[15px] font-semibold">{row.name}</p>
        <p className="text-[12px]" style={{ color: low ? 'var(--danger)' : 'var(--text-faint)' }}>
          {low ? 'Low' : row.low_at === null ? 'Never added by itself' : `Low at ${row.low_at}`}
          {storeName ? ` · ${storeName}` : ''}
          {row.shopping_item_id ? ' · on the list' : ''}
        </p>
      </button>
      <CountButton label={`One less ${row.name}`} onClick={() => void patch({ on_hand: Math.max(0, row.on_hand - 1) })}>
        −
      </CountButton>
      <span className="w-9 text-center text-[17px] font-bold tabular-nums">{row.on_hand}</span>
      <CountButton label={`One more ${row.name}`} onClick={() => void patch({ on_hand: row.on_hand + 1 })}>
        +
      </CountButton>
    </div>
  )
}

function CountButton({ children, label, onClick }: { children: React.ReactNode; label: string; onClick: () => void }) {
  return (
    <button
      onClick={() => {
        fire('tap')
        onClick()
      }}
      aria-label={label}
      className="grid h-9 w-9 shrink-0 place-items-center rounded-full text-[20px] font-bold"
      style={{ background: 'var(--surface-3)' }}
    >
      {children}
    </button>
  )
}
