import { useEffect, useRef, useState, type ReactNode } from 'react'
import { Reorder, useDragControls } from 'motion/react'
import { Icon } from '@/components/primitives/Icon'
import { fire } from '@/lib/haptics'
import { largePoster } from './tvmaze'

/** The pieces of the set every screen is built from. */

export function Poster({
  url,
  title,
  className = '',
  large = false,
}: {
  url: string | null
  title: string
  className?: string
  large?: boolean
}) {
  const src = large ? largePoster(url) : url
  const [broken, setBroken] = useState(false)
  useEffect(() => setBroken(false), [src])
  return (
    <div className={`tv-frame ${className}`}>
      {src && !broken ? (
        <img src={src} alt="" loading="lazy" draggable={false} onError={() => setBroken(true)} />
      ) : (
        <NoPicture title={title} />
      )}
    </div>
  )
}

/** Colour bars with the title over them, for a show with no picture. */
function NoPicture({ title }: { title: string }) {
  return (
    <div className="relative h-full w-full">
      <div className="tv-bars absolute inset-x-0 top-0 h-[68%]" />
      <div className="tv-bars-low absolute inset-x-0 top-[68%] h-[10%]" />
      <div className="absolute inset-x-0 bottom-0 h-[22%] bg-[#101010]" />
      <span
        className="tv-osd absolute inset-x-1 top-1/2 -translate-y-1/2 truncate rounded bg-black/70 px-1 py-0.5 text-center text-[13px] text-white"
        style={{ letterSpacing: '0.06em' }}
      >
        {title}
      </span>
    </div>
  )
}

/** The empty state: no signal. */
export function NoSignal({ title, hint, action }: { title: string; hint?: string; action?: ReactNode }) {
  return (
    <div className="flex flex-col items-center gap-3 px-6 py-8 text-center">
      <div className="tv-frame relative h-[92px] w-[150px]">
        <div className="tv-bars absolute inset-x-0 top-0 h-[70%]" />
        <div className="tv-bars-low absolute inset-x-0 top-[70%] h-[12%]" />
        <div className="absolute inset-x-0 bottom-0 h-[18%] bg-[#121212]" />
        <span className="tv-osd absolute left-1/2 top-[38%] -translate-x-1/2 -translate-y-1/2 rounded bg-black/80 px-2 py-0.5 text-[15px] text-white">
          NO SIGNAL
        </span>
      </div>
      <p className="tv-osd tv-glow text-[22px]">{title}</p>
      {hint && (
        <p className="max-w-[270px] text-[13px] leading-snug" style={{ color: 'var(--tv-dim)' }}>
          {hint}
        </p>
      )}
      {action}
    </div>
  )
}

export function SectionHead({ children, right }: { children: ReactNode; right?: ReactNode }) {
  return (
    <div className="flex items-center gap-2 px-1 pb-2 pt-4">
      <span className="tv-osd tv-amber text-[17px]">{children}</span>
      <span className="h-px flex-1" style={{ background: 'var(--tv-line)' }} />
      {right}
    </div>
  )
}

export function Stat({ label, value, sub }: { label: string; value: ReactNode; sub?: ReactNode }) {
  return (
    <div className="tv-card flex min-w-0 flex-col items-center gap-1 px-2 py-2.5 text-center">
      <span className="tv-osd tv-green text-[22px]">{value}</span>
      <span className="tv-osd text-[12px]" style={{ color: 'var(--tv-faint)' }}>
        {label}
      </span>
      {sub && <span className="text-[11px]" style={{ color: 'var(--tv-dim)' }}>{sub}</span>}
    </div>
  )
}

export function Chip({ children, color, className = '' }: { children: ReactNode; color?: string; className?: string }) {
  return (
    <span
      className={`tv-osd inline-flex items-center gap-1 rounded-md px-1.5 py-[3px] text-[13px] ${className}`}
      style={{
        color: color ?? 'var(--tv-dim)',
        background: color ? `color-mix(in oklab, ${color} 14%, transparent)` : 'var(--tv-card-2)',
        boxShadow: `inset 0 0 0 1px ${color ? `color-mix(in oklab, ${color} 35%, transparent)` : 'var(--tv-line)'}`,
      }}
    >
      {children}
    </span>
  )
}

/**
 * The rating control: a TV's volume bar. Ten blocks, half points.
 *
 * Tap a block for that score, drag along it for halves, or use the arrow
 * keys. Reads as a slider to a screen reader, because it is one.
 */
export function OsdBar({
  value,
  onChange,
  color,
  label,
}: {
  value: number | null
  onChange?: (value: number) => void
  color?: string
  label: string
}) {
  const ref = useRef<HTMLDivElement>(null)
  const last = useRef<number | null>(null)
  const interactive = !!onChange

  function valueAt(clientX: number): number {
    const box = ref.current!.getBoundingClientRect()
    const ratio = Math.min(1, Math.max(0, (clientX - box.left) / box.width))
    return Math.min(10, Math.max(0.5, Math.ceil(ratio * 20) / 2))
  }

  function set(v: number) {
    if (v === last.current) return
    last.current = v
    fire('snap')
    onChange?.(v)
  }

  const v = value ?? 0
  return (
    <div
      ref={ref}
      className="tv-bar w-full"
      style={{ ['--bar' as string]: color ?? 'var(--tv-osd)', cursor: interactive ? 'pointer' : 'default' }}
      role={interactive ? 'slider' : 'meter'}
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={10}
      aria-valuenow={value ?? undefined}
      aria-valuetext={value === null ? 'Not rated' : `${value} out of 10`}
      tabIndex={interactive ? 0 : undefined}
      onPointerDown={(e) => {
        if (!interactive) return
        ;(e.target as HTMLElement).setPointerCapture?.(e.pointerId)
        last.current = null
        set(valueAt(e.clientX))
      }}
      onPointerMove={(e) => {
        if (!interactive || e.buttons === 0) return
        set(valueAt(e.clientX))
      }}
      onKeyDown={(e) => {
        if (!interactive) return
        if (e.key === 'ArrowRight' || e.key === 'ArrowUp') {
          e.preventDefault()
          set(Math.min(10, (value ?? 0) + 0.5))
        } else if (e.key === 'ArrowLeft' || e.key === 'ArrowDown') {
          e.preventDefault()
          set(Math.max(0.5, (value ?? 1) - 0.5))
        }
      }}
    >
      {Array.from({ length: 10 }, (_, i) => {
        const fill = Math.min(1, Math.max(0, v - i))
        return (
          <span key={i} className="tv-bar-seg">
            {fill > 0 && <i style={{ width: `${fill * 100}%` }} />}
          </span>
        )
      })}
    </div>
  )
}

/** A little round avatar: photo if there is one, emoji otherwise. */
export function Face({ emoji, avatar, color, size = 22 }: { emoji: string; avatar: string | null; color: string; size?: number }) {
  return (
    <span
      className="grid shrink-0 place-items-center overflow-hidden rounded-full"
      style={{
        width: size,
        height: size,
        fontSize: size * 0.6,
        background: `color-mix(in oklab, ${color} 25%, #000)`,
        boxShadow: `0 0 0 1.5px ${color}`,
      }}
    >
      {avatar ? <img src={avatar} alt="" className="h-full w-full object-cover" /> : emoji}
    </span>
  )
}

/** A row that drags only from its handle, so the list still scrolls. */
export function ReorderRow({ id, onDrop, children }: { id: string; onDrop: () => void; children: ReactNode }) {
  const controls = useDragControls()
  return (
    <Reorder.Item
      value={id}
      dragListener={false}
      dragControls={controls}
      onDragStart={() => fire('dragStart')}
      onDragEnd={() => {
        fire('snap')
        onDrop()
      }}
      className="tv-card flex items-center gap-2.5 p-2"
      style={{ position: 'relative' }}
    >
      {children}
      <span
        onPointerDown={(e) => controls.start(e)}
        className="grid h-10 w-9 shrink-0 cursor-grab place-items-center"
        style={{ touchAction: 'none', color: 'var(--tv-faint)' }}
        aria-label="Drag to move"
      >
        <Icon name="grid" size={18} />
      </span>
    </Reorder.Item>
  )
}

