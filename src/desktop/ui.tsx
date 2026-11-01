import type { ReactNode } from 'react'
import { Icon, type IconName } from '@/components/primitives/Icon'
import { comboKeys, comboLabel } from './keys'

/**
 * Small pieces every laptop screen shares. The apps keep their own looks —
 * graph paper, sticker book, dictionary, television — so these stay plain and
 * read their colours from whatever theme tokens they are rendered inside.
 */

/** A key, drawn as a key. Several steps render as "G then T". */
export function Kbd({ combo, className = '' }: { combo: string; className?: string }) {
  const steps = comboKeys(combo)
  return (
    <span className={`inline-flex items-center gap-1 ${className}`} aria-label={comboLabel(combo)}>
      {steps.map((parts, i) => (
        <span key={i} className="inline-flex items-center gap-0.5">
          {i > 0 && <span className="desk-kbd-then">then</span>}
          {parts.map((p, j) => (
            <kbd key={j} className="desk-kbd">
              {p}
            </kbd>
          ))}
        </span>
      ))}
    </span>
  )
}

/**
 * An icon button with a tooltip that names its shortcut, so the keyboard is
 * learned by hovering rather than by reading a manual.
 */
export function ToolButton({
  icon,
  label,
  combo,
  onClick,
  active = false,
  disabled = false,
  badge,
  children,
  className = '',
  tone,
}: {
  icon?: IconName
  label: string
  combo?: string
  onClick: () => void
  active?: boolean
  disabled?: boolean
  badge?: number
  children?: ReactNode
  className?: string
  /** Fill colour for a primary action. */
  tone?: string
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-label={label}
      aria-pressed={active || undefined}
      title={combo ? `${label} (${comboLabel(combo)})` : label}
      className={`desk-tool relative inline-flex h-9 shrink-0 items-center justify-center gap-1.5 rounded-xl text-[13px] font-semibold disabled:opacity-40 ${
        children ? 'px-3' : 'w-9'
      } ${className}`}
      data-active={active || undefined}
      style={tone ? { background: tone, color: '#fff', borderColor: 'transparent' } : undefined}
    >
      {icon && <Icon name={icon} size={16} strokeWidth={2.2} />}
      {children}
      {badge !== undefined && badge > 0 && (
        <span
          className="absolute -right-1.5 -top-1.5 grid h-[18px] min-w-[18px] place-items-center rounded-full px-1 text-[10px] font-bold text-white"
          style={{ background: 'var(--danger)', border: '2px solid var(--bg)' }}
        >
          {badge > 99 ? '99+' : badge}
        </span>
      )}
    </button>
  )
}

/** A centred, empty-state message for a pane with nothing in it. */
export function Blank({ icon, title, hint, action }: { icon: IconName; title: string; hint?: string; action?: ReactNode }) {
  return (
    <div className="flex h-full min-h-[240px] flex-col items-center justify-center gap-3 px-8 text-center">
      <span style={{ color: 'var(--text-faint)', opacity: 0.55 }}>
        <Icon name={icon} size={34} />
      </span>
      <span className="text-[16px] font-semibold">{title}</span>
      {hint && (
        <span className="max-w-[340px] text-[13px]" style={{ color: 'var(--text-faint)' }}>
          {hint}
        </span>
      )}
      {action}
    </div>
  )
}
