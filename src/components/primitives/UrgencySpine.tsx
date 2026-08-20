import { normalizeUrgency, type Urgency } from '@/data/types'

/**
 * Urgency as a leading-edge spine.
 *
 * Encoded in thickness, height AND luminance together — three redundant
 * channels, so it reads pre-attentively while scrolling and stays legible
 * without relying on hue alone.
 */

const SPEC: Record<Urgency, { w: number; h: string; color: string; glow: boolean }> = {
  0: { w: 3, h: '46%', color: 'var(--u-low)', glow: false },
  1: { w: 4, h: '78%', color: 'var(--u-med)', glow: false },
  2: { w: 5, h: '100%', color: 'var(--u-urgent)', glow: true },
}

export function UrgencySpine({ urgency }: { urgency: Urgency }) {
  // Rows written when there were four levels can still hold a 3.
  const level = normalizeUrgency(urgency)
  const s = SPEC[level]
  return (
    <div className="absolute inset-y-0 left-0 flex items-center" aria-hidden>
      <div
        className={s.glow ? 'urgent-glow' : undefined}
        style={{
          width: s.w,
          height: s.h,
          background: s.color,
          borderRadius: '0 4px 4px 0',
          opacity: level === 0 ? 0.85 : 1,
        }}
      />
    </div>
  )
}
