/**
 * The mark: a W made of the three AV cables — yellow, white and red — with
 * an RCA plug on each end and rabbit-ear antennas standing on the middle peak.
 *
 * The three strands are the same W path shifted sideways. On a W the strokes
 * are steep, so a sideways shift keeps them parallel and clear of each other
 * all the way round; a true offset curve would be the same picture for a lot
 * more geometry.
 */

const W = 'M16 42 L38 100 L60 60 L82 100 L104 42'

const STRANDS = [
  { dx: -7, color: '#f8c534' },
  { dx: 0, color: '#f3efe4' },
  { dx: 7, color: '#ec4a3c' },
]

function Plug({ x, y, color }: { x: number; y: number; color: string }) {
  return (
    <g>
      {/* metal tip */}
      <rect x={x - 1.1} y={y - 22} width={2.2} height={7} rx={1} fill="url(#wm-metal)" />
      {/* sleeve */}
      <rect x={x - 3.4} y={y - 16} width={6.8} height={7} rx={1.2} fill="url(#wm-metal)" stroke="#111" strokeWidth={0.8} />
      {/* collar */}
      <rect x={x - 4.6} y={y - 10} width={9.2} height={11} rx={2.2} fill={color} stroke="#111" strokeWidth={1.1} />
      <rect x={x - 3.2} y={y - 8.6} width={2.2} height={8} rx={1} fill="#fff" opacity={0.35} />
    </g>
  )
}

export function WatchedLogo({ size = 40, title = 'Watched' }: { size?: number; title?: string }) {
  return (
    <svg
      width={size}
      height={size * (112 / 120)}
      viewBox="0 0 120 112"
      role="img"
      aria-label={title}
      style={{ overflow: 'visible' }}
    >
      <defs>
        <linearGradient id="wm-metal" x1="0" x2="1">
          <stop offset="0" stopColor="#7c8188" />
          <stop offset="0.45" stopColor="#f2f3f5" />
          <stop offset="1" stopColor="#8d9299" />
        </linearGradient>
      </defs>

      {/* Rabbit ears, behind the cables. */}
      <g stroke="#c9ced6" strokeWidth={2.4} strokeLinecap="round">
        <line x1={56} y1={50} x2={37} y2={10} />
        <line x1={64} y1={50} x2={83} y2={10} />
      </g>
      <circle cx={37} cy={10} r={3.4} fill="#e6e9ee" stroke="#111" strokeWidth={1} />
      <circle cx={83} cy={10} r={3.4} fill="#e6e9ee" stroke="#111" strokeWidth={1} />
      <path d="M48 56 A12 9 0 0 1 72 56 Z" fill="#26211f" stroke="#0b0b0b" strokeWidth={1.4} />
      <circle cx={60} cy={51} r={1.6} fill="#ff3b2f" />

      {/* Cable outlines first, so each strand reads as its own cable. */}
      {STRANDS.map((s) => (
        <path
          key={`o${s.dx}`}
          d={W}
          transform={`translate(${s.dx} 0)`}
          fill="none"
          stroke="#120d0a"
          strokeWidth={9.5}
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      ))}
      {STRANDS.map((s) => (
        <path
          key={`s${s.dx}`}
          d={W}
          transform={`translate(${s.dx} 0)`}
          fill="none"
          stroke={s.color}
          strokeWidth={6}
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      ))}
      {STRANDS.map((s) => (
        <path
          key={`h${s.dx}`}
          d={W}
          transform={`translate(${s.dx - 1} -1)`}
          fill="none"
          stroke="#fff"
          strokeOpacity={0.35}
          strokeWidth={1.4}
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      ))}

      {STRANDS.map((s) => (
        <Plug key={`l${s.dx}`} x={16 + s.dx} y={42} color={s.color} />
      ))}
      {STRANDS.map((s) => (
        <Plug key={`r${s.dx}`} x={104 + s.dx} y={42} color={s.color} />
      ))}
    </svg>
  )
}

/** Logo and name together, as on the front of the set. */
export function WatchedWordmark({ size = 34 }: { size?: number }) {
  return (
    <span className="flex items-center gap-2">
      <WatchedLogo size={size} />
      <span className="tv-plate text-[22px] leading-none">WATCHED</span>
    </span>
  )
}
