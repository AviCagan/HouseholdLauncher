import { useRef, useState, type ReactNode } from 'react'
import { motion, useMotionValue, useTransform, animate } from 'motion/react'
import { Icon } from './Icon'
import { fire } from '@/lib/haptics'

/**
 * The row gesture used by every list in the app.
 *
 *   swipe right → complete     swipe left → claim/unclaim     long-press → menu
 *
 * `dragDirectionLock` is what stops this fighting the horizontal tab pager:
 * the first few pixels of movement decide who owns the gesture, and the choice
 * holds until release.
 */

const THRESHOLD = 0.4 // fraction of row width
const MAX_DRAG = 140

interface Props {
  children: ReactNode
  onComplete?: () => void
  onClaim?: () => void
  onLongPress?: () => void
  onTap?: () => void
  /** Right-swipe fill colour; defaults to the success green. */
  completeColor?: string
  claimLabel?: ReactNode
  disabled?: boolean
}

export function SwipeRow({
  children,
  onComplete,
  onClaim,
  onLongPress,
  onTap,
  completeColor = 'var(--ok)',
  claimLabel,
  disabled = false,
}: Props) {
  const x = useMotionValue(0)
  const ref = useRef<HTMLDivElement>(null)
  const pressTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const didLongPress = useRef(false)
  const crossed = useRef(false)
  const [width, setWidth] = useState(320)

  const threshold = width * THRESHOLD

  // The fill grows with the drag, so the row shows how far you are from
  // committing rather than snapping open at a fixed point.
  const completeFill = useTransform(x, [0, threshold], ['0%', '100%'])
  const claimOpacity = useTransform(x, [-threshold, -8, 0], [1, 0.25, 0])
  const checkScale = useTransform(x, [0, threshold * 0.7, threshold], [0.4, 0.7, 1])

  function measure() {
    const w = ref.current?.offsetWidth
    if (w && w !== width) setWidth(w)
  }

  function handleDrag(_: unknown, info: { offset: { x: number } }) {
    const past = Math.abs(info.offset.x) > threshold
    // Fire on each crossing in *either* direction, so backing out is felt too.
    if (past !== crossed.current) {
      crossed.current = past
      fire('swipeThreshold')
    }
  }

  function handleDragEnd(_: unknown, info: { offset: { x: number } }) {
    crossed.current = false
    const dx = info.offset.x

    if (dx > threshold && onComplete) {
      // Fly the row out before committing so the action feels causal.
      void animate(x, width, { type: 'spring', stiffness: 400, damping: 40 })
      onComplete()
      setTimeout(() => x.set(0), 260)
      return
    }
    if (dx < -threshold && onClaim) {
      onClaim()
    }
    void animate(x, 0, { type: 'spring', stiffness: 420, damping: 34 })
  }

  function startPress() {
    if (!onLongPress) return
    didLongPress.current = false
    pressTimer.current = setTimeout(() => {
      didLongPress.current = true
      fire('longPress')
      onLongPress()
    }, 450)
  }

  function endPress() {
    if (pressTimer.current) clearTimeout(pressTimer.current)
    pressTimer.current = null
  }

  return (
    <div
      ref={ref}
      onPointerEnter={measure}
      className="relative overflow-hidden rounded-[var(--radius)] no-select"
      /* The hairline matters most in OLED mode, where every surface is true
         black — without it a row has no edge against the page at all. */
      style={{ background: 'var(--surface-2)', border: '1px solid var(--border)' }}
    >
      {/* Right-swipe: completion fill + drawn checkmark */}
      <motion.div
        className="absolute inset-y-0 left-0 flex items-center pl-5"
        style={{ width: completeFill, background: completeColor }}
      >
        <motion.span style={{ scale: checkScale }} className="text-white">
          <Icon name="check" size={22} strokeWidth={3} />
        </motion.span>
      </motion.div>

      {/* Left-swipe: reveals who's claiming */}
      <motion.div
        className="absolute inset-y-0 right-0 flex items-center pr-5"
        style={{ opacity: claimOpacity }}
      >
        {claimLabel}
      </motion.div>

      <motion.div
        drag={disabled ? false : 'x'}
        dragDirectionLock
        dragConstraints={{ left: -MAX_DRAG, right: MAX_DRAG }}
        dragElastic={0.12}
        dragMomentum={false}
        style={{ x, background: 'var(--surface)', touchAction: 'pan-y' }}
        onDragStart={() => {
          endPress()
          fire('dragStart')
        }}
        onDrag={handleDrag}
        onDragEnd={handleDragEnd}
        onPointerDown={startPress}
        onPointerUp={endPress}
        onPointerCancel={endPress}
        onClick={() => {
          if (didLongPress.current) return
          onTap?.()
        }}
        className="relative cursor-pointer"
      >
        {children}
      </motion.div>
    </div>
  )
}
