/** Circular progress toward a chore becoming available again. */
export function CooldownRing({
  progress,
  size = 34,
  stroke = 3,
  color = 'var(--accent)',
  children,
}: {
  progress: number
  size?: number
  stroke?: number
  color?: string
  children?: React.ReactNode
}) {
  const r = (size - stroke) / 2
  const circumference = 2 * Math.PI * r
  const offset = circumference * (1 - Math.min(1, Math.max(0, progress)))

  return (
    <div className="relative grid shrink-0 place-items-center" style={{ width: size, height: size }}>
      <svg width={size} height={size} className="absolute -rotate-90">
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          stroke="var(--surface-3)"
          strokeWidth={stroke}
        />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          stroke={color}
          strokeWidth={stroke}
          strokeLinecap="round"
          strokeDasharray={circumference}
          strokeDashoffset={offset}
          style={{ transition: 'stroke-dashoffset .6s ease' }}
        />
      </svg>
      {children && <span className="relative z-10 text-[10px]">{children}</span>}
    </div>
  )
}
