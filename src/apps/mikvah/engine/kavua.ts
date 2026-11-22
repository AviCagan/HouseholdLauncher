import { HDate } from '@hebcal/core'
import { dayOfMonth, hdate, hebrewLabel, weekday, type Onah } from './calendar'

/**
 * Pattern notices (K1). Detects; never applies. A notice becomes a flag that
 * says "possible veset kavua — ask your rav", and nothing in the calendar
 * changes until she enters the ruling in the kavua editor. My Mikvah
 * Calendar draws the same line ("it does NOT calculate the kavua for you").
 */

export interface FlowPoint {
  id: string
  at: number
  onah: Onah
  /** The Chabad haflagah number this flow made, when there was a hefsek before it. */
  n: number | null
}

export interface Notice {
  type: 'chodesh' | 'haflagah' | 'shavua' | 'dilug' | 'sirug' | 'haguf'
  label: string
  lastFlowId: string
  facts: string[]
}

/** How many Hebrew months on from `a`'s month `b` falls: 1 for next month, 2 for the one after. */
function monthsBetween(a: number, b: number): number {
  let first = a - dayOfMonth(a) + 1
  const target = b - dayOfMonth(b) + 1
  let count = 0
  while (first < target && count < 40) {
    const h = hdate(first)
    first += HDate.daysInMonth(h.getMonth(), h.getFullYear())
    count++
  }
  return first === target ? count : -1
}

const describe = (f: FlowPoint) => `${hebrewLabel(f.onah.abs)}, ${f.onah.half} onah`

export function detectKavua(flows: FlowPoint[], symptoms: number[]): Notice[] {
  const out: Notice[] = []
  const n = flows.length
  if (n < 3) return out
  const last3 = flows.slice(-3)
  const lastId = flows[n - 1].id

  // Chodesh: the same Hebrew date and onah, three times running, a month apart.
  const sameDay = last3.every((f) => dayOfMonth(f.onah.abs) === dayOfMonth(last3[0].onah.abs) && f.onah.half === last3[0].onah.half)
  const gap1 = monthsBetween(last3[0].onah.abs, last3[1].onah.abs)
  const gap2 = monthsBetween(last3[1].onah.abs, last3[2].onah.abs)
  if (sameDay && gap1 === 1 && gap2 === 1) {
    out.push({ type: 'chodesh', label: 'veset kavua hachodesh', lastFlowId: lastId, facts: last3.map(describe) })
  }

  // Sirug: the same date and onah every other month, three times.
  if (sameDay && gap1 === 2 && gap2 === 2) {
    out.push({ type: 'sirug', label: 'every-other-month pattern', lastFlowId: lastId, facts: last3.map(describe) })
  }

  // Dilug (by date): the date moving by the same step each month, same onah.
  const d = last3.map((f) => dayOfMonth(f.onah.abs))
  if (
    !sameDay &&
    last3.every((f) => f.onah.half === last3[0].onah.half) &&
    gap1 === 1 &&
    gap2 === 1 &&
    d[1] - d[0] === d[2] - d[1] &&
    d[1] !== d[0]
  ) {
    out.push({ type: 'dilug', label: 'a date moving by the same step each month', lastFlowId: lastId, facts: last3.map(describe) })
  }

  if (n >= 4) {
    const last4 = flows.slice(-4)
    const sameHalf = last4.every((f) => f.onah.half === last4[0].onah.half)
    // Haflagah: three equal haflagah numbers (four flows), same onah.
    const ns = last4.slice(1).map((f) => f.n)
    if (sameHalf && ns.every((x) => x !== null && x === ns[0])) {
      out.push({ type: 'haflagah', label: `veset kavua haflagah (${ns[0]})`, lastFlowId: lastId, facts: last4.map(describe) })
    }
    // Shavua: the same weekday, the same number of weeks, three times.
    const gaps = last4.slice(1).map((f, i) => f.onah.abs - last4[i].onah.abs)
    if (
      sameHalf &&
      gaps.every((g) => g === gaps[0] && g % 7 === 0) &&
      last4.every((f) => weekday(f.onah.abs) === weekday(last4[0].onah.abs))
    ) {
      out.push({ type: 'shavua', label: `the same weekday every ${gaps[0] / 7} weeks`, lastFlowId: lastId, facts: last4.map(describe) })
    }
    // Dilug (by interval): intervals growing or shrinking by a constant step.
    if (sameHalf && gaps[1] - gaps[0] === gaps[2] - gaps[1] && gaps[1] !== gaps[0]) {
      out.push({ type: 'dilug', label: 'intervals growing or shrinking steadily', lastFlowId: lastId, facts: last4.map(describe) })
    }
  }

  // Haguf: a body symptom logged in the day before each of three flows.
  if (last3.every((f) => symptoms.some((t) => t <= f.at && f.at - t <= 86_400_000))) {
    out.push({ type: 'haguf', label: 'a body symptom before each flow', lastFlowId: lastId, facts: last3.map(describe) })
  }
  return out
}
