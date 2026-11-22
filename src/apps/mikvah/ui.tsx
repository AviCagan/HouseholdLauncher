import type { ButtonHTMLAttributes, ReactNode } from 'react'
import { Icon } from '@/components/primitives/Icon'
import { fire } from '@/lib/haptics'
import { why } from './store'
import { S } from './strings'

/** "onah beinonit" → "Onah beinonit", for a name at the start of a line. */
export const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1)

/** A status or overlay: picks the colour from mikvah.css. */
export type Tone = 'waiting' | 'counting' | 'after_seven' | 'mikvah' | 'tehorah' | 'none' | 'onah' | 'sep' | 'ask'

export function Card({ children, tone, className = '', onClick }: { children: ReactNode; tone?: Tone; className?: string; onClick?: () => void }) {
  const cls = `mk-card ${tone ? `mk-tone-${tone} mk-toned` : ''} ${className}`
  if (onClick) {
    // A div, not a button: a card holds its own "Why?" button, and buttons don't nest.
    const go = () => {
      fire('tap')
      onClick()
    }
    return (
      <div
        role="button"
        tabIndex={0}
        onClick={go}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault()
            go()
          }
        }}
        className={`${cls} block w-full cursor-pointer p-4 text-left`}
      >
        {children}
      </div>
    )
  }
  return <div className={`${cls} p-4`}>{children}</div>
}

/** "Why?" — opens the rule and its sources. Every date and status has one. */
export function Why({ ruleId, label = S.why, note }: { ruleId: string; label?: string; note?: string }) {
  return (
    <button
      type="button"
      className="mk-why shrink-0"
      onClick={(e) => {
        e.stopPropagation()
        fire('tap')
        why(ruleId, note)
      }}
      aria-label={`${label} (${ruleId})`}
    >
      <Icon name="book" size={12} />
      {label}
    </button>
  )
}

export function Btn({
  kind = 'plain',
  tone,
  className = '',
  children,
  onClick,
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & { kind?: 'plain' | 'primary' | 'toned' | 'danger'; tone?: Tone }) {
  return (
    <button
      type="button"
      {...rest}
      onClick={(e) => {
        fire('tap')
        onClick?.(e)
      }}
      className={`mk-btn ${kind !== 'plain' ? `mk-btn-${kind}` : ''} ${tone ? `mk-tone-${tone}` : ''} ${className}`}
    >
      {children}
    </button>
  )
}

export function Section({ title, children, right }: { title: string; children: ReactNode; right?: ReactNode }) {
  return (
    <section className="mt-6">
      <div className="mb-2 flex items-center gap-2 px-1">
        <h2 className="mk-label flex-1 uppercase">{title}</h2>
        {right}
      </div>
      <div className="flex flex-col gap-2">{children}</div>
    </section>
  )
}

export function Field({ label, children, hint }: { label: string; children: ReactNode; hint?: string }) {
  return (
    <label className="flex flex-col gap-1.5">
      <span className="mk-label">{label}</span>
      {children}
      {hint && <span className="mk-faint text-[12px] leading-snug">{hint}</span>}
    </label>
  )
}

/** A choice between a few values, as a row of buttons. */
export function Choice<T extends string>({
  value,
  options,
  onChange,
  tone,
}: {
  value: T | null
  options: { value: T; label: string }[]
  onChange: (v: T) => void
  tone?: Tone
}) {
  return (
    <div className="flex flex-wrap gap-2" role="radiogroup">
      {options.map((o) => {
        const on = o.value === value
        return (
          <button
            key={o.value}
            type="button"
            role="radio"
            aria-checked={on}
            onClick={() => {
              fire('tap')
              onChange(o.value)
            }}
            className={`mk-btn ${on ? `mk-btn-toned mk-tone-${tone ?? 'mikvah'}` : ''} text-[13.5px]`}
            style={on ? { boxShadow: 'inset 0 0 0 1.5px var(--tone)' } : undefined}
          >
            {o.label}
          </button>
        )
      })}
    </div>
  )
}

export function Toggle({ on, onChange, label, hint }: { on: boolean; onChange: (v: boolean) => void; label: string; hint?: string }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      onClick={() => {
        fire('tap')
        onChange(!on)
      }}
      className="flex w-full items-center gap-3 py-2 text-left"
    >
      <span className="min-w-0 flex-1">
        <span className="block text-[14.5px] font-medium">{label}</span>
        {hint && <span className="mk-faint block text-[12px] leading-snug">{hint}</span>}
      </span>
      <span
        aria-hidden
        className="relative h-7 w-12 shrink-0 rounded-full transition-colors"
        style={{ background: on ? 'var(--accent)' : 'var(--surface-3)' }}
      >
        <span
          className="absolute top-0.5 h-6 w-6 rounded-full bg-white shadow transition-[left]"
          style={{ left: on ? 22 : 2 }}
        />
      </span>
    </button>
  )
}

export function AskBadge() {
  return (
    <span className="mk-tone-ask mk-tone-text inline-flex items-center gap-1 text-[11.5px] font-bold uppercase tracking-wide">
      <Icon name="people" size={12} />
      {S.askRav}
    </span>
  )
}

export function Dot({ tone }: { tone: Tone }) {
  return <span aria-hidden className={`mk-tone-${tone} mk-tone-dot inline-block h-2.5 w-2.5 shrink-0 rounded-full`} />
}

export function Row({ children, onClick }: { children: ReactNode; onClick?: () => void }) {
  return (
    <button
      type="button"
      onClick={() => {
        fire('tap')
        onClick?.()
      }}
      className="mk-card flex w-full items-center gap-3 px-4 py-3 text-left"
    >
      {children}
      <Icon name="chevron" size={16} />
    </button>
  )
}
