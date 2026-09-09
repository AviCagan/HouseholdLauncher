/** Hand-rolled inline icons — no icon package, so the set stays consistent. */

export type IconName =
  | 'check'
  | 'repeat'
  | 'cart'
  | 'star'
  | 'plus'
  | 'settings'
  | 'trash'
  | 'globe'
  | 'route'
  | 'chevron'
  | 'close'
  | 'nav'
  | 'clock'
  | 'link'
  | 'pin'
  | 'bell'
  | 'calendar'
  | 'copy'
  | 'sparkle'
  | 'pencil'
  | 'bluetooth'
  | 'wallet'
  | 'people'
  | 'grid'
  | 'key'
  | 'eye'
  | 'eyeOff'
  | 'lock'
  | 'back'
  | 'arrowRight'
  | 'checkCircle'
  | 'history'
  | 'chef'

const PATHS: Record<IconName, string> = {
  check: 'M4 12.5 9 17.5 20 6.5',
  repeat: 'M4 9a5 5 0 0 1 5-5h8m0 0-3-3m3 3-3 3M20 15a5 5 0 0 1-5 5H7m0 0 3 3m-3-3 3-3',
  cart: 'M3 4h2.2l2.4 11.2a2 2 0 0 0 2 1.6h7.6a2 2 0 0 0 2-1.55L21 8H6.2M10 21h.01M17 21h.01',
  star: 'M12 3.5l2.6 5.3 5.9.85-4.25 4.15 1 5.85L12 16.9l-5.25 2.75 1-5.85L3.5 9.65l5.9-.85L12 3.5Z',
  plus: 'M12 5v14M5 12h14',
  settings:
    'M12 15.5a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7Z M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.6a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1Z',
  trash: 'M4 7h16M10 11v6M14 11v6M5 7l1 13a2 2 0 0 0 2 2h8a2 2 0 0 0 2-2l1-13M9 7V4h6v3',
  globe: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18Z M3 12h18 M12 3a14 14 0 0 1 0 18 14 14 0 0 1 0-18Z',
  route: 'M6 19a3 3 0 1 0 0-6 3 3 0 0 0 0 6Z M18 11a3 3 0 1 0 0-6 3 3 0 0 0 0 6Z M9 17h5a4 4 0 0 0 0-8H10a4 4 0 0 1 0-8h1',
  chevron: 'M9 6l6 6-6 6',
  close: 'M6 6l12 12M18 6L6 18',
  nav: 'M3 11l18-8-8 18-2-8-8-2Z',
  clock: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18Z M12 7v5l3 2',
  link: 'M10 13a5 5 0 0 0 7 0l3-3a5 5 0 0 0-7-7l-1 1M14 11a5 5 0 0 0-7 0l-3 3a5 5 0 0 0 7 7l1-1',
  pin: 'M12 21s7-6.4 7-11a7 7 0 1 0-14 0c0 4.6 7 11 7 11Z M12 12.5a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5Z',
  bell: 'M18 9a6 6 0 1 0-12 0c0 6-2 7-2 7h16s-2-1-2-7M13.7 20a2 2 0 0 1-3.4 0',
  calendar:
    'M5 5h14a1 1 0 0 1 1 1v13a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1Z M4 10h16 M8 3v4 M16 3v4',
  copy: 'M9 9h9a1 1 0 0 1 1 1v9a1 1 0 0 1-1 1H9a1 1 0 0 1-1-1v-9a1 1 0 0 1 1-1Z M5 15H4a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1h9a1 1 0 0 1 1 1v1',
  sparkle:
    'M12 3l1.8 4.9L18.7 9.7l-4.9 1.8L12 16.4l-1.8-4.9L5.3 9.7l4.9-1.8L12 3Z M18.5 15.5l.8 2.2 2.2.8-2.2.8-.8 2.2-.8-2.2-2.2-.8 2.2-.8.8-2.2Z',
  pencil:
    'M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5Z',
  // The Bluetooth rune: the bowtie plus the stem it hangs from.
  bluetooth: 'M7 7.5 17 16.5 12 21V3l5 4.5L7 16.5',
  wallet:
    'M3 8a2 2 0 0 1 2-2h13a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8Z M3 8V6.5a1.5 1.5 0 0 1 1.5-1.5H16 M16.5 12.5h.01 M20 10.5h-3.5a2 2 0 0 0 0 4H20',
  people:
    'M9 11a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7Z M2.5 20a6.5 6.5 0 0 1 13 0 M16.5 11.2a3.2 3.2 0 0 0 0-6.4 M18 14.4a5.6 5.6 0 0 1 3.5 5.2',
  grid:
    'M4 4h6v6H4V4Z M14 4h6v6h-6V4Z M4 14h6v6H4v-6Z M14 14h6v6h-6v-6Z',
  key: 'M15.5 3.5a5.5 5.5 0 1 0-4.2 9.3L10 14H8v2H6v2H3v-3l7.8-7.8A5.5 5.5 0 0 0 15.5 3.5Z M16.5 7h.01',
  eye: 'M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7-10-7-10-7Z M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6Z',
  eyeOff:
    'M10.6 5.2A9.9 9.9 0 0 1 12 5c6.4 0 10 7 10 7a17.7 17.7 0 0 1-3.1 4M6.3 6.4A17.6 17.6 0 0 0 2 12s3.6 7 10 7a9.7 9.7 0 0 0 4.3-1M3 3l18 18M9.9 9.9a3 3 0 0 0 4.2 4.2',
  lock: 'M6 11h12a1 1 0 0 1 1 1v8a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1v-8a1 1 0 0 1 1-1Z M8 11V7a4 4 0 0 1 8 0v4',
  back: 'M15 6l-6 6 6 6',
  // A chef's hat: the puffy crown on its band.
  chef: 'M6.5 14.5v4.5h11v-4.5 M6.5 14.5a3.5 3.5 0 0 1-1-6.9A4 4 0 0 1 12 4.5a4 4 0 0 1 6.5 3.1 3.5 3.5 0 0 1-1 6.9 M6.5 19h11',
  arrowRight: 'M4 12h15m0 0-5-5m5 5-5 5',
  checkCircle: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18Z M8 12.2l2.7 2.8L16 9.5',
  history:
    'M3.5 12a8.5 8.5 0 1 0 2.6-6.1M3.5 5v4.5H8 M12 7.5V12l3 1.8',
}

interface Props {
  name: IconName
  size?: number
  strokeWidth?: number
  className?: string
  filled?: boolean
}

export function Icon({
  name,
  size = 22,
  strokeWidth = 2,
  className,
  filled = false,
}: Props) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill={filled ? 'currentColor' : 'none'}
      stroke="currentColor"
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden="true"
    >
      <path d={PATHS[name]} />
    </svg>
  )
}
