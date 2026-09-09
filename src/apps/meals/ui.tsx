import { useState, type ReactNode } from 'react'
import { motion } from 'motion/react'
import { useSettings } from '@/store/useProfile'
import { fire } from '@/lib/haptics'
import type { DishKind } from '@/data/types'

/**
 * The building blocks of the Meals look, shared by every screen in it.
 *
 * They deliberately don't reuse the launcher's settings primitives: those are
 * flat and quiet, and this app is meant to feel like a sticker book. Every
 * piece here has an outline and a press, and most of them wobble.
 */

export const KIND_META: Record<DishKind, { label: string; emoji: string; soft: string; color: string }> = {
  main: { label: 'Main', emoji: '🍗', soft: 'var(--m-tomato-soft)', color: 'var(--m-tomato)' },
  side: { label: 'Side', emoji: '🥔', soft: 'var(--m-butter-soft)', color: 'var(--m-butter)' },
  soup: { label: 'Soup', emoji: '🍲', soft: 'var(--m-butter-soft)', color: '#f4a261' },
  salad: { label: 'Salad', emoji: '🥗', soft: 'var(--m-mint-soft)', color: 'var(--m-mint)' },
  bread: { label: 'Bread', emoji: '🍞', soft: 'var(--m-butter-soft)', color: '#e9b872' },
  dessert: { label: 'Dessert', emoji: '🍰', soft: 'var(--m-berry-soft)', color: 'var(--m-berry)' },
  drink: { label: 'Drink', emoji: '🥤', soft: 'var(--m-sky-soft)', color: 'var(--m-sky)' },
  snack: { label: 'Snack', emoji: '🍿', soft: 'var(--m-tomato-soft)', color: '#ffa8a8' },
  other: { label: 'Other', emoji: '✨', soft: 'var(--m-card-2)', color: 'var(--m-ink-faint)' },
}

export const OCCASION_META: Record<string, { label: string; emoji: string }> = {
  weeknight: { label: 'Weeknight', emoji: '🍝' },
  special: { label: 'Special', emoji: '✨' },
  shabbat: { label: 'Shabbat', emoji: '🕯️' },
  holiday: { label: 'Holiday', emoji: '🎉' },
  dinner: { label: 'Dinner', emoji: '🍽️' },
  brunch: { label: 'Brunch', emoji: '🥞' },
  lunch: { label: 'Lunch', emoji: '🥪' },
}

export const occasionLabel = (occasion: string): string =>
  OCCASION_META[occasion]?.label ?? occasion.charAt(0).toUpperCase() + occasion.slice(1)

export const occasionEmoji = (occasion: string): string => OCCASION_META[occasion]?.emoji ?? '🍽️'

export const FOOD_EMOJI = [
  '🍗', '🥩', '🐟', '🍲', '🥗', '🍞', '🥔', '🍚', '🍝', '🍕', '🌮', '🍛',
  '🍳', '🥞', '🧀', '🥪', '🥣', '🍯', '🍎', '🥕', '🥦', '🌽', '🍅', '🧅',
  '🍰', '🥧', '🍩', '🍪', '🍨', '🍫', '🍷', '🥤', '☕', '🫓', '🕯️', '✨',
]

/** The in-app reduce-motion switch, as a hook the decorative bits can read. */
export function useReduceMotion(): boolean {
  const settings = useSettings()
  if (settings?.reduce_motion) return true
  if (typeof window === 'undefined' || !window.matchMedia) return false
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches
}

/** The bouncy spring every card and sheet element arrives with. */
export const POP = { type: 'spring', stiffness: 520, damping: 26 } as const

export function MCard({
  children,
  onClick,
  className = '',
  style,
  tone,
  layout,
}: {
  children: ReactNode
  onClick?: () => void
  className?: string
  style?: React.CSSProperties
  /** Background colour of the card; defaults to paper white. */
  tone?: string
  layout?: boolean
}) {
  const Tag = onClick ? motion.button : motion.div
  return (
    <Tag
      layout={layout}
      onClick={
        onClick
          ? () => {
              fire('tap')
              onClick()
            }
          : undefined
      }
      initial={{ opacity: 0, scale: 0.86, y: 10 }}
      animate={{ opacity: 1, scale: 1, y: 0 }}
      exit={{ opacity: 0, scale: 0.9, y: 6 }}
      // The press-in nudge lives here rather than in CSS — see .m-card.
      whileTap={onClick ? { x: 3, y: 3 } : undefined}
      transition={POP}
      className={`m-card ${onClick ? 'm-press text-left' : ''} ${className}`}
      style={{ ...(tone ? { background: tone } : {}), ...style }}
    >
      {children}
    </Tag>
  )
}

export function Chip({
  children,
  active = false,
  color,
  onClick,
  small = false,
}: {
  children: ReactNode
  active?: boolean
  /** Fill when active; a soft tint of it when not. */
  color?: string
  onClick?: () => void
  small?: boolean
}) {
  const Tag = onClick ? 'button' : 'span'
  return (
    <Tag
      onClick={
        onClick
          ? () => {
              fire('snap')
              onClick()
            }
          : undefined
      }
      className="m-chip"
      style={{
        background: active ? (color ?? 'var(--m-tomato)') : 'var(--m-card)',
        color: active ? '#fff' : 'var(--m-ink)',
        borderColor: active ? (color ?? 'var(--m-tomato)') : 'var(--m-line)',
        ...(small ? { padding: '3px 9px', fontSize: 11.5 } : {}),
      }}
    >
      {children}
    </Tag>
  )
}

export function Field({
  label,
  hint,
  children,
  right,
}: {
  label: string
  hint?: string
  children: ReactNode
  right?: ReactNode
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-baseline justify-between px-0.5">
        <span className="text-[12px] font-extrabold uppercase tracking-wide" style={{ color: 'var(--m-ink-dim)' }}>
          {label}
        </span>
        {right}
      </div>
      {children}
      {hint && (
        <span className="px-0.5 text-[11.5px]" style={{ color: 'var(--m-ink-faint)' }}>
          {hint}
        </span>
      )}
    </div>
  )
}

/**
 * Full width unless the caller sized it.
 *
 * Decided here rather than in CSS on purpose: `.m-input { width: 100% }` and a
 * `w-[92px]` utility are a cascade-order fight, and which one wins depends on
 * how the bundler happened to order two stylesheets. A class list has no such
 * ambiguity.
 */
const withWidth = (className = '') => (/\bw-/.test(className) ? className : `w-full ${className}`)

export function TextInput(props: React.InputHTMLAttributes<HTMLInputElement>) {
  return <input {...props} className={`m-input ${withWidth(props.className)}`} />
}

export function TextArea(props: React.TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return (
    <textarea
      {...props}
      className={`m-input resize-none ${withWidth(props.className)}`}
      style={{ lineHeight: 1.4, ...props.style }}
    />
  )
}

/** −  4  + */
export function Stepper({
  value,
  onChange,
  min = 1,
  max = 99,
  suffix,
}: {
  value: number
  onChange: (next: number) => void
  min?: number
  max?: number
  suffix?: string
}) {
  const bump = (delta: number) => {
    const next = Math.min(max, Math.max(min, value + delta))
    if (next === value) return
    fire('snap')
    onChange(next)
  }
  const Btn = ({ label, delta }: { label: string; delta: number }) => (
    <motion.button
      whileTap={{ scale: 0.85 }}
      onClick={() => bump(delta)}
      aria-label={delta > 0 ? 'More' : 'Fewer'}
      className="grid h-9 w-9 place-items-center rounded-full text-[18px] font-black"
      style={{ border: '2px solid var(--m-line)', background: 'var(--m-card)', color: 'var(--m-ink)' }}
    >
      {label}
    </motion.button>
  )
  return (
    <div className="inline-flex items-center gap-2">
      <Btn label="−" delta={-1} />
      <span className="min-w-[44px] text-center text-[17px] font-black tabular-nums">
        {value}
        {suffix && (
          <span className="ml-1 text-[12px] font-bold" style={{ color: 'var(--m-ink-dim)' }}>
            {suffix}
          </span>
        )}
      </span>
      <Btn label="+" delta={1} />
    </div>
  )
}

/**
 * Pick an emoji, or type one.
 *
 * A row of likely food, a chosen one in the middle that wobbles when it
 * changes, and a text field for anything not in the row. The keyboard's own
 * emoji picker is the real picker; this is the shortcut.
 */
export function EmojiPicker({ value, onChange }: { value: string; onChange: (e: string) => void }) {
  const [wobbleKey, setWobbleKey] = useState(0)
  const reduce = useReduceMotion()
  const pick = (e: string) => {
    fire('snap')
    onChange(e)
    setWobbleKey((k) => k + 1)
  }
  return (
    <div className="flex items-center gap-3">
      <span
        key={wobbleKey}
        className={`grid h-16 w-16 shrink-0 place-items-center rounded-[20px] text-[36px] ${reduce ? '' : 'm-wobble'}`}
        style={{ border: '2.5px solid var(--m-line)', background: 'var(--m-card-2)', boxShadow: 'var(--m-shadow-sm)' }}
        aria-label="Chosen emoji"
      >
        {value || '🍽️'}
      </span>
      <div className="min-w-0 flex-1">
        <div className="scroll-x -mx-1 flex gap-1 px-1 pb-1">
          {FOOD_EMOJI.map((e) => (
            <button
              key={e}
              onClick={() => pick(e)}
              className="grid h-9 w-9 shrink-0 place-items-center rounded-xl text-[20px]"
              style={{
                border: '2px solid',
                borderColor: e === value ? 'var(--m-tomato)' : 'transparent',
                background: e === value ? 'var(--m-tomato-soft)' : 'transparent',
              }}
              aria-label={`Use ${e}`}
            >
              {e}
            </button>
          ))}
        </div>
        <input
          value={value}
          onChange={(e) => onChange(e.target.value.slice(-2))}
          placeholder="or type any emoji"
          aria-label="Emoji"
          className="m-input mt-1 w-full !py-1.5 !text-[13px]"
        />
      </div>
    </div>
  )
}

export function BigButton({
  children,
  onClick,
  tone = 'var(--m-tomato)',
  ink = '#fff',
  disabled = false,
  busy = false,
  className = '',
}: {
  children: ReactNode
  onClick: () => void
  tone?: string
  ink?: string
  disabled?: boolean
  busy?: boolean
  className?: string
}) {
  return (
    <motion.button
      whileTap={disabled ? undefined : { x: 3, y: 3 }}
      onClick={onClick}
      disabled={disabled || busy}
      className={`m-card m-press w-full py-3.5 text-[15px] font-black disabled:opacity-50 ${className}`}
      style={{ background: tone, color: ink, borderRadius: 18 }}
    >
      {busy ? 'One sec…' : children}
    </motion.button>
  )
}

/** A soft pill with a number in it: "$18" or "420 kcal". */
export function Stat({ children, tone = 'var(--m-butter-soft)' }: { children: ReactNode; tone?: string }) {
  return (
    <span
      className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11.5px] font-extrabold tabular-nums"
      style={{ background: tone, color: 'var(--m-ink)' }}
    >
      {children}
    </span>
  )
}

/** Section heading with a little doodled underline. */
export function Heading({ children, right }: { children: ReactNode; right?: ReactNode }) {
  return (
    <div className="flex items-end justify-between px-1 pb-2 pt-3">
      <span className="relative inline-block">
        <span className="m-title text-[17px]">{children}</span>
        <svg
          className="absolute -bottom-1 left-0 w-full"
          height="6"
          viewBox="0 0 100 6"
          preserveAspectRatio="none"
          aria-hidden
        >
          <path d="M1 4 Q 12 1, 24 4 T 48 4 T 72 4 T 99 4" fill="none" stroke="var(--m-tomato)" strokeWidth="2.5" strokeLinecap="round" />
        </svg>
      </span>
      {right}
    </div>
  )
}
