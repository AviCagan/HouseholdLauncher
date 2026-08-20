import { useEffect, useRef, useState } from 'react'
import { fire } from '@/lib/haptics'

/**
 * Drag-anywhere colour picker.
 *
 * Android's native `<input type="color">` opens three RGB value sliders, which
 * is a terrible way to find a colour by eye. This is the usual thing instead:
 * a hue wheel you drag around, and a lightness strip under it.
 *
 * Painted on a canvas rather than assembled from gradients — a conic gradient
 * gives the hue ring but not the saturation falloff toward the centre, and
 * faking that with stacked layers ends up heavier than just drawing it.
 */

const SIZE = 220

function hsvToHex(h: number, s: number, v: number): string {
  const f = (n: number) => {
    const k = (n + h / 60) % 6
    const c = v - v * s * Math.max(0, Math.min(k, 4 - k, 1))
    return Math.round(c * 255)
  }
  const toHex = (n: number) => n.toString(16).padStart(2, '0')
  return `#${toHex(f(5))}${toHex(f(3))}${toHex(f(1))}`
}

function hexToHsv(hex: string): { h: number; s: number; v: number } {
  const m = hex.replace('#', '')
  const r = parseInt(m.slice(0, 2), 16) / 255
  const g = parseInt(m.slice(2, 4), 16) / 255
  const b = parseInt(m.slice(4, 6), 16) / 255
  const max = Math.max(r, g, b)
  const min = Math.min(r, g, b)
  const d = max - min

  let h = 0
  if (d !== 0) {
    if (max === r) h = ((g - b) / d) % 6
    else if (max === g) h = (b - r) / d + 2
    else h = (r - g) / d + 4
    h *= 60
    if (h < 0) h += 360
  }
  return { h, s: max === 0 ? 0 : d / max, v: max }
}

export function ColorPicker({
  value,
  onChange,
}: {
  value: string
  onChange: (hex: string) => void
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const [hsv, setHsv] = useState(() => hexToHsv(value))
  const dragging = useRef(false)

  // Paint the wheel once: hue around, saturation outward from the centre.
  useEffect(() => {
    const canvas = canvasRef.current
    const ctx = canvas?.getContext('2d')
    if (!canvas || !ctx) return

    const dpr = Math.min(window.devicePixelRatio || 1, 2)
    canvas.width = SIZE * dpr
    canvas.height = SIZE * dpr
    ctx.scale(dpr, dpr)

    const r = SIZE / 2
    const image = ctx.createImageData(SIZE * dpr, SIZE * dpr)
    for (let y = 0; y < SIZE * dpr; y++) {
      for (let x = 0; x < SIZE * dpr; x++) {
        const dx = x / dpr - r
        const dy = y / dpr - r
        const dist = Math.hypot(dx, dy)
        const i = (y * SIZE * dpr + x) * 4
        if (dist > r) {
          image.data[i + 3] = 0
          continue
        }
        const hue = ((Math.atan2(dy, dx) * 180) / Math.PI + 360) % 360
        const sat = Math.min(1, dist / r)
        const hex = hsvToHex(hue, sat, 1)
        image.data[i] = parseInt(hex.slice(1, 3), 16)
        image.data[i + 1] = parseInt(hex.slice(3, 5), 16)
        image.data[i + 2] = parseInt(hex.slice(5, 7), 16)
        // Feather the rim so the circle isn't jagged.
        image.data[i + 3] = dist > r - 1 ? Math.round(255 * (r - dist)) : 255
      }
    }
    ctx.putImageData(image, 0, 0)
  }, [])

  function pickAt(clientX: number, clientY: number) {
    const canvas = canvasRef.current
    if (!canvas) return
    const rect = canvas.getBoundingClientRect()
    const r = rect.width / 2
    const dx = clientX - rect.left - r
    const dy = clientY - rect.top - r
    const dist = Math.hypot(dx, dy)

    const hue = ((Math.atan2(dy, dx) * 180) / Math.PI + 360) % 360
    // Clamping rather than ignoring lets you drag past the edge and keep the
    // hue, which is how every colour wheel is expected to behave.
    const sat = Math.min(1, dist / r)

    const next = { h: hue, s: sat, v: hsv.v }
    setHsv(next)
    onChange(hsvToHex(next.h, next.s, next.v))
  }

  const r = SIZE / 2
  const markerX = r + Math.cos((hsv.h * Math.PI) / 180) * hsv.s * r
  const markerY = r + Math.sin((hsv.h * Math.PI) / 180) * hsv.s * r

  return (
    <div className="flex flex-col items-center gap-3">
      <div className="relative" style={{ width: SIZE, height: SIZE, touchAction: 'none' }}>
        <canvas
          ref={canvasRef}
          style={{
            width: SIZE,
            height: SIZE,
            borderRadius: '50%',
            // Lightness is applied as an overlay rather than repainting the
            // wheel on every drag of the strip below.
            filter: `brightness(${0.35 + hsv.v * 0.65})`,
          }}
          onPointerDown={(e) => {
            dragging.current = true
            e.currentTarget.setPointerCapture(e.pointerId)
            fire('dragStart')
            pickAt(e.clientX, e.clientY)
          }}
          onPointerMove={(e) => {
            if (dragging.current) pickAt(e.clientX, e.clientY)
          }}
          onPointerUp={(e) => {
            dragging.current = false
            e.currentTarget.releasePointerCapture(e.pointerId)
            fire('snap')
          }}
          onPointerCancel={() => {
            dragging.current = false
          }}
        />
        <span
          className="pointer-events-none absolute h-6 w-6 rounded-full"
          style={{
            left: markerX - 12,
            top: markerY - 12,
            background: value,
            border: '3px solid #fff',
            boxShadow: '0 1px 6px rgb(0 0 0 / .45)',
          }}
        />
      </div>

      <div className="flex w-full items-center gap-3 px-1">
        <span
          className="h-8 w-8 shrink-0 rounded-full"
          style={{ background: value, border: '2px solid var(--border-strong)' }}
        />
        <input
          type="range"
          min={0.15}
          max={1}
          step={0.01}
          value={hsv.v}
          aria-label="Lightness"
          onChange={(e) => {
            const v = parseFloat(e.target.value)
            const next = { ...hsv, v }
            setHsv(next)
            onChange(hsvToHex(next.h, next.s, next.v))
          }}
          className="flex-1"
          style={{ accentColor: value }}
        />
        <span
          className="w-[74px] shrink-0 text-right text-[12px] uppercase"
          style={{ color: 'var(--text-dim)', fontVariantNumeric: 'tabular-nums' }}
        >
          {value}
        </span>
      </div>
    </div>
  )
}
