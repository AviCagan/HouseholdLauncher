import { motion } from 'motion/react'
import { useUI, type SortKey } from '@/store/useUI'
import { fire } from '@/lib/haptics'
import type { TabKey } from '@/data/types'

/**
 * The sort control every tab uses.
 *
 * Sized to fit without scrolling or wrapping — a filter row that reflows as
 * you use it makes the list below jump, and one that scrolls hides options
 * you didn't know were there. Labels are short for exactly that reason.
 *
 * Tapping the active sort flips its direction: one control, both jobs.
 */
export function SortBar({
  tab,
  options,
  trailing,
}: {
  tab: TabKey
  options: { key: SortKey; label: string }[]
  /** Tab-specific extras, e.g. the wishlist's whose-wish filter. */
  trailing?: React.ReactNode
}) {
  const sortBy = useUI((s) => s.sortBy[tab])
  const desc = useUI((s) => s.sortDesc[tab])
  const setSort = useUI((s) => s.setSort)
  const toggleDir = useUI((s) => s.toggleSortDir)

  return (
    <div className="flex items-center gap-1.5 px-1 pb-3">
      {options.map((o) => {
        const on = o.key === sortBy
        return (
          <button
            key={o.key}
            onClick={() => {
              fire('snap')
              if (on) toggleDir(tab)
              else setSort(tab, o.key)
            }}
            className="flex min-w-0 flex-1 items-center justify-center gap-1 rounded-full px-2 py-2 text-[12px] font-medium"
            style={{
              background: on ? 'var(--accent)' : 'var(--surface-2)',
              color: on ? '#fff' : 'var(--text-dim)',
            }}
          >
            <span className="truncate">{o.label}</span>
            {on && (
              <motion.span
                animate={{ rotate: desc ? 0 : 180 }}
                className="shrink-0 leading-none"
                aria-label={desc ? 'descending' : 'ascending'}
              >
                ↓
              </motion.span>
            )}
          </button>
        )
      })}
      {trailing}
    </div>
  )
}

/** Comparator shared by the list tabs. */
export function compareBy(
  key: SortKey,
  desc: boolean,
): (a: SortRow, b: SortRow) => number {
  const value = (r: SortRow): number => {
    switch (key) {
      case 'urgency':
        return r.urgency ?? 0
      case 'desire':
        return r.desire_level ?? 0
      case 'price':
        return r.price_cents ?? -1
      case 'recurring':
        // Recurring first; within those, soonest due leads.
        return r.is_recurring ? 1 : 0
      default:
        return r.sort_order ?? 0
    }
  }

  return (a, b) => {
    const diff = value(a) - value(b)
    if (diff !== 0) return desc ? -diff : diff

    // Recurring chores tie-break by when they're next due, so the group reads
    // as a schedule rather than an arbitrary pile.
    if (key === 'recurring' && a.is_recurring && b.is_recurring) {
      const at = a.next_due_at ? Date.parse(a.next_due_at) : 0
      const bt = b.next_due_at ? Date.parse(b.next_due_at) : 0
      if (at !== bt) return at - bt
    }
    return (b.sort_order ?? 0) - (a.sort_order ?? 0)
  }
}

export interface SortRow {
  urgency?: number
  desire_level?: number
  price_cents?: number | null
  is_recurring?: boolean
  next_due_at?: string | null
  sort_order?: number
}
