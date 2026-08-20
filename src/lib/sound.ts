import type { HapticEventName } from '@/data/types'

/**
 * Synthesised feedback ticks — no asset files, a distinct *shape* per event,
 * not just a different pitch.
 *
 * A single 30ms sine blip at 660Hz and one at 740Hz read as "the same click"
 * on a phone speaker — the frequency gap is real but too small to perceive
 * without them side by side. What actually reads as a different sound is
 * shape: how many notes, whether they rise or fall, and timbre (sine reads
 * soft, triangle reads bright, sawtooth reads harsh/buzzy). Every event here
 * is built from those three levers, not pitch alone.
 *
 * This is the audible half of Jackie's feedback channel, since iOS Safari has
 * no haptics at all. Default off; enabled per profile.
 */

interface Note {
  freq: number
  /** Seconds after the event fires. */
  delay: number
  /** seconds */
  dur: number
  type: OscillatorType
  gain: number
}

/** One or more notes in sequence. A single note is still a full Tone. */
type Tone = Note[]

const note = (
  freq: number,
  delay: number,
  dur: number,
  type: OscillatorType,
  gain: number,
): Note => ({ freq, delay, dur, type, gain })

const TONES: Record<HapticEventName, Tone> = {
  // Minor, frequent UI feedback: one short blip each, but a different timbre
  // per role so a run of taps doesn't blur into a single texture.
  tap: [note(680, 0, 0.03, 'sine', 0.05)],
  dragStart: [note(420, 0, 0.035, 'square', 0.035)],
  snap: [note(1400, 0, 0.014, 'sine', 0.035)],
  swipeThreshold: [note(900, 0, 0.02, 'triangle', 0.05)],
  longPress: [note(360, 0, 0.09, 'triangle', 0.06)],

  // The Owe list's swipe-to-pay. Quieter and shorter than `snap`, because
  // fourteen of these fire during one pull — at snap's level a single drag
  // would be the loudest thing the app ever does.
  zipperTick: [note(1650, 0, 0.008, 'square', 0.018)],
  // The clasp: two notes closing rather than a chime opening.
  zipperDone: [
    note(760, 0, 0.05, 'triangle', 0.07),
    note(1140, 0.05, 0.09, 'triangle', 0.075),
  ],

  // Binary state, opposite direction: a rising pair to switch on, the same
  // two notes in reverse to switch off — the ear recognises "backwards".
  toggleOn: [note(560, 0, 0.045, 'sine', 0.06), note(880, 0.045, 0.05, 'sine', 0.06)],
  toggleOff: [note(880, 0, 0.045, 'sine', 0.05), note(560, 0.045, 0.05, 'sine', 0.05)],

  // Claiming: a bright, confident two-note "dibs" — triangle reads warmer
  // than the plain sines used for toggles.
  claim: [
    note(660, 0, 0.06, 'triangle', 0.07),
    note(880, 0.055, 0.07, 'triangle', 0.075),
  ],

  // Finishing something: a three-note rising chime, the biggest positive
  // moment in the app, so it gets the most notes.
  complete: [
    note(660, 0, 0.06, 'sine', 0.07),
    note(880, 0.06, 0.06, 'sine', 0.08),
    note(1180, 0.12, 0.09, 'sine', 0.09),
  ],
  success: [
    note(660, 0, 0.06, 'sine', 0.07),
    note(880, 0.06, 0.06, 'sine', 0.08),
    note(1180, 0.12, 0.09, 'sine', 0.09),
  ],

  // Deleting: a single low sawtooth falling away — the harsher timbre and
  // downward pitch bend read as "gone", distinct from the soft toggle-off.
  delete: [note(340, 0, 0.03, 'sawtooth', 0.06), note(180, 0.03, 0.09, 'sawtooth', 0.05)],

  // Two urgency tiers below error, both using triangle (warmer than the
  // sawtooth reserved for the worst case) but warning repeats a note where
  // error falls through three, so they don't sound like the same event at
  // different volumes.
  warning: [
    note(480, 0, 0.08, 'triangle', 0.075),
    note(480, 0.12, 0.08, 'triangle', 0.075),
  ],
  error: [
    note(420, 0, 0.07, 'sawtooth', 0.08),
    note(320, 0.07, 0.07, 'sawtooth', 0.08),
    note(220, 0.14, 0.12, 'sawtooth', 0.08),
  ],
}

let ctx: AudioContext | null = null
let enabled = false

export function setSoundEnabled(next: boolean) {
  enabled = next
}

/**
 * iOS suspends any AudioContext created outside a user gesture, and a suspended
 * context never recovers on its own — creating this at import time yields a
 * permanently silent app. So it is created lazily, inside the first real touch.
 */
export function unlockAudio(): void {
  if (ctx) {
    if (ctx.state === 'suspended') void ctx.resume()
    return
  }
  try {
    const Ctor =
      window.AudioContext ??
      (window as unknown as { webkitAudioContext?: typeof AudioContext })
        .webkitAudioContext
    if (!Ctor) return
    ctx = new Ctor()
    if (ctx.state === 'suspended') void ctx.resume()
  } catch {
    ctx = null
  }
}

function blip(at: AudioContext, freq: number, dur: number, type: OscillatorType, gain: number) {
  const osc = at.createOscillator()
  const env = at.createGain()
  osc.type = type
  osc.frequency.value = freq

  const t = at.currentTime
  // Fast attack, exponential decay — a click rather than a beep.
  env.gain.setValueAtTime(0.0001, t)
  env.gain.exponentialRampToValueAtTime(gain, t + 0.005)
  env.gain.exponentialRampToValueAtTime(0.0001, t + dur)

  osc.connect(env).connect(at.destination)
  osc.start(t)
  osc.stop(t + dur + 0.02)
}

export function play(event: HapticEventName): void {
  if (!enabled || !ctx || ctx.state !== 'running') return
  const tone = TONES[event]
  if (!tone) return
  try {
    for (const n of tone) {
      if (n.delay <= 0) {
        blip(ctx, n.freq, n.dur, n.type, n.gain)
      } else {
        setTimeout(() => {
          if (ctx?.state === 'running') blip(ctx, n.freq, n.dur, n.type, n.gain)
        }, n.delay * 1000)
      }
    }
  } catch {
    /* audio is a bonus channel, never the only signal */
  }
}
