import { useMemo } from 'react'
import { QUIET, qrMatrix, qrPath } from './qr'

/**
 * A QR code, drawn as one SVG path. Always black on white whatever the theme:
 * a scanner wants contrast it recognises, and an inverted code in dark mode is
 * one a lot of phone cameras won't read.
 */
export function QrCode({ value, size, label, className }: { value: string; size: number | string; label: string; className?: string }) {
  const m = useMemo(() => qrMatrix(value), [value])
  const n = m.size + 2 * QUIET
  return (
    <svg viewBox={`0 0 ${n} ${n}`} width={size} height={size} shapeRendering="crispEdges" role="img" aria-label={label} className={className}>
      <rect width={n} height={n} fill="#fff" />
      <path d={qrPath(m)} fill="#111" />
    </svg>
  )
}
