import { useEffect, useRef, useState } from 'react'
import { animate, motion, useMotionValue, useTransform } from 'motion/react'
import { Icon } from './Icon'
import { fire } from '@/lib/haptics'

/**
 * A short drag track that commits an action only when pulled all the way.
 *
 * Deliberately NOT SwipeRow. SwipeRow drags the whole row and fires at 40% of
 * its width, which is right for ticking off a to-do and wrong for marking a
 * debt settled: an accidental flick would rewrite money owed, and the undo for
 * that is a conversation with a person. So the grabbable area is a small
 * handle at the end of the row, the row itself never moves, and nothing
 * happens until the handle reaches the far end.
 *
 * The feel is a zipper. Detents are evenly spaced along the track and a tick
 * fires as each one is crossed — in both directions, so backing off feels like
 * teeth releasing rather than silence.
 */

/** Teeth per pull. Enough to read as a texture, few enough to stay distinct. */
const DETENTS = 14

/** Fraction of the track that counts as pulled home. */
const COMMIT = 0.92

interface Props {
  /** Runs once the handle is dragged the full width of the track. */
  onCommit: () => void
  label?: string
  /** Track colour once committed. */
  color?: string
  width?: number
  disabled?: boolean
}

export function ZipperSwipe({
  onCommit,
  label = 'Paid',
  color = 'var(--ok)',
  width = 92,
  disabled = false,
}: Props) {
  const x = useMotionValue(0)
  const [committed, setCommitted] = useState(false)
  const lastDetent = useRef(0)

  // The handle is inset from both ends of the track, so travel is the track
  // minus the handle rather than the full width — without this the handle
  // overhangs the rounded end and never visually "arrives".
  const HANDLE = 30
  const travel = Math.max(width - HANDLE - 6, 24)

  const fill = useTransform(x, [0, travel], ['0%', '100%'])
  const labelOpacity = useTransform(x, [0, travel * 0.55], [1, 0])
  const iconOpacity = useTransform(x, [travel * 0.45, travel * 0.9], [0, 1])

  /*
    Detent ticks are driven from a motion-value subscription rather than the
    drag handler.

    `onDrag` fires per pointer event, which on a fast flick can jump most of
    the track in one callback — sample there and a quick pull produces two or
    three ticks instead of fourteen, so the gesture feels smooth exactly when
    it should feel most textured. Subscribing to `x` reports every frame the
    value actually took, including the ones the pointer skipped.
  */
  useEffect(() => {
    const stop = x.on('change', (value) => {
      const detent = Math.round((value / travel) * DETENTS)
      if (detent !== lastDetent.current && detent >= 0 && detent <= DETENTS) {
        lastDetent.current = detent
        if (!committed) fire('zipperTick')
      }
    })
    return () => stop()
  }, [x, travel, committed])

  function release() {
    if (x.get() >= travel * COMMIT) {
      setCommitted(true)
      // Snap the last few pixels home before the row leaves, so the gesture
      // visibly completes rather than being cut off by the exit animation.
      animate(x, travel, { type: 'spring', stiffness: 700, damping: 40 })
      fire('zipperDone')
      onCommit()
      return
    }
    // Not far enough: spring back. Ticks keep firing on the way, which is the
    // zipper falling open again.
    animate(x, 0, { type: 'spring', stiffness: 500, damping: 34 })
  }

  return (
    <div
      className="relative shrink-0 overflow-hidden rounded-full"
      style={{
        width,
        height: 34,
        background: 'var(--surface-3)',
        border: '1px solid var(--border)',
        opacity: disabled ? 0.4 : 1,
      }}
      // The row underneath opens an edit sheet on tap. Without this, every
      // pull that starts or ends slightly off the handle also opens it.
      onClick={(e) => e.stopPropagation()}
      onPointerDown={(e) => e.stopPropagation()}
    >
      <motion.div
        className="absolute inset-y-0 left-0"
        style={{ width: fill, background: color, opacity: 0.9 }}
      />

      <motion.span
        className="pointer-events-none absolute inset-0 grid place-items-center text-[11px] font-semibold uppercase tracking-wide"
        style={{ opacity: labelOpacity, color: 'var(--text-faint)', paddingLeft: HANDLE }}
      >
        {label}
      </motion.span>

      <motion.span
        className="pointer-events-none absolute inset-0 grid place-items-center"
        style={{ opacity: iconOpacity, color: '#fff' }}
      >
        <Icon name="check" size={16} strokeWidth={3} />
      </motion.span>

      <motion.div
        drag={disabled ? false : 'x'}
        dragConstraints={{ left: 0, right: travel }}
        // No elastic: a handle that stretches past the end suggests there is
        // more pull available, and the commit point is meant to be the end.
        dragElastic={0}
        dragMomentum={false}
        // Owns the gesture outright — the launcher's own screens sit inside
        // scrollable lists, and without this a pull that drifts vertically
        // hands over to the scroller mid-zip.
        onDragStart={() => fire('dragStart')}
        onDragEnd={release}
        style={{ x, touchAction: 'none' }}
        className="absolute top-[2px] grid cursor-grab place-items-center rounded-full active:cursor-grabbing"
      >
        <span
          className="grid place-items-center rounded-full"
          style={{
            width: HANDLE,
            height: HANDLE - 2,
            background: 'var(--surface)',
            border: '1px solid var(--border)',
            color: committed ? color : 'var(--text-dim)',
            boxShadow: '0 1px 3px rgb(0 0 0 / 0.3)',
          }}
        >
          <Icon name="chevron" size={15} strokeWidth={2.8} />
        </span>
      </motion.div>
    </div>
  )
}
