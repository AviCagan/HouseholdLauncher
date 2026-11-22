import type { Onah } from './calendar'

/**
 * What the engine takes in and gives back. Only raw events go in: what
 * happened, when, and any ruling her rav gave. Everything that comes out is
 * recomputed from them every time, so a changed setting or a ruling entered
 * later redraws the whole calendar.
 */

export type EventKind =
  | 'flow'
  | 'hefsek'
  | 'moch'
  | 'bedikah'
  | 'stain'
  | 'immersion'
  | 'pregnancy'
  | 'birth'
  | 'miscarriage'
  | 'kallah'
  | 'medication'
  | 'symptom'
  | 'menopause'
  | 'seed'
  | 'kavua'
  | 'ruling'

export type CheckResult = 'clean' | 'not_clean' | 'question'

export interface MkEvent {
  id: string
  kind: EventKind
  /** When it happened, epoch ms. */
  at: number
  result?: CheckResult | null
  data?: EventData | null
  /** Voided entries are kept, never deleted, and ignored here. */
  voided?: boolean
}

export interface EventData {
  /** flow: it stopped within 24 hours (F3). */
  short?: boolean
  /** moch: forgotten, or too painful (H3). */
  forgotten?: boolean
  painful?: boolean
  /** bedikah: which daily slot she meant. */
  slot?: 'morning' | 'afternoon'
  /** miscarriage: at 40 days or more (L2). */
  over40?: boolean
  /** seed: haflagah numbers still active from before she started using the app. */
  haflagah?: number[]
  /** kavua: the pattern her rav set (K1). */
  kavua?: KavuaRuling
  /** ruling: the answer to one flag. */
  flag?: string
  outcome?: string
  /** ruling: a date her rav gave (L3: the earliest hefsek), civil 'YYYY-MM-DD'. */
  date?: string
  note?: string
}

export interface KavuaRuling {
  type: 'chodesh' | 'haflagah' | 'shavua'
  /** chodesh: the day of the month. */
  day?: number
  /** haflagah/shavua: days from the start of one flow to the next, both counted. */
  interval?: number
  half: 'night' | 'day'
  /** Whether the vestot without a pattern are kept as well, as her rav said. */
  keepOthers: boolean
}

/** His inputs: the M6 cases. Civil days, inclusive. */
export interface PartnerInput {
  away: { from: string; to: string }[]
  shiva: { from: string; to: string }[]
}

export type VesetKind = 'hachodesh' | 'haflagah' | 'haflagah_s2s' | 'beinonit' | 'beinonit31' | 'or_zarua' | 'kavua'

export interface Veset {
  key: string
  kind: VesetKind
  /** One onah, or both onot of the date for the beinonit. */
  onot: Onah[]
  start: number
  end: number
  ruleId: string
  /** "Same date as the flow on 12 Kislev" — plain words for the Why sheet. */
  reason: string
  number?: number
  fromFlow: string
  bedikahFrom: number
  bedikahDone: boolean
  /** Carried to a later month under V2 Opinion 1. */
  carried?: boolean
}

export interface FlagOption {
  value: string
  label: string
}

export interface Flag {
  key: string
  ruleId: string
  title: string
  /** The facts her rav will want, in plain sentences. */
  facts: string[]
  at: number
  /** What the calendar is holding while the question is open. */
  holds: string
  options: FlagOption[]
  /** Needs a date from her rav (L3). */
  wantsDate?: boolean
  ruling: { outcome: string; date?: string; note?: string; at: number } | null
}

export interface Slot {
  day: number
  part: 'morning' | 'afternoon'
  abs: number
  opens: number
  closes: number
  result: 'clean' | 'not_clean' | 'question' | null
  eventId: string | null
}

export interface MikvahNight {
  /** The Hebrew date whose night it is. */
  abs: number
  /** Earliest time, after nightfall plus the margin. */
  at: number
  moved: { from: number; ruleId: string; reason: string }[]
  /** Open questions holding it. */
  waitingOn: string[]
  /** Not shown as a night at all (N2 or N3). */
  withheld: string | null
  /** Friday night or a Yom Tov night: prep before candle lighting. */
  candleLighting: number | null
}

export interface Cycle {
  id: string
  /** What started it. Only a flow makes vestot. */
  cause: 'flow' | 'stain' | 'birth' | 'miscarriage' | 'kallah'
  startAt: number
  onah: Onah
  day1: number
  /** Earliest hefsek date, or null while a rav's date is awaited. */
  earliestHefsek: number | null
  hefsekDeadline: number | null
  hefsek: { eventId: string; at: number; abs: number } | null
  /** The first good hefsek, which the haflagah count keeps (V12). */
  firstHefsek: number | null
  mochConfirmed: boolean
  slots: Slot[]
  frozen: string | null
  mikvah: MikvahNight | null
  immersion: number | null
  calendar: boolean
}

export interface Reminder {
  key: string
  at: number
  audience: 'her' | 'him' | 'both'
  /** Shown inside the app, and in the notification only if she turns detail on. */
  detail: string
  ruleId: string
}

export interface Result {
  cycles: Cycle[]
  vestot: Veset[]
  flags: Flag[]
  haflagahList: number[]
  reminders: Reminder[]
  /** Yom Kippur, Tisha B'Av and shiva in the coming months. */
  separation: { abs: number; label: string; ruleId: string }[]
  /** Notes worth showing that aren't questions: a skipped hefsek, a missed bedikah. */
  warnings: { at: number; ruleId: string; text: string }[]
}
