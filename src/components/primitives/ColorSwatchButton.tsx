import { Icon } from './Icon'

/**
 * "Pick a custom colour" trigger.
 *
 * Shows the colour you actually have, not a rainbow — a rainbow disc sitting
 * in a row of solid swatches reads like just another colour choice. The small
 * spectrum ring around the edge is what says "there's more in here", and the
 * plus says it opens something.
 */
export function ColorSwatchButton({
  value,
  open,
  onClick,
  size = 34,
}: {
  value: string
  open: boolean
  onClick: () => void
  size?: number
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label="Pick a custom colour"
      aria-expanded={open}
      className="relative grid shrink-0 place-items-center rounded-full"
      style={{
        width: size,
        height: size,
        // Spectrum only as a thin rim, with the current colour filling the
        // middle, so the control still reports its own state.
        background: `
          radial-gradient(circle, ${value} 0 58%, transparent 58%),
          conic-gradient(#ff4d4d, #f5a524, #7ec13f, #2bb673, #3aa0ff, #7c5cff, #ff6ea9, #ff4d4d)
        `,
        border: open ? '2px solid var(--text)' : '2px solid var(--border-strong)',
        color: '#fff',
      }}
    >
      <span
        className="grid place-items-center rounded-full"
        style={{
          width: size * 0.52,
          height: size * 0.52,
          background: value,
          boxShadow: 'inset 0 0 0 1px rgb(0 0 0 / .18)',
        }}
      >
        <Icon name={open ? 'close' : 'plus'} size={size * 0.32} strokeWidth={3} />
      </span>
    </button>
  )
}
