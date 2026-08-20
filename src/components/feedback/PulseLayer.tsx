import { useEffect, useState } from 'react'
import { AnimatePresence, motion } from 'motion/react'
import type { HapticEventName } from '@/data/types'
import { setFeedbackSinks } from '@/lib/haptics'
import { play, unlockAudio } from '@/lib/sound'

/**
 * The visual half of the feedback channel.
 *
 * On Avi's APK this reinforces a real haptic. On Jackie's iPhone it *is* the
 * feedback, because iOS Safari has no vibration API at all — so it has to read
 * as deliberate design rather than as a missing feature.
 *
 * It hooks the same `fire()` call the haptics use, which keeps the two
 * automatically in sync everywhere without per-component wiring.
 */

interface Ripple {
  id: number
  x: number
  y: number
  event: HapticEventName
}

/** Tuned per event so `complete` doesn't feel like `delete`. */
const STYLE: Record<
  string,
  { size: number; color: string; ring: boolean; duration: number }
> = {
  complete: { size: 220, color: 'var(--ok)', ring: true, duration: 0.55 },
  success: { size: 220, color: 'var(--ok)', ring: true, duration: 0.55 },
  claim: { size: 180, color: 'var(--accent)', ring: true, duration: 0.5 },
  delete: { size: 200, color: 'var(--danger)', ring: false, duration: 0.4 },
  error: { size: 240, color: 'var(--danger)', ring: true, duration: 0.5 },
  warning: { size: 200, color: 'var(--warn)', ring: true, duration: 0.45 },
  longPress: { size: 160, color: 'var(--accent)', ring: false, duration: 0.4 },
  toggleOn: { size: 120, color: 'var(--accent)', ring: false, duration: 0.35 },
  swipeThreshold: { size: 110, color: 'var(--accent)', ring: false, duration: 0.3 },
  default: { size: 90, color: 'var(--accent)', ring: false, duration: 0.28 },
}

/** Events too frequent to flash — a ripple on every drag tick is noise. */
const SILENT = new Set<HapticEventName>(['snap', 'dragStart', 'tap', 'toggleOff'])

let pointer = { x: 0, y: 0 }

export function PulseLayer() {
  const [ripples, setRipples] = useState<Ripple[]>([])

  useEffect(() => {
    let seq = 0

    const track = (e: PointerEvent) => {
      pointer = { x: e.clientX, y: e.clientY }
      // iOS suspends AudioContext until a gesture; this is that gesture.
      unlockAudio()
    }
    window.addEventListener('pointerdown', track, { passive: true })

    setFeedbackSinks({
      pulse: (event) => {
        if (SILENT.has(event)) return
        const id = ++seq
        const r: Ripple = { id, x: pointer.x, y: pointer.y, event }
        setRipples((prev) => [...prev.slice(-4), r])
        setTimeout(() => {
          setRipples((prev) => prev.filter((p) => p.id !== id))
        }, 700)
      },
      sound: (event) => play(event),
    })

    return () => window.removeEventListener('pointerdown', track)
  }, [])

  return (
    <div className="pointer-events-none fixed inset-0 z-[100] overflow-hidden">
      <AnimatePresence>
        {ripples.map((r) => {
          const s = STYLE[r.event] ?? STYLE.default
          return (
            <motion.span
              key={r.id}
              initial={{ opacity: 0.45, scale: 0.2 }}
              animate={{ opacity: 0, scale: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: s.duration, ease: [0.22, 1, 0.36, 1] }}
              style={{
                position: 'absolute',
                left: r.x - s.size / 2,
                top: r.y - s.size / 2,
                width: s.size,
                height: s.size,
                borderRadius: '50%',
                background: s.ring
                  ? `radial-gradient(circle, transparent 55%, ${s.color} 70%, transparent 78%)`
                  : `radial-gradient(circle, ${s.color} 0%, transparent 68%)`,
              }}
            />
          )
        })}
      </AnimatePresence>
    </div>
  )
}
