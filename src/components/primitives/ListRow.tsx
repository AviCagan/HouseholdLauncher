import type { ReactNode } from 'react'
import { motion } from 'motion/react'
import { SwipeRow } from './SwipeRow'
import { UrgencySpine } from './UrgencySpine'
import { ClaimChip } from './ClaimChip'
import { useUI } from '@/store/useUI'
import { fire } from '@/lib/haptics'
import type { Profile, Urgency } from '@/data/types'

/**
 * The shared row shape for to-dos, chores and shopping items — swipe to
 * complete, swipe to claim, long-press to edit everything about it.
 */
export function ListRow({
  table,
  id,
  title,
  urgency,
  claimedBy,
  profiles,
  done = false,
  meta,
  trailing,
  onComplete,
  onClaim,
  onTap,
}: {
  table: 'todos' | 'chores' | 'shopping_items'
  id: string
  title: string
  urgency: Urgency
  claimedBy: string | null
  profiles: Profile[]
  done?: boolean
  meta?: ReactNode
  trailing?: ReactNode
  onComplete: () => void
  onClaim: () => void
  onTap?: () => void
}) {
  const openSheet = useUI((s) => s.openSheet)

  return (
    <SwipeRow
      onComplete={onComplete}
      onClaim={onClaim}
      onTap={onTap}
      onLongPress={() => {
        fire('longPress')
        openSheet({ kind: 'item', table, id })
      }}
      claimLabel={
        <span className="text-[13px] font-medium" style={{ color: 'var(--text-dim)' }}>
          claim
        </span>
      }
    >
      <div className="relative flex items-center gap-3 py-3.5 pl-4 pr-3">
        <UrgencySpine urgency={urgency} />

        <button
          onClick={(e) => {
            e.stopPropagation()
            onComplete()
          }}
          aria-label={done ? 'Mark not done' : 'Mark done'}
          className="ml-1 grid h-[26px] w-[26px] shrink-0 place-items-center rounded-full"
          style={{
            border: `2px solid ${done ? 'var(--ok)' : 'var(--border-strong)'}`,
            background: done ? 'var(--ok)' : 'transparent',
            color: '#fff',
          }}
        >
          {done && (
            <motion.svg
              width={14}
              height={14}
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth={3.4}
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <motion.path
                d="M4 12.5 9 17.5 20 6.5"
                initial={{ pathLength: 0 }}
                animate={{ pathLength: 1 }}
                transition={{ duration: 0.22, ease: 'easeOut' }}
              />
            </motion.svg>
          )}
        </button>

        <div className="min-w-0 flex-1">
          <div
            className="truncate text-[15px] font-medium"
            style={{
              color: done ? 'var(--text-faint)' : 'var(--text)',
              textDecoration: done ? 'line-through' : 'none',
            }}
          >
            {title}
          </div>
          {meta && (
            <div className="mt-0.5 flex items-center gap-2 text-[12px]" style={{ color: 'var(--text-dim)' }}>
              {meta}
            </div>
          )}
        </div>

        {trailing}
        <ClaimChip claimedBy={claimedBy} profiles={profiles} onClick={onClaim} />
      </div>
    </SwipeRow>
  )
}
