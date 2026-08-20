import { useRef, useState, type ReactNode } from 'react'
import { motion } from 'motion/react'
import { Icon } from '../primitives/Icon'
import { URGENCY_META, type Urgency } from '@/data/types'
import { fire } from '@/lib/haptics'

/**
 * Always-visible add field, docked in thumb reach above the tab bar.
 *
 * Enter commits and *keeps focus*, so a run of items goes in without ever
 * reaching for the screen again. This is the "easy add" requirement.
 */

const URGENCY_COLORS: Record<Urgency, string> = {
  0: 'var(--u-low)',
  1: 'var(--u-med)',
  2: 'var(--u-urgent)',
}

export function QuickAdd({
  placeholder,
  onSubmit,
  leading,
  defaultUrgency = 1,
  showUrgency = true,
}: {
  placeholder: string
  onSubmit: (title: string, urgency: Urgency) => void | Promise<void>
  /** Extra control shown inside the field — the store chip on Shopping. */
  leading?: ReactNode
  defaultUrgency?: Urgency
  showUrgency?: boolean
}) {
  const [value, setValue] = useState('')
  const [urgency, setUrgency] = useState<Urgency>(defaultUrgency)
  const [focused, setFocused] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)

  function commit() {
    const title = value.trim()
    if (!title) return
    void onSubmit(title, urgency)
    setValue('')
    setUrgency(defaultUrgency)
    inputRef.current?.focus()
  }

  function cycleUrgency() {
    const next = ((urgency + 1) % 3) as Urgency
    setUrgency(next)
    fire('snap')
  }

  return (
    <div
      className="pointer-events-auto mx-3 flex items-center gap-2 rounded-full px-2 py-2"
      style={{
        background: 'var(--dock-bg)',
        backdropFilter: 'blur(20px) saturate(180%)',
        WebkitBackdropFilter: 'blur(20px) saturate(180%)',
        border: `1px solid ${focused ? 'var(--accent-muted)' : 'var(--border)'}`,
        boxShadow: 'var(--shadow-dock)',
        transition: 'border-color .18s ease',
      }}
    >
      {leading}

      {showUrgency && (
        <button
          onClick={cycleUrgency}
          aria-label={`Urgency: ${URGENCY_META[urgency].label}. Tap to change.`}
          className="grid h-8 w-8 shrink-0 place-items-center rounded-full"
          style={{
            background: `color-mix(in oklab, ${URGENCY_COLORS[urgency]} 22%, transparent)`,
            border: `1.5px solid ${URGENCY_COLORS[urgency]}`,
          }}
        >
          <motion.span
            key={urgency}
            initial={{ scale: 0.5, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            transition={{ type: 'spring', stiffness: 500, damping: 24 }}
            className="block rounded-full"
            style={{
              width: 5 + urgency * 3,
              height: 5 + urgency * 3,
              background: URGENCY_COLORS[urgency],
            }}
          />
        </button>
      )}

      <input
        ref={inputRef}
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault()
            commit()
          }
        }}
        placeholder={placeholder}
        enterKeyHint="done"
        className="min-w-0 flex-1 bg-transparent px-1 outline-none placeholder:text-[var(--text-faint)]"
      />

      <motion.button
        onClick={commit}
        aria-label="Add"
        animate={{
          scale: value.trim() ? 1 : 0.86,
          opacity: value.trim() ? 1 : 0.45,
        }}
        transition={{ type: 'spring', stiffness: 500, damping: 26 }}
        className="grid h-9 w-9 shrink-0 place-items-center rounded-full text-white"
        style={{ background: 'var(--accent)' }}
      >
        <Icon name="plus" size={19} strokeWidth={2.6} />
      </motion.button>
    </div>
  )
}
