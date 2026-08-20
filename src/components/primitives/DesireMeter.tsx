import { useRef } from 'react'
import { motion } from 'motion/react'
import { DESIRE_META, type Desire } from '@/data/types'
import { fire } from '@/lib/haptics'

export const DESIRE_COLOR: Record<Desire, string> = {
  1: '#64748b',
  2: '#3aa0ff',
  3: 'var(--accent)',
  4: '#f5a524',
  5: '#ff4d4d',
}

/**
 * How badly you want something.
 *
 * Tap steps up and wraps, which is fine for nudging. Dragging is the real
 * control: hold and slide up or down and the level follows your thumb, with a
 * tick at each step. Five levels is too many to reach by tapping through.
 */
export function DesireMeter({
  value,
  onChange,
  size = 'md',
  showLabel = false,
}: {
  value: Desire
  onChange: (next: Desire) => void
  size?: 'sm' | 'md'
  showLabel?: boolean
}) {
  const startY = useRef(0)
  const startValue = useRef<Desire>(value)
  const dragged = useRef(false)
  const lastValue = useRef<Desire>(value)
  /**
   * Whether a drag is actually in progress.
   *
   * Without this, a pointermove arriving before any pointerdown — a hover, or
   * the move that precedes a tap — measured its delta against the initial ref
   * of 0 and slammed the value to the bottom of the range. The drag then
   * started from that corrupted value and climbed back, so a deliberate swipe
   * appeared to do nothing at all.
   */
  const active = useRef(false)

  const barW = size === 'sm' ? 3 : 5
  const step = size === 'sm' ? 2 : 2.5
  const base = size === 'sm' ? 5 : 5
  /** Pixels of travel per level. Small enough to reach 1→5 in one thumb move. */
  const PX_PER_LEVEL = 18

  function apply(clientY: number) {
    const delta = startY.current - clientY
    const levels = Math.round(delta / PX_PER_LEVEL)
    const next = Math.min(5, Math.max(1, startValue.current + levels)) as Desire
    if (next === lastValue.current) return
    lastValue.current = next
    fire('snap')
    onChange(next)
  }

  return (
    <button
      type="button"
      aria-label={`Want level: ${DESIRE_META[value].label}. Tap to step up, or drag up and down.`}
      className="flex flex-col items-start gap-1"
      style={{ touchAction: 'none' }}
      onPointerDown={(e) => {
        e.stopPropagation()
        active.current = true
        startY.current = e.clientY
        startValue.current = value
        lastValue.current = value
        dragged.current = false
        e.currentTarget.setPointerCapture(e.pointerId)
      }}
      onPointerMove={(e) => {
        if (!active.current) return
        if (Math.abs(e.clientY - startY.current) > 6) dragged.current = true
        if (dragged.current) apply(e.clientY)
      }}
      onPointerUp={(e) => {
        active.current = false
        e.currentTarget.releasePointerCapture(e.pointerId)
        // A tap that never moved steps up instead — dragging and tapping
        // share the control without either getting in the other's way.
        if (!dragged.current) {
          fire('snap')
          onChange(((value % 5) + 1) as Desire)
        }
      }}
      onPointerCancel={() => {
        active.current = false
        dragged.current = false
      }}
      onClick={(e) => e.stopPropagation()}
    >
      <span className="flex items-end gap-[3px]">
        {([1, 2, 3, 4, 5] as Desire[]).map((n) => (
          <motion.span
            key={n}
            animate={{ height: base + n * step }}
            transition={{ type: 'spring', stiffness: 520, damping: 30 }}
            className="block rounded-full"
            style={{
              width: barW,
              background: n <= value ? DESIRE_COLOR[value] : 'var(--surface-3)',
            }}
          />
        ))}
      </span>
      {showLabel && (
        <span className="text-[10px] font-medium" style={{ color: 'var(--text-faint)' }}>
          {DESIRE_META[value].label}
        </span>
      )}
    </button>
  )
}
