import { useEffect, useState } from 'react'
import { AnimatePresence, motion } from 'motion/react'
import { useReduceMotion } from './ui'

/**
 * Hand-drawn things.
 *
 * Inline SVG with round caps and a slightly-off line so it reads as ink, not
 * as an icon. The pot's steam is the only thing that animates at rest, and it
 * is the empty state — the one screen with nothing else to look at.
 */

const ink = 'var(--m-line)'

export function PotDoodle({ size = 120 }: { size?: number }) {
  const reduce = useReduceMotion()
  return (
    <svg width={size} height={size} viewBox="0 0 120 120" fill="none" aria-hidden>
      {/* steam */}
      {[38, 60, 82].map((x, i) => (
        <path
          key={x}
          className={reduce ? '' : `m-steam m-steam-${i + 1}`}
          d={`M${x} 44 C ${x - 5} 36, ${x + 5} 30, ${x} 22`}
          stroke={ink}
          strokeWidth="3.5"
          strokeLinecap="round"
        />
      ))}
      {/* pot */}
      <path d="M22 58 H98 L92 100 Q60 108 28 100 Z" fill="var(--m-tomato)" stroke={ink} strokeWidth="4" strokeLinejoin="round" />
      <path d="M18 58 H102" stroke={ink} strokeWidth="4" strokeLinecap="round" />
      <path d="M10 66 L20 60 M110 66 L100 60" stroke={ink} strokeWidth="4" strokeLinecap="round" />
      {/* lid */}
      <path d="M30 52 Q60 40 90 52" fill="var(--m-butter)" stroke={ink} strokeWidth="4" strokeLinecap="round" />
      <circle cx="60" cy="42" r="4" fill={ink} />
      {/* face, because of course */}
      <circle cx="48" cy="76" r="3" fill={ink} />
      <circle cx="72" cy="76" r="3" fill={ink} />
      <path d="M52 86 Q60 92 68 86" stroke={ink} strokeWidth="3" strokeLinecap="round" />
    </svg>
  )
}

export function PlateDoodle({ size = 120 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 120 120" fill="none" aria-hidden>
      <ellipse cx="60" cy="64" rx="46" ry="36" fill="var(--m-card)" stroke={ink} strokeWidth="4" />
      <ellipse cx="60" cy="64" rx="30" ry="22" fill="var(--m-sky-soft)" stroke={ink} strokeWidth="3" />
      {/* fork and knife */}
      <path d="M12 30 v40 M8 30 v14 q4 6 8 0 v-14 M16 30 v14" stroke={ink} strokeWidth="3.5" strokeLinecap="round" />
      <path d="M108 30 v40 M108 30 q6 10 0 22" stroke={ink} strokeWidth="3.5" strokeLinecap="round" />
      {/* sparkles */}
      <path d="M30 18 l2 5 5 2 -5 2 -2 5 -2 -5 -5 -2 5 -2z" fill="var(--m-butter)" stroke={ink} strokeWidth="2" strokeLinejoin="round" />
      <path d="M92 14 l1.5 4 4 1.5 -4 1.5 -1.5 4 -1.5 -4 -4 -1.5 4 -1.5z" fill="var(--m-butter)" stroke={ink} strokeWidth="2" strokeLinejoin="round" />
    </svg>
  )
}

export function ClipboardDoodle({ size = 120 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 120 120" fill="none" aria-hidden>
      <rect x="26" y="22" width="68" height="84" rx="10" fill="var(--m-card)" stroke={ink} strokeWidth="4" />
      <rect x="44" y="14" width="32" height="16" rx="6" fill="var(--m-berry)" stroke={ink} strokeWidth="3.5" />
      {[46, 62, 78].map((y, i) => (
        <g key={y}>
          <rect x="38" y={y - 6} width="12" height="12" rx="3" fill={i < 2 ? 'var(--m-mint)' : 'var(--m-card-2)'} stroke={ink} strokeWidth="2.5" />
          {i < 2 && <path d={`M41 ${y} l3 3 5 -6`} stroke={ink} strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />}
          <path d={`M56 ${y} h26`} stroke={ink} strokeWidth="3.5" strokeLinecap="round" />
        </g>
      ))}
    </svg>
  )
}

/** A whisk that spins while an import is being fetched. */
export function WhiskSpinner({ size = 56 }: { size?: number }) {
  const reduce = useReduceMotion()
  return (
    <motion.svg
      width={size}
      height={size}
      viewBox="0 0 60 60"
      fill="none"
      aria-hidden
      animate={reduce ? undefined : { rotate: 360 }}
      transition={{ repeat: Infinity, duration: 1.1, ease: 'linear' }}
    >
      <path d="M30 6 v14" stroke={ink} strokeWidth="4" strokeLinecap="round" />
      <path d="M30 20 c-14 6 -14 26 0 34 c14 -8 14 -28 0 -34z" stroke={ink} strokeWidth="3.5" fill="var(--m-butter-soft)" />
      <path d="M30 20 c-6 8 -6 26 0 34 M30 20 c6 8 6 26 0 34" stroke={ink} strokeWidth="2.5" />
    </motion.svg>
  )
}

/**
 * A burst of food from where something was saved.
 *
 * Purely decorative and gated on reduce-motion: with it on, nothing renders
 * and the haptic carries the moment on its own. Mount with a changing `burst`
 * key to fire again.
 */
export function Confetti({ burst }: { burst: number }) {
  const reduce = useReduceMotion()
  const [pieces, setPieces] = useState<{ id: number; emoji: string; x: number; y: number; r: number }[]>([])

  useEffect(() => {
    if (!burst || reduce) return
    const emoji = ['🎉', '✨', '🥕', '🍅', '🧅', '🥦', '🍋', '⭐', '🍓', '🌶️']
    const next = Array.from({ length: 18 }, (_, i) => ({
      id: burst * 100 + i,
      emoji: emoji[i % emoji.length],
      x: (Math.random() - 0.5) * 320,
      y: -(80 + Math.random() * 220),
      r: (Math.random() - 0.5) * 540,
    }))
    setPieces(next)
    const t = setTimeout(() => setPieces([]), 1400)
    return () => clearTimeout(t)
  }, [burst, reduce])

  return (
    <div className="pointer-events-none fixed inset-x-0 bottom-[35%] z-[90] flex justify-center" aria-hidden>
      <AnimatePresence>
        {pieces.map((p) => (
          <motion.span
            key={p.id}
            className="absolute text-[26px]"
            initial={{ x: 0, y: 0, rotate: 0, opacity: 1, scale: 0.6 }}
            animate={{ x: p.x, y: p.y, rotate: p.r, opacity: 0, scale: 1.2 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 1.2, ease: [0.22, 1, 0.36, 1] }}
          >
            {p.emoji}
          </motion.span>
        ))}
      </AnimatePresence>
    </div>
  )
}
