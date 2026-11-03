/**
 * The mark: a thin ring of light broken top and bottom by one vertical trace
 * that runs straight through it, on a chamfered plate of near-black — the
 * app's world in miniature. Original; it stands for a path crossing a goal.
 *
 * The glow is a blurred copy drawn underneath, static. Ids are suffixed so
 * the home grid and the sidebar can both draw it on one page.
 */

let seq = 0

export function MedSchoolLogo({ size = 40, title = 'Med School 2028' }: { size?: number; title?: string }) {
  const id = `msl${++seq}`
  // Ring of radius 13 around (24, 24), open 18° either side of the top and
  // the bottom, where the trace passes through.
  const right = 'M28.02 11.64 A13 13 0 0 1 28.02 36.36'
  const left = 'M19.98 36.36 A13 13 0 0 1 19.98 11.64'
  return (
    <svg width={size} height={size} viewBox="0 0 48 48" role="img" aria-label={title}>
      <defs>
        <filter id={`${id}-glow`} x="-40%" y="-40%" width="180%" height="180%">
          <feGaussianBlur stdDeviation="1.6" />
        </filter>
      </defs>
      <path d="M8 2h32l6 6v32l-6 6H8l-6-6V8Z" fill="#02060c" stroke="#123a5e" strokeWidth="1" />
      <g filter={`url(#${id}-glow)`} opacity="0.9" stroke="#41e3ff" strokeWidth="2.6" fill="none" strokeLinecap="round">
        <path d={right} />
        <path d={left} />
        <path d="M24 7v34" stroke="#e6fbff" />
      </g>
      <g stroke="#41e3ff" strokeWidth="1.6" fill="none" strokeLinecap="round">
        <path d={right} />
        <path d={left} />
      </g>
      <path d="M24 7v34" stroke="#e6fbff" strokeWidth="1.4" strokeLinecap="round" />
      <circle cx="24" cy="7" r="1.6" fill="#e6fbff" />
      <circle cx="24" cy="41" r="1.6" fill="#e6fbff" />
    </svg>
  )
}
