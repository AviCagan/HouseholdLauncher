import type { CSSProperties, ReactNode } from 'react'
import { toast } from 'sonner'
import { copyToClipboard } from '@/apps/things/routing/deeplink'
import { fire } from '@/lib/haptics'
import { chipText, type Countdown, type CountdownFinished, type DueStatus } from './dates'

/** The building blocks every tab is made of. Styles are in medschool.css. */

export function Panel({
  title,
  action,
  edge,
  rez = 0,
  className = '',
  children,
}: {
  title?: ReactNode
  action?: ReactNode
  edge?: 'live' | 'warn'
  /** Order in the first-open rez-in. */
  rez?: number
  className?: string
  children: ReactNode
}) {
  return (
    <section className={`lg-panel lg-rez px-4 pb-4 pt-3 ${className}`} data-edge={edge} style={{ '--rez-i': rez } as CSSProperties}>
      {(title || action) && (
        <header className="flex min-h-[36px] items-center gap-2 pb-2">
          {title && <h2 className="lg-label min-w-0 flex-1 truncate">{title}</h2>}
          {action}
        </header>
      )}
      {children}
    </section>
  )
}

export function Chip({ tone, children, title }: { tone?: 'live' | 'warn' | 'ok' | 'solid'; children: ReactNode; title?: string }) {
  return (
    <span className="lg-chip" data-tone={tone} title={title}>
      {children}
    </span>
  )
}

/** `3d late`, `today`, `in 5d` — or nothing at all. */
export function StatusChip({ status }: { status: DueStatus }) {
  const text = chipText(status)
  if (!text) return null
  const tone = status.kind === 'late' ? 'warn' : status.kind === 'done' ? 'ok' : 'live'
  return <Chip tone={tone}>{text}</Chip>
}

/**
 * Progress as a light trail: a bright head at the leading edge and a tail
 * fading out behind it. `cap` puts a marker on the track.
 */
export function Trail({ value, max, cap, label }: { value: number; max: number; cap?: number | null; label: string }) {
  const p = max > 0 ? Math.min(1, Math.max(0, value / max)) : 0
  return (
    <div className="lg-trail" role="progressbar" aria-label={label} aria-valuemin={0} aria-valuemax={max} aria-valuenow={value}>
      <div className="lg-trail-fill" style={{ transform: `scaleX(${p})` }} />
      {p > 0 && <div className="lg-trail-head" style={{ left: `${p * 100}%` }} />}
      {cap && cap < max && <div className="lg-trail-mark" style={{ left: `${(cap / max) * 100}%` }} title={`Cap: ${cap}`} />}
    </div>
  )
}

const SEGMENTS = 36

/**
 * A countdown as a segmented ring: what's left of the span is lit, what's
 * gone is dark, and the number of days sits in the middle.
 */
export function Ring({ countdown, size = 112 }: { countdown: Countdown | CountdownFinished; size?: number }) {
  const r = 44
  const c = 50
  const step = 360 / SEGMENTS
  const lit = countdown.finished ? SEGMENTS : Math.max(countdown.days > 0 ? 1 : 0, Math.round(countdown.remaining * SEGMENTS))
  const arc = (i: number) => {
    const a0 = ((i * step + 1.6) * Math.PI) / 180
    const a1 = (((i + 1) * step - 1.6) * Math.PI) / 180
    const x0 = c + r * Math.sin(a0)
    const y0 = c - r * Math.cos(a0)
    const x1 = c + r * Math.sin(a1)
    const y1 = c - r * Math.cos(a1)
    return `M${x0.toFixed(2)} ${y0.toFixed(2)}A${r} ${r} 0 0 1 ${x1.toFixed(2)} ${y1.toFixed(2)}`
  }
  const segments = Array.from({ length: SEGMENTS }, (_, i) => i)
  return (
    <svg width={size} height={size} viewBox="0 0 100 100" aria-hidden className="block">
      <g stroke="#123a5e" strokeWidth="5" fill="none">
        {segments.slice(lit).map((i) => (
          <path key={i} d={arc(i)} />
        ))}
      </g>
      <g stroke="#41e3ff" strokeWidth="5" fill="none" style={{ filter: 'drop-shadow(0 0 2.5px rgb(65 227 255 / 0.8))' }}>
        {segments.slice(0, lit).map((i) => (
          <path key={i} d={arc(i)} />
        ))}
      </g>
      <circle cx={c} cy={c} r={34} fill="none" stroke="#123a5e" strokeWidth="0.6" />
    </svg>
  )
}

/** A countdown with its number and what it's counting to. */
export function Gauge({ countdown, sub }: { countdown: Countdown | CountdownFinished; sub?: string }) {
  return (
    <div className="flex min-w-0 flex-col items-center text-center">
      <div className="relative">
        <Ring countdown={countdown} />
        <div className="absolute inset-0 grid place-items-center">
          {countdown.finished ? (
            <span className="lg-display text-[15px] text-[var(--lg-cyan)]">DONE</span>
          ) : (
            <span className="flex flex-col items-center leading-none">
              <span className="lg-num lg-live text-[30px] font-medium">{countdown.days}</span>
              <span className="lg-label mt-1 !text-[9.5px]">{countdown.days === 1 ? 'day' : 'days'}</span>
            </span>
          )}
        </div>
      </div>
      <p className="mt-1.5 text-[12.5px] font-medium leading-tight">{countdown.label}</p>
      {sub && <p className="lg-num lg-dim mt-0.5 text-[11.5px]">{sub}</p>}
    </div>
  )
}

/** A task's node on the circuit: tap to check it off. */
export function Node({
  done,
  hard,
  late,
  label,
  onToggle,
}: {
  done: boolean
  hard: boolean
  late: boolean
  label: string
  onToggle: () => void
}) {
  return (
    <button
      type="button"
      className="lg-node"
      data-done={done}
      data-hard={hard}
      data-late={late && !done}
      aria-pressed={done}
      aria-label={done ? `Mark not done: ${label}` : `Mark done: ${label}`}
      onClick={(e) => {
        e.stopPropagation()
        onToggle()
      }}
    >
      <span />
    </button>
  )
}

export function Switch({ on, onChange, label }: { on: boolean; onChange: (next: boolean) => void; label: string }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      aria-label={label}
      className="lg-switch"
      onClick={() => {
        fire(on ? 'toggleOff' : 'toggleOn')
        onChange(!on)
      }}
    >
      <span />
    </button>
  )
}

/** A labelled control in a form. */
export function Field({ label, hint, children }: { label: string; hint?: ReactNode; children: ReactNode }) {
  return (
    <label className="block">
      <span className="lg-label mb-1 block">{label}</span>
      {children}
      {hint && <span className="lg-dim mt-1 block text-[12px]">{hint}</span>}
    </label>
  )
}

/** A row with a switch at the end. */
export function SwitchRow({ label, hint, on, onChange }: { label: string; hint?: string; on: boolean; onChange: (v: boolean) => void }) {
  return (
    <div className="flex min-h-[48px] items-center gap-3">
      <span className="min-w-0 flex-1">
        <span className="block text-[14.5px]">{label}</span>
        {hint && <span className="lg-dim block text-[12px]">{hint}</span>}
      </span>
      <Switch on={on} onChange={onChange} label={label} />
    </div>
  )
}

/** Text you can copy with a tap. Always shown, so it can be read and typed too. */
export function CopyText({ text, label, href }: { text: string; label: string; href?: string }) {
  return (
    <span className="flex min-h-[44px] items-center gap-2">
      <button
        type="button"
        className="lg-num min-w-0 flex-1 truncate text-left text-[13.5px] text-[var(--lg-ice)]"
        aria-label={`Copy ${label}: ${text}`}
        onClick={() => {
          fire('tap')
          copyToClipboard(text).then(
            () => toast.success(`Copied ${label}`),
            () => toast.error("Couldn't copy that"),
          )
        }}
      >
        {text}
      </button>
      {href && (
        <a href={href} className="lg-btn lg-btn--small lg-btn--ghost" aria-label={`${label === 'email' ? 'Email' : 'Call'} ${text}`}>
          {label === 'email' ? 'Email' : 'Call'}
        </a>
      )}
    </span>
  )
}

/** A short list of plain lines, as the plan has them. */
export function Lines({ items }: { items: string[] }) {
  return (
    <ul className="flex flex-col gap-2">
      {items.map((t, i) => (
        <li key={i} className="flex gap-2.5 text-[13.5px] leading-snug">
          <span aria-hidden className="mt-[7px] h-1 w-1 shrink-0 bg-[var(--lg-cyan)]" />
          <span className="min-w-0">{t}</span>
        </li>
      ))}
    </ul>
  )
}

/** The dock's glyphs — thin line drawings, lit when their tab is on. */
export function TabGlyph({ tab }: { tab: 'hud' | 'timeline' | 'exp' | 'file' | 'mcat' | 'record' }) {
  const paths: Record<typeof tab, string> = {
    hud: 'M4 15a8 8 0 1 1 16 0 M12 15l4-5 M7 15h-1 M18 15h-1',
    timeline: 'M6 3v18 M6 6h12 M6 12h9 M6 18h11 M4.5 6h3 M4.5 12h3 M4.5 18h3',
    // A clock face with a tick: hours that counted.
    exp: 'M12 21a9 9 0 1 1 0-18 9 9 0 0 1 0 18Z M12 7v5l3.5 2',
    file: 'M4 6.5h6l2 2h8v10H4Z M8 13.5h8',
    mcat: 'M12 3v4 M12 17v4 M3 12h4 M17 12h4 M12 16a4 4 0 1 0 0-8 4 4 0 0 0 0 8Z',
    record: 'M4 20h16 M6.5 20v-6 M11 20V9 M15.5 20v-8 M20 20V5',
  }
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="square" aria-hidden>
      <path d={paths[tab]} />
    </svg>
  )
}
