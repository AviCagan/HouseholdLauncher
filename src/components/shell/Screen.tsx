import { useState, type ReactNode } from 'react'
import { AnimatePresence, motion } from 'motion/react'
import { Icon } from '../primitives/Icon'
import { fire } from '@/lib/haptics'

/** Standard tab layout: sticky header, scrolling body, room for the dock. */
export function Screen({
  title,
  count,
  subtitle,
  action,
  children,
}: {
  title: string
  count?: number
  /** Sits under the title. Keeps wide values clear of the settings button. */
  subtitle?: ReactNode
  action?: ReactNode
  children: ReactNode
}) {
  return (
    <div className="flex h-full flex-col">
      {/* Reserves the lane occupied by the floating header rail so per-tab
          actions can never slide underneath it. The rail is two 36px buttons
          with an 8px gap, 16px from the right edge — 96px — plus a little
          breathing room. It was sized for one button, which is why the bell
          landed on top of Shopping's Plan trip button. */}
      <header className="shrink-0 pb-2 pl-5 pr-[104px] pt-3 safe-top">
        <div className="flex items-end justify-between gap-3">
          {/* min-w-0 so a long action keeps its own width and squeezes the
              title instead of wrapping itself onto two lines. */}
          <h1 className="min-w-0 truncate text-[27px] font-bold tracking-tight">
            {title}
            {count !== undefined && count > 0 && (
              <span className="ml-2 text-[16px] font-semibold" style={{ color: 'var(--text-faint)' }}>
                {count}
              </span>
            )}
          </h1>
          {action}
        </div>
        {subtitle && <div className="pt-0.5">{subtitle}</div>}
      </header>

      {/* Bottom padding clears the quick-add bar and the floating dock. */}
      <div className="scroll-y min-h-0 flex-1 px-3 pb-[205px]">{children}</div>
    </div>
  )
}

/** Collapsible group — used for Done, Resting, and per-store shopping groups. */
export function Section({
  label,
  count,
  children,
  defaultOpen = false,
  accent,
  icon,
}: {
  label: string
  count: number
  children: ReactNode
  defaultOpen?: boolean
  accent?: string
  icon?: ReactNode
}) {
  const [open, setOpen] = useState(defaultOpen)
  if (count === 0) return null

  return (
    <div className="mt-4">
      <button
        onClick={() => {
          fire('tap')
          setOpen((o) => !o)
        }}
        className="flex w-full items-center gap-2 px-2 py-2"
      >
        <motion.span animate={{ rotate: open ? 90 : 0 }} transition={{ duration: 0.18 }}>
          <Icon name="chevron" size={15} strokeWidth={2.6} />
        </motion.span>
        {icon}
        <span
          className="text-[13px] font-semibold uppercase tracking-wide"
          style={{ color: accent ?? 'var(--text-dim)' }}
        >
          {label}
        </span>
        <span className="text-[13px]" style={{ color: 'var(--text-faint)' }}>
          {count}
        </span>
      </button>

      <AnimatePresence initial={false}>
        {open && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.24, ease: [0.22, 1, 0.36, 1] }}
            className="overflow-hidden"
          >
            <div className="flex flex-col gap-2 pt-1">{children}</div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}

export function EmptyState({
  icon,
  title,
  hint,
}: {
  icon: ReactNode
  title: string
  hint: string
}) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      className="grid place-items-center gap-3 px-8 py-16 text-center"
    >
      <span style={{ color: 'var(--text-faint)', opacity: 0.5 }}>{icon}</span>
      <span className="text-[16px] font-semibold">{title}</span>
      <span className="max-w-[260px] text-[13px]" style={{ color: 'var(--text-faint)' }}>
        {hint}
      </span>
    </motion.div>
  )
}
