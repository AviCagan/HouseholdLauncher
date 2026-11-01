import { useEffect, useRef } from 'react'
import { anyDialogOpen } from '@/lib/dialogStack'

/**
 * Keyboard shortcuts for the laptop page.
 *
 * Layers, not one global table: the shell owns "go to Meals" and the command
 * palette, and whichever app is open adds its own — "x" finishes the selected
 * to-do in Things, "/" searches the dictionary in the Encyclopedia. The newest
 * layer is asked first, so an app can give a key a more specific meaning
 * without the shell having to know it exists.
 *
 * Three rules keep single-letter shortcuts from ever eating typing:
 *
 *   1. Nothing fires while focus is in a field, unless the binding says it
 *      may — and only chords with ⌘/Ctrl, and Escape, ever should.
 *   2. Nothing fires while a dialog is open. The dialog has the keyboard;
 *      Escape is handled by the dialog itself (see Sheet.tsx).
 *   3. A plain letter never matches with ⌘, Ctrl or Alt held, so the
 *      browser's own ⌘C, ⌘R and friends are left alone.
 *
 * Combos are written the way they'd be said: "mod+k", "g t", "?", "shift+x".
 * `mod` is ⌘ on a Mac and Ctrl elsewhere; either is accepted on any machine,
 * since nobody types Ctrl+K on a Mac by accident.
 */

export interface Binding {
  /** One combo or several that do the same thing. */
  keys: string | string[]
  run: (e: KeyboardEvent) => void
  /** Shown in the shortcut overlay. Leave it out to keep a binding unlisted. */
  label?: string
  /** Heading the overlay files it under. */
  group?: string
  /** How the overlay writes the keys, when listing every combo would be noise ("1–5"). */
  display?: string
  /** Fire even while typing in a field. Reserve for ⌘/Ctrl chords and Escape. */
  inInputs?: boolean
  /** Fire even while a dialog is open. */
  inDialogs?: boolean
}

interface Step {
  key: string
  mod: boolean
  alt: boolean
  shift: boolean
}

export interface KeyLike {
  key: string
  metaKey: boolean
  ctrlKey: boolean
  altKey: boolean
  shiftKey: boolean
}

const ALIASES: Record<string, string> = {
  ' ': 'space',
  spacebar: 'space',
  esc: 'escape',
  del: 'delete',
  up: 'arrowup',
  down: 'arrowdown',
  left: 'arrowleft',
  right: 'arrowright',
  return: 'enter',
}

/** The event's key, in the vocabulary combos are written in. */
export function normKey(key: string): string {
  const lower = key.toLowerCase()
  return ALIASES[lower] ?? lower
}

export function parseCombo(combo: string): Step[] {
  return combo
    .trim()
    .split(/\s+/)
    .map((part) => {
      // "+" itself is a key; "mod++" means mod and plus.
      const tokens = part === '+' ? ['+'] : part.endsWith('++') ? [...part.slice(0, -2).split('+'), '+'] : part.split('+')
      const step: Step = { key: '', mod: false, alt: false, shift: false }
      for (const raw of tokens) {
        const t = raw.toLowerCase()
        if (t === 'mod' || t === 'cmd' || t === 'ctrl' || t === 'meta') step.mod = true
        else if (t === 'alt' || t === 'option') step.alt = true
        else if (t === 'shift') step.shift = true
        else step.key = normKey(raw)
      }
      return step
    })
}

/**
 * Does one keypress satisfy one step of a combo?
 *
 * Shift is only enforced where it changes meaning. For a letter it does —
 * "x" and "shift+x" are different shortcuts. For a symbol it is how the
 * symbol gets typed at all ("?" is shift+/ on most layouts), so a combo
 * written as "?" matches however the keyboard produced it.
 */
export function stepMatches(step: Step, e: KeyLike): boolean {
  if (normKey(e.key) !== step.key) return false
  if (step.mod !== (e.metaKey || e.ctrlKey)) return false
  if (step.alt !== e.altKey) return false
  const letter = /^[a-z]$/.test(step.key)
  if (letter || step.key.length > 1) {
    // Letters and named keys (Enter, ArrowDown…): shift means what it says.
    if (step.shift !== e.shiftKey) return false
  }
  return true
}

/** Is focus somewhere that typing goes into? */
export function isTypingTarget(el: Element | null): boolean {
  if (!el || !(el instanceof HTMLElement)) return false
  if (el.isContentEditable) return true
  const tag = el.tagName
  if (tag === 'TEXTAREA' || tag === 'SELECT') return true
  if (tag !== 'INPUT') return false
  const type = (el as HTMLInputElement).type
  return !['checkbox', 'radio', 'button', 'submit', 'reset', 'range', 'color', 'file'].includes(type)
}

// --- the dispatcher ---------------------------------------------------------

/**
 * How a layer ranks. Effects run child-first in React, so mount order alone
 * would put the shell above the app it contains on the very first render —
 * an explicit rank is what makes "the app is asked first" true from the start.
 */
export const LAYER = { shell: 0, app: 10, overlay: 20 } as const

type Layer = { current: Binding[]; rank: number; seq: number }
let layers: Layer[] = []
let seq = 0

/** How long the second key of a two-key combo ("g t") may take to arrive. */
const SEQUENCE_MS = 1200
/** Every binding whose first key was just pressed, waiting on its second. */
let pending: { candidates: { binding: Binding; steps: Step[] }[]; at: number } | null = null

function combosOf(b: Binding): string[] {
  return Array.isArray(b.keys) ? b.keys : [b.keys]
}

/**
 * Is focus on something Enter or Space already means "press"? A focused
 * button keeps its own meaning for those two keys — tabbing to "Plan trip"
 * and pressing Enter has to plan the trip, not open whatever row the board
 * happens to have selected.
 */
export function isPressable(el: Element | null): boolean {
  if (!el || !(el instanceof HTMLElement) || el === document.body) return false
  return !!el.closest('button, a[href], summary, [role="button"], [role="option"], [role="radio"], [role="checkbox"], [role="tab"]')
}

function dispatch(e: KeyboardEvent) {
  if (e.defaultPrevented || e.isComposing) return
  const key = normKey(e.key)
  if ((key === 'enter' || key === 'space') && isPressable(document.activeElement)) return
  const typing = isTypingTarget(document.activeElement)
  const dialog = anyDialogOpen()
  const allowed = (b: Binding) => (!typing || b.inInputs) && (!dialog || b.inDialogs)

  // The second half of a two-key combo. "G" leaves every "G …" binding
  // waiting; whichever one this key completes is the one that runs.
  if (pending) {
    const { candidates, at } = pending
    pending = null
    if (Date.now() - at < SEQUENCE_MS) {
      const hit = candidates.find((c) => allowed(c.binding) && stepMatches(c.steps[1], e))
      if (hit) {
        e.preventDefault()
        hit.binding.run(e)
        return
      }
    }
  }

  const sequences: { binding: Binding; steps: Step[] }[] = []
  for (let i = layers.length - 1; i >= 0; i--) {
    for (const binding of layers[i].current) {
      if (!allowed(binding)) continue
      for (const combo of combosOf(binding)) {
        const steps = parseCombo(combo)
        if (!stepMatches(steps[0], e)) continue
        if (steps.length > 1) {
          sequences.push({ binding, steps })
          continue
        }
        // A single key bound in a higher layer wins outright.
        if (sequences.length === 0) {
          e.preventDefault()
          binding.run(e)
          return
        }
      }
    }
  }
  if (sequences.length > 0) {
    e.preventDefault()
    pending = { candidates: sequences, at: Date.now() }
  }
}

let installed = false
function install() {
  if (installed || typeof window === 'undefined') return
  installed = true
  window.addEventListener('keydown', dispatch)
}

/**
 * Register a layer of shortcuts for as long as the calling component is
 * mounted. The bindings are re-read on every keypress, so handlers always see
 * the component's latest state without re-registering.
 */
export function useKeys(bindings: Binding[], rank: number = LAYER.app): void {
  const layer = useRef<Layer>({ current: bindings, rank, seq: 0 })
  layer.current.current = bindings

  useEffect(() => {
    install()
    const entry = layer.current
    entry.seq = ++seq
    // Lowest rank first, newest last within a rank: dispatch walks backwards.
    layers = [...layers, entry].sort((a, b) => a.rank - b.rank || a.seq - b.seq)
    return () => {
      layers = layers.filter((l) => l !== entry)
    }
  }, [])
}

/** Everything currently listed, newest layer first, for the overlay. */
export function listedBindings(): Binding[] {
  const out: Binding[] = []
  for (let i = layers.length - 1; i >= 0; i--) {
    for (const b of layers[i].current) if (b.label) out.push(b)
  }
  return out
}

// --- display ----------------------------------------------------------------

export const isMac = (): boolean =>
  typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent)

const GLYPH: Record<string, string> = {
  arrowup: '↑',
  arrowdown: '↓',
  arrowleft: '←',
  arrowright: '→',
  enter: '↵',
  escape: 'Esc',
  backspace: '⌫',
  delete: 'Del',
  space: 'Space',
  tab: 'Tab',
}

/** "mod+k" → ["⌘", "K"] on a Mac, ["Ctrl", "K"] elsewhere. One array per step. */
export function comboKeys(combo: string, mac = isMac()): string[][] {
  return parseCombo(combo).map((s) => {
    const parts: string[] = []
    if (s.mod) parts.push(mac ? '⌘' : 'Ctrl')
    if (s.alt) parts.push(mac ? '⌥' : 'Alt')
    if (s.shift) parts.push(mac ? '⇧' : 'Shift')
    parts.push(GLYPH[s.key] ?? (s.key.length === 1 ? s.key.toUpperCase() : s.key))
    return parts
  })
}

/** Plain-text form for a tooltip: "⌘K", "G then T". */
export function comboLabel(combo: string, mac = isMac()): string {
  return comboKeys(combo, mac)
    .map((parts) => parts.join(mac ? '' : '+'))
    .join(' then ')
}
