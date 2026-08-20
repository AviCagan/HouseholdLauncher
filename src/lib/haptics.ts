import { Haptics, ImpactStyle, NotificationType } from '@capacitor/haptics'
import type { HapticEventName, HapticIntensity } from '@/data/types'
import { isNative, isIOS } from './platform'

/**
 * One haptics entry point for the whole app.
 *
 * Call sites use semantic events ('claim', 'complete') and never mention
 * intensity — that mapping lives here, so retuning the feel is a single-file
 * change and the iOS fallback stays automatically in sync.
 */

type Level =
  | 'selection'
  | 'light'
  | 'medium'
  | 'heavy'
  | 'notif-success'
  | 'notif-warning'
  | 'notif-error'

interface EventSpec {
  level: Level
  /** navigator.vibrate pattern for Android web, in ms. */
  pattern: number | number[]
}

const EVENTS: Record<HapticEventName, EventSpec> = {
  tap: { level: 'light', pattern: 12 },
  toggleOn: { level: 'medium', pattern: 20 },
  toggleOff: { level: 'light', pattern: 12 },
  claim: { level: 'heavy', pattern: [16, 28, 24] },
  complete: { level: 'notif-success', pattern: [22, 34, 40] },
  delete: { level: 'heavy', pattern: [26, 20, 26] },
  swipeThreshold: { level: 'medium', pattern: 18 },
  longPress: { level: 'heavy', pattern: 32 },
  dragStart: { level: 'medium', pattern: 16 },
  snap: { level: 'selection', pattern: 8 },
  success: { level: 'notif-success', pattern: [20, 30, 36] },
  warning: { level: 'notif-warning', pattern: [30, 40, 30] },
  error: { level: 'notif-error', pattern: [40, 50, 40, 50, 40] },
  /*
    Deliberately the shortest pulse in the table. A zipper is felt as a rapid
    train of tiny detents, and these land ~14 times across one drag — anything
    longer runs into the next tick and the whole thing smears into one buzz,
    which reads as a stuck motor rather than teeth passing under your thumb.
  */
  zipperTick: { level: 'selection', pattern: 7 },
  /** The clasp landing at the end of the pull. */
  zipperDone: { level: 'notif-success', pattern: [30, 26, 55] },
}

const IMPACT_ORDER: Level[] = ['selection', 'light', 'medium', 'heavy']

/** Notification haptics never shift level — their semantics are the point. */
const isNotification = (l: Level) => l.startsWith('notif-')

function shift(level: Level, direction: -1 | 0 | 1): Level {
  if (direction === 0 || isNotification(level)) return level
  const i = IMPACT_ORDER.indexOf(level)
  if (i < 0) return level
  const next = Math.min(IMPACT_ORDER.length - 1, Math.max(0, i + direction))
  return IMPACT_ORDER[next]
}

function scalePattern(
  pattern: number | number[],
  factor: number,
): number | number[] {
  const cap = (n: number) => Math.min(400, Math.max(1, Math.round(n * factor)))
  return typeof pattern === 'number' ? cap(pattern) : pattern.map(cap)
}

// --- settings, pushed in from the profile store -----------------------------

let intensity: HapticIntensity = 'normal'
let perEvent: Partial<Record<HapticEventName, boolean>> = {}
/**
 * Whether the iOS switch trick is allowed. It is undocumented behaviour Apple
 * has already changed once, so it stays a setting rather than something the
 * app decides unilaterally from feature detection.
 */
let iosSwitchAllowed = true
/** Visual fallback sink, wired up by the feedback layer on iOS. */
let pulseSink: ((event: HapticEventName) => void) | null = null
let soundSink: ((event: HapticEventName) => void) | null = null

export function configureHaptics(next: {
  intensity: HapticIntensity
  perEvent: Partial<Record<HapticEventName, boolean>>
  iosSwitch?: boolean
}) {
  intensity = next.intensity
  perEvent = next.perEvent ?? {}
  if (next.iosSwitch !== undefined && next.iosSwitch !== iosSwitchAllowed) {
    iosSwitchAllowed = next.iosSwitch
    // The backend is memoised on first use, so a change here has to invalidate
    // it or the toggle appears to do nothing until the next launch.
    backend = null
  }
}

export function setFeedbackSinks(opts: {
  pulse?: (event: HapticEventName) => void
  sound?: (event: HapticEventName) => void
}) {
  if (opts.pulse) pulseSink = opts.pulse
  if (opts.sound) soundSink = opts.sound
}

// --- backend resolution -----------------------------------------------------

type Backend = 'native' | 'vibrate' | 'ios-switch' | 'none'

let backend: Backend | null = null
let vibrateProbed = false

function resolveBackend(): Backend {
  if (backend) return backend
  if (isNative()) backend = 'native'
  else if (!isIOS() && typeof navigator !== 'undefined' && 'vibrate' in navigator)
    backend = 'vibrate'
  // iOS has never shipped the Vibration API, but Safari 17.4's switch control
  // plays a real system haptic when it toggles — see fireIosSwitch below.
  // Gated on the setting: this is an undocumented trick, not an API, so
  // someone has to be able to turn it off.
  else if (iosSwitchAllowed && iosSwitchSupported()) backend = 'ios-switch'
  else backend = 'none'
  return backend
}

// --- the iOS switch haptic --------------------------------------------------

/*
  iOS has no Vibration API and no polyfill for one, which is why this app shipped
  with "iOS gets visual and audio only". That is no longer the whole story.

  Safari 17.4 added `<input type="checkbox" switch>`, and toggling it plays a
  genuine system haptic. Clicking the input from script does nothing — WebKit
  ignores it — but clicking an associated <label> propagates through and the
  haptic fires. So one hidden switch plus one hidden label gives arbitrary
  programmatic haptics on iOS, which is exactly what was missing.

  Caveats, stated plainly because this is undocumented behaviour and not an API:
  it needs iOS 17.4+, it is one fixed sensation with no intensity control (we
  approximate stronger events by pulsing more than once), and Apple changed the
  behaviour in iOS 26.5 so on the newest builds it may do nothing. It degrades
  to the visual/audio channel exactly as before, so the worst case is today's
  behaviour rather than a regression.
*/

const IOS_SWITCH_ID = 'things-haptic-switch'
/** Comfortably longer than the switch animation, so pulses read as separate. */
const IOS_PULSE_GAP_MS = 70

let iosSwitchLabel: HTMLLabelElement | null = null

function iosSwitchSupported(): boolean {
  if (!isIOS() || typeof document === 'undefined') return false
  // Safari reflects the switch attribute as a property once it supports it.
  return 'switch' in document.createElement('input')
}

function ensureIosSwitch(): HTMLLabelElement | null {
  if (iosSwitchLabel) return iosSwitchLabel
  if (typeof document === 'undefined' || !document.body) return null

  const input = document.createElement('input')
  input.type = 'checkbox'
  input.setAttribute('switch', '')
  input.id = IOS_SWITCH_ID
  input.tabIndex = -1

  const label = document.createElement('label')
  label.htmlFor = IOS_SWITCH_ID

  // Kept rendered rather than `display:none` or `visibility:hidden` — a switch
  // that isn't laid out doesn't animate, and no animation means no haptic.
  const host = document.createElement('div')
  host.setAttribute('aria-hidden', 'true')
  host.style.cssText =
    'position:fixed;bottom:0;left:0;width:1px;height:1px;overflow:hidden;opacity:0;pointer-events:none;z-index:-1;'
  host.append(input, label)
  document.body.appendChild(host)

  iosSwitchLabel = label
  return label
}

/**
 * One tap of the hidden switch per pulse. `pulses` stands in for intensity,
 * since the sensation itself is fixed.
 */
function fireIosSwitch(pulses: number): void {
  const label = ensureIosSwitch()
  if (!label) return
  for (let i = 0; i < pulses; i++) {
    if (i === 0) label.click()
    else setTimeout(() => label.click(), i * IOS_PULSE_GAP_MS)
  }
}

/** Patterns already encode weight as their number of bursts; reuse that. */
function pulseCount(pattern: number | number[], factor: number): number {
  const base = typeof pattern === 'number' ? 1 : Math.min(3, pattern.length)
  return factor > 1 ? Math.min(4, base + 1) : factor < 1 ? 1 : base
}

/**
 * navigator.vibrate needs a prior user gesture and silently no-ops when the
 * document is hidden. Probe once so we don't keep calling into nothing.
 */
function canVibrate(): boolean {
  if (typeof document !== 'undefined' && document.hidden) return false
  vibrateProbed = true
  return true
}

// --- rate limiting ----------------------------------------------------------

/**
 * Without this, drag-reorder and fast scrolling emit a continuous buzz that
 * reads as broken hardware and drains battery. This single line is most of the
 * difference between "heavy haptics" feeling premium and feeling defective.
 */
const MIN_GAP_MS = 40
let lastFiredAt = 0

// --- public API -------------------------------------------------------------

/** Fire-and-forget. Never throws, never awaited, safe to call from render. */
export function fire(event: HapticEventName): void {
  if (perEvent[event] === false) return
  if (intensity === 'off') {
    // Visual/audio channels are independent of haptics being muted.
    pulseSink?.(event)
    soundSink?.(event)
    return
  }

  const now = Date.now()
  if (now - lastFiredAt < MIN_GAP_MS) return
  lastFiredAt = now

  const spec = EVENTS[event]
  const direction = intensity === 'subtle' ? -1 : intensity === 'heavy' ? 1 : 0
  const level = shift(spec.level, direction)
  const factor = intensity === 'subtle' ? 0.5 : intensity === 'heavy' ? 1.6 : 1

  // Visual + audio always run: on iOS they are the whole experience, and
  // elsewhere they reinforce rather than replace.
  pulseSink?.(event)
  soundSink?.(event)

  switch (resolveBackend()) {
    case 'native':
      void fireNative(level)
      return
    case 'vibrate':
      if (!vibrateProbed || canVibrate()) {
        try {
          navigator.vibrate(scalePattern(spec.pattern, factor))
        } catch {
          /* vibrate is best-effort by definition */
        }
      }
      return
    case 'ios-switch':
      fireIosSwitch(pulseCount(spec.pattern, factor))
      return
    case 'none':
      return
  }
}

async function fireNative(level: Level): Promise<void> {
  try {
    switch (level) {
      case 'selection':
        await Haptics.selectionStart()
        await Haptics.selectionChanged()
        await Haptics.selectionEnd()
        return
      case 'light':
        await Haptics.impact({ style: ImpactStyle.Light })
        return
      case 'medium':
        await Haptics.impact({ style: ImpactStyle.Medium })
        return
      case 'heavy':
        await Haptics.impact({ style: ImpactStyle.Heavy })
        return
      case 'notif-success':
        await Haptics.notification({ type: NotificationType.Success })
        return
      case 'notif-warning':
        await Haptics.notification({ type: NotificationType.Warning })
        return
      case 'notif-error':
        await Haptics.notification({ type: NotificationType.Error })
        return
    }
  } catch {
    /* Plugin missing or unavailable — feel degrades, app does not break. */
  }
}

export const ALL_HAPTIC_EVENTS = Object.keys(EVENTS) as HapticEventName[]

/** True when this device can actually produce a haptic, for honest UI copy. */
export const hasRealHaptics = (): boolean => resolveBackend() !== 'none'

/** Which mechanism is in play — Settings says so rather than guessing. */
export const hapticBackend = (): Backend => resolveBackend()

export const HAPTIC_BACKEND_LABEL: Record<Backend, string> = {
  native: 'Full haptics through Android',
  vibrate: 'Vibration through the browser',
  'ios-switch': "iOS system haptics (Apple's switch control)",
  none: 'No haptics on this device — pulses and sound instead',
}
