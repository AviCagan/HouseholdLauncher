import { useEffect, useState } from 'react'
import { AnimatePresence, motion } from 'motion/react'
import { dataActions } from '@/store/useData'
import { fire } from '@/lib/haptics'
import { deadlineOptions } from '@/lib/deadline'

/**
 * Offers a deadline for the to-do you just added.
 *
 * Deliberately after the fact rather than a field in the add bar. Most to-dos
 * don't have a deadline, and quick-add exists to be fast — a required date
 * step would slow down the common case to serve the rare one. This appears
 * once the item is already saved, so ignoring it is a valid answer and costs
 * nothing: the item is on the list either way.
 *
 * It also times out on its own. A prompt that sits there forever becomes
 * another thing to dismiss, and the whole point is that "no deadline" should
 * take zero effort.
 */

const DISMISS_AFTER_MS = 6000

export function DeadlinePrompt({
  todoId,
  title,
  onDone,
}: {
  todoId: string
  title: string
  onDone: () => void
}) {
  const [options] = useState(() => deadlineOptions())

  useEffect(() => {
    const timer = setTimeout(onDone, DISMISS_AFTER_MS)
    return () => clearTimeout(timer)
  }, [todoId, onDone])

  return (
    <motion.div
      initial={{ opacity: 0, y: 12, height: 0 }}
      animate={{ opacity: 1, y: 0, height: 'auto' }}
      exit={{ opacity: 0, y: 12, height: 0 }}
      transition={{ duration: 0.2 }}
      /* The parent bar is pointer-events-none so taps fall through to the
         list; this panel has to opt back in. */
      className="pointer-events-auto mx-3 overflow-hidden"
    >
      <div
        className="flex flex-col gap-2 rounded-2xl p-2.5"
        style={{
          background: 'var(--dock-bg)',
          backdropFilter: 'blur(20px)',
          WebkitBackdropFilter: 'blur(20px)',
          border: '1px solid var(--border)',
        }}
      >
        <div className="flex items-baseline justify-between gap-2 px-1">
          <span className="min-w-0 truncate text-[12px]" style={{ color: 'var(--text-dim)' }}>
            Deadline for “{title}”?
          </span>
          <button
            onClick={() => {
              fire('tap')
              onDone()
            }}
            className="shrink-0 text-[12px]"
            style={{ color: 'var(--text-faint)' }}
          >
            No deadline
          </button>
        </div>

        <div className="flex flex-wrap gap-1.5">
          {options.map((o) => (
            <button
              key={o.key}
              onClick={() => {
                fire('success')
                void dataActions.patchRow('todos', todoId, { due_at: o.at })
                onDone()
              }}
              className="rounded-full px-3 py-1.5 text-[13px] font-medium"
              style={{ background: 'var(--surface-2)', color: 'var(--text)' }}
            >
              {o.label}
            </button>
          ))}
        </div>
      </div>
    </motion.div>
  )
}

/** Wraps the prompt so it animates out rather than vanishing. */
export function DeadlinePromptHost({
  pending,
  onDone,
}: {
  pending: { id: string; title: string } | null
  onDone: () => void
}) {
  return (
    <AnimatePresence>
      {pending && (
        <DeadlinePrompt
          key={pending.id}
          todoId={pending.id}
          title={pending.title}
          onDone={onDone}
        />
      )}
    </AnimatePresence>
  )
}
