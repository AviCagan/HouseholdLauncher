import {
  absOfCivil,
  civilDayIn,
  civilOf,
  dayOfMonth,
  fromIndex,
  hebrewLabel,
  isMonth,
  onahIndex,
  sameDayNextMonth,
  weekday,
  type Half,
  type Onah,
  type Zmanim,
} from './calendar'
import { detectKavua } from './kavua'
import type { Settings } from './settings'
import type {
  Cycle,
  Flag,
  FlagOption,
  MikvahNight,
  MkEvent,
  PartnerInput,
  Result,
  Slot,
  Veset,
  VesetKind,
} from './types'

/**
 * The calendar, calculated.
 *
 * Pure: events, settings, a zmanim provider and "now" in; the whole
 * calendar out. No database, no UI, no clock of its own. Every date carries
 * the rule that produced it, and every case the prompt lists as a question
 * for a rav raises a flag instead of a decision — what that flag affects is
 * held until she enters the answer as a ruling, which is just another event.
 */

const MIN = 60_000
const DAY = 86_400_000

export interface Input {
  events: MkEvent[]
  settings: Settings
  zmanim: Zmanim
  now: number
  partner?: PartnerInput
}

/** Where an instant falls: the Hebrew date and onah, and how close it was to shkiah. */
export interface Placed {
  onah: Onah
  day: string
  /** Between shkiah and tzeit (F2). */
  bin: boolean
  /** Within 15 minutes of shkiah: confirm the time before saving. */
  nearShkiah: boolean
  /** Within 9 minutes after shkiah (F2's lenient option). */
  withinNine: boolean
  /** The place had no netz, shkiah or tzeit that day. */
  noZmanim: boolean
}

export function place(t: number, z: Zmanim, s: Settings): Placed {
  const where = z.placeAt(t)
  const day = civilDayIn(t, where.tz)
  const times = z.times(day, where)
  const shk = s.sunset === 'amitis' ? times.shkiahAmitis : times.shkiah
  const abs = absOfCivil(day)
  if (shk === null || times.netz === null || times.tzeit === null) {
    return { onah: { abs, half: 'day' }, day, bin: false, nearShkiah: false, withinNine: false, noZmanim: true }
  }
  const onah: Onah = t >= shk ? { abs: abs + 1, half: 'night' } : t < times.netz ? { abs, half: 'night' } : { abs, half: 'day' }
  return {
    onah,
    day,
    bin: t >= shk && t < times.tzeit,
    nearShkiah: Math.abs(t - shk) <= 15 * MIN,
    withinNine: t >= shk && t - shk <= 9 * MIN,
    noZmanim: false,
  }
}

/** When an onah starts and ends, widened by the margin on both sides. */
export function onahSpan(o: Onah, z: Zmanim, s: Settings, margin = true): { start: number; end: number } {
  const m = margin ? s.marginMinutes * MIN : 0
  const shk = (day: string) => {
    const t = z.times(day)
    return (s.sunset === 'amitis' ? t.shkiahAmitis : t.shkiah) ?? NaN
  }
  const day = civilOf(o.abs)
  if (o.half === 'night') {
    const prev = civilOf(o.abs - 1)
    return { start: shk(prev) - m, end: (z.times(day).netz ?? NaN) + m }
  }
  return { start: (z.times(day).netz ?? NaN) - m, end: shk(day) + m }
}

const label = (o: Onah) => `the ${o.half} onah of ${hebrewLabel(o.abs)}`

// --- flags ------------------------------------------------------------------------

const VALID: FlagOption[] = [
  { value: 'valid', label: 'My rav said it counts' },
  { value: 'invalid', label: 'My rav said it does not count' },
]
const RESOLVED: FlagOption[] = [{ value: 'resolved', label: 'Answered — the calendar stands' }]
const SEVEN_DAYS: FlagOption[] = [
  { value: 'fine', label: 'Carry on: the count stands' },
  { value: 'restart_stain', label: 'Restart with a new hefsek; not a new flow for the calendar' },
  { value: 'restart_flow', label: 'Restart with a new hefsek; a new flow for the calendar' },
]

interface Ruling {
  outcome: string
  date?: string
  note?: string
  at: number
}

// --- the walk -----------------------------------------------------------------------

interface Segment {
  /** The calendar flow this segment's hefsek belongs to, if any. */
  flowId: string | null
  startAt: number
  earliest: number | null
  attempts: { id: string; at: number; abs: number; ok: boolean; held: boolean }[]
}

interface Working extends Cycle {
  segments: Segment[]
  flowIds: string[]
  bedikahEvents: MkEvent[]
}

interface CalFlow {
  id: string
  at: number
  /** The onah the five days and haflagah are counted from. */
  primary: Onah
  /** The onot the vestot are counted from: one, or both for a bein-hashmashot flow under that setting. */
  onot: Onah[]
  cycle: Working
  /** 1 for the first flow after a birth, 2 for the second; 0 otherwise. */
  afterBirth: number
  /** Set once its segment's hefsek is known. */
  hefsek: number | null
  /** Haflagah number this flow made (Chabad count), for the pattern notice. */
  n: number | null
}

export function calculate(input: Input): Result {
  const { settings: s, zmanim: z, now } = input
  const partner = input.partner ?? { away: [], shiva: [] }
  const events = input.events.filter((e) => !e.voided).sort((a, b) => a.at - b.at || a.id.localeCompare(b.id))

  const rulings = new Map<string, Ruling>()
  for (const e of events) {
    if (e.kind === 'ruling' && e.data?.flag) {
      rulings.set(e.data.flag, { outcome: e.data.outcome ?? 'resolved', date: e.data.date, note: e.data.note, at: e.at })
    }
  }

  const flags = new Map<string, Flag>()
  const warnings: Result['warnings'] = []
  function raise(f: Omit<Flag, 'ruling'>): Ruling | null {
    const ruling = rulings.get(f.key) ?? null
    flags.set(f.key, { ...f, ruling })
    return ruling
  }

  const cycles: Working[] = []
  const calFlows: CalFlow[] = []
  let cur: Working | null = null
  const tehorahBedikot: MkEvent[] = []
  let seed: { at: number; numbers: number[] } | null = null
  let pregnantFrom: number | null = null
  let lastImmersion: number | null = null
  let birthAt: number | null = null
  let flowsSinceBirth = 0
  let menopause: { since: number; flows: number[] } | null = null
  const symptoms: number[] = []
  const kavuaRulings: { at: number; k: NonNullable<MkEvent['data']>['kavua'] }[] = []

  const open = (w: Working | null): w is Working => !!w && w.immersion === null
  const seg = (w: Working) => w.segments[w.segments.length - 1]

  function newCycle(e: MkEvent, cause: Cycle['cause'], at: Placed, day1: number, earliest: number | null, calendar: boolean): Working {
    const w: Working = {
      id: e.id,
      cause,
      startAt: e.at,
      onah: at.onah,
      day1,
      earliestHefsek: earliest,
      hefsekDeadline: null,
      hefsek: null,
      firstHefsek: null,
      mochConfirmed: false,
      slots: [],
      frozen: null,
      mikvah: null,
      immersion: null,
      calendar,
      segments: [{ flowId: calendar ? e.id : null, startAt: e.at, earliest, attempts: [] }],
      flowIds: [],
      bedikahEvents: [],
    }
    cycles.push(w)
    return w
  }

  function addCalFlow(e: MkEvent, primary: Onah, onot: Onah[], w: Working) {
    if (birthAt !== null) flowsSinceBirth++
    const f: CalFlow = { id: e.id, at: e.at, primary, onot, cycle: w, afterBirth: birthAt !== null ? flowsSinceBirth : 0, hefsek: null, n: null }
    calFlows.push(f)
    w.flowIds.push(e.id)
    return f
  }

  /** The last attempt of each day before the deadline counts (H1); the first good day is the hefsek. */
  function resolveHefsek(w: Working) {
    const sg = seg(w)
    w.hefsek = null
    const byDay = new Map<number, Segment['attempts'][number]>()
    for (const a of sg.attempts) byDay.set(a.abs, a)
    for (const abs of [...byDay.keys()].sort((a, b) => a - b)) {
      const a = byDay.get(abs)!
      if (a.ok && !a.held) {
        w.hefsek = { eventId: a.id, at: a.at, abs }
        break
      }
    }
    if (w.hefsek && w.segments.length === 1) w.firstHefsek = w.hefsek.abs
    if (w.hefsek && w.firstHefsek === null) w.firstHefsek = w.hefsek.abs
  }

  for (const e of events) {
    switch (e.kind) {
      case 'flow': {
        const at = place(e.at, z, s)
        if (at.noZmanim) {
          raise({
            key: `ZM:${e.id}`,
            ruleId: 'ZM',
            title: 'No sunset or nightfall where you were',
            facts: [`A flow was logged on ${at.day}, at a place with no netz, shkiah or tzeit that day.`],
            at: e.at,
            holds: 'Nothing is calculated from this flow.',
            options: RESOLVED,
          })
          if (!open(cur)) cur = newCycle(e, 'flow', at, at.onah.abs, null, false)
          break
        }
        if (open(cur) && cur.hefsek && !cur.frozen) {
          // Bleeding during the seven clean days (N3).
          const r = raise({
            key: `N3:${e.id}`,
            ruleId: 'N3',
            title: 'Bleeding during the seven clean days',
            facts: [`Seen ${hebrewLabel(at.onah.abs)}, ${at.onah.half}, during clean day ${at.onah.abs - cur.hefsek.abs}.`],
            at: e.at,
            holds: 'The count and mikvah night are on hold.',
            options: SEVEN_DAYS,
          })
          applySevenDays(cur, e, at, r)
          break
        }
        if (open(cur)) {
          // Still bleeding, or bleeding again before a hefsek: the same period (D2).
          if (cur.frozen?.startsWith('N3') || cur.segments.length > 1) applySevenDays(cur, e, at, rulings.get(`N3:${e.id}`) ?? null)
          break
        }

        // A new period.
        let primary = at.onah
        let onot: Onah[] = [at.onah]
        let day1 = at.onah.abs
        if (at.bin) {
          const r = raise({
            key: `F2:${e.id}`,
            ruleId: 'F2',
            title: 'A flow between shkiah and nightfall',
            facts: [`Seen at ${new Date(e.at).toISOString()} (bein hashmashot), ${at.day}.`],
            at: e.at,
            holds: 'The five days and the vestot follow your settings until your rav answers.',
            options: [
              { value: 'night', label: 'Count it as night' },
              { value: 'day', label: 'Count it as the day before' },
              { value: 'five_day', label: 'Five days from the day before; vestot from the night' },
              { value: 'both', label: 'Five days from the night; vestot on both onot' },
            ],
          })
          const prevDay: Onah = { abs: at.onah.abs - 1, half: 'day' }
          const choice = r?.outcome ?? null
          const fiveFromPrev = choice === 'day' || choice === 'five_day' || (choice === null && s.binFiveDays === 'prev_day_9min' && at.withinNine)
          const vestotBoth = choice === 'both' || (choice === null && s.binVestot === 'both')
          if (fiveFromPrev) day1 = prevDay.abs
          if (choice === 'day') {
            primary = prevDay
            onot = [prevDay]
          } else if (vestotBoth) {
            onot = [prevDay, at.onah]
          }
        }

        let calendar = true
        if (e.data?.short) {
          const r = raise({
            key: `F3:${e.id}`,
            ruleId: 'F3',
            title: 'A flow that lasted under 24 hours',
            facts: [`Seen ${label(at.onah)} and stopped within a day.`],
            at: e.at,
            holds: 'It counts as a flow for the calendar until your rav answers.',
            options: [
              { value: 'counts', label: 'It counts as a flow' },
              { value: 'not_flow', label: 'Not a flow for the calendar' },
            ],
          })
          if (r?.outcome === 'not_flow') calendar = false
        }
        if (pregnantFrom !== null) {
          raise({
            key: `L1:${e.id}`,
            ruleId: 'L1',
            title: 'Bleeding in pregnancy',
            facts: [`Seen ${label(at.onah)}.`],
            at: e.at,
            holds: 'No vestot are made from it until your rav answers.',
            options: RESOLVED,
          })
          calendar = false
        }
        if (menopause) {
          menopause.flows.push(e.at)
          const f = menopause.flows
          if (f.length >= 3 && f.slice(-3).every((t, i, a) => i === 0 || t - a[i - 1] < 90 * DAY)) menopause = null
          else calendar = false
        }

        const earliest = day1 + s.minDays - 1
        cur = newCycle(e, 'flow', at, day1, earliest, calendar)
        cur.onah = primary
        if (calendar) addCalFlow(e, primary, onot, cur)
        break
      }

      case 'hefsek': {
        if (!open(cur)) {
          warnings.push({ at: e.at, ruleId: 'H1', text: 'A hefsek was logged with no period open; it was ignored.' })
          break
        }
        const sg = seg(cur)
        const at = place(e.at, z, s)
        const abs = absOfCivil(at.day)
        if (sg.earliest === null) {
          warnings.push({ at: e.at, ruleId: 'L3', text: 'A hefsek was logged before the earliest date from your rav was entered.' })
          break
        }
        if (abs < sg.earliest) {
          warnings.push({ at: e.at, ruleId: 'D1', text: `A hefsek on ${hebrewLabel(abs)} is before the earliest day, ${hebrewLabel(sg.earliest)}; it doesn't count.` })
          break
        }
        const times = z.times(at.day)
        const shk = (s.sunset === 'amitis' ? times.shkiahAmitis : times.shkiah) ?? NaN
        let held = false
        if (e.at > shk - s.marginMinutes * MIN) {
          const r = raise({
            key: `H1:${e.id}`,
            ruleId: 'H1',
            title: 'A hefsek after shkiah',
            facts: [`Done ${Math.round((e.at - shk) / MIN)} minutes from shkiah on ${hebrewLabel(abs)}.`],
            at: e.at,
            holds: "It doesn't count until your rav answers.",
            options: VALID,
          })
          if (r?.outcome !== 'valid') held = true
        }
        if (times.minchaKetanah !== null && e.at < times.minchaKetanah) {
          const r = raise({
            key: `H2:${e.id}`,
            ruleId: 'H2',
            title: 'A hefsek before mincha ketanah',
            facts: [`Done before mincha ketanah on ${hebrewLabel(abs)}.`],
            at: e.at,
            holds: "It doesn't count until your rav answers.",
            options: VALID,
          })
          if (r?.outcome !== 'valid') held = true
        }
        let ok = e.result === 'clean'
        if (e.result === 'question') {
          const r = raise({
            key: `HQ:${e.id}`,
            ruleId: 'ASK',
            title: 'A doubtful colour on a hefsek',
            facts: [`Hefsek on ${hebrewLabel(abs)}.`],
            at: e.at,
            holds: "It doesn't count until your rav answers.",
            options: [
              { value: 'clean', label: 'My rav said it is clean' },
              { value: 'not_clean', label: 'My rav said it is not clean' },
            ],
          })
          ok = r?.outcome === 'clean'
        }
        sg.attempts.push({ id: e.id, at: e.at, abs, ok, held })
        resolveHefsek(cur)
        break
      }

      case 'moch': {
        if (!open(cur) || !cur.hefsek) break
        const r =
          e.data?.forgotten || e.data?.painful || e.result === 'not_clean' || e.result === 'question'
            ? raise({
                key: `H3:${e.id}`,
                ruleId: 'H3',
                title: e.data?.forgotten ? 'A forgotten moch dachuk' : e.data?.painful ? 'A painful moch dachuk' : 'The moch dachuk was not clean',
                facts: [`For the hefsek on ${hebrewLabel(cur.hefsek.abs)}.`],
                at: e.at,
                holds: 'The count and mikvah night are on hold.',
                options: VALID,
              })
            : null
        if (r === null && e.result === 'clean' && !e.data?.forgotten && !e.data?.painful) cur.mochConfirmed = true
        else if (r?.outcome === 'valid') cur.mochConfirmed = true
        else if (r?.outcome === 'invalid') {
          // Start again from a new hefsek, no new five days (D2).
          const sg = seg(cur)
          for (const a of sg.attempts) if (a.abs === cur.hefsek.abs) a.ok = false
          resolveHefsek(cur)
        } else cur.frozen = `H3:${e.id}`
        break
      }

      case 'bedikah': {
        if (open(cur) && cur.hefsek) {
          cur.bedikahEvents.push(e)
          if (e.result === 'not_clean' || e.result === 'question') {
            const at = place(e.at, z, s)
            const r = raise({
              key: `N3:${e.id}`,
              ruleId: 'N3',
              title: e.result === 'question' ? 'A doubtful bedikah during the seven days' : 'A bedikah that was not clean',
              facts: [`On ${hebrewLabel(absOfCivil(at.day))}, clean day ${absOfCivil(at.day) - cur.hefsek.abs}.`],
              at: e.at,
              holds: 'The count and mikvah night are on hold.',
              options: SEVEN_DAYS,
            })
            applySevenDays(cur, e, at, r)
          }
        } else if (!open(cur)) {
          tehorahBedikot.push(e)
          if (e.result === 'not_clean' || e.result === 'question') {
            raise({
              key: `V11:${e.id}`,
              ruleId: 'V11',
              title: 'An onah bedikah that was not clean',
              facts: [`At ${new Date(e.at).toISOString()}.`],
              at: e.at,
              holds: 'Log a flow if your rav says to.',
              options: RESOLVED,
            })
          }
        }
        break
      }

      case 'stain': {
        const at = place(e.at, z, s)
        if (open(cur) && cur.hefsek) {
          const r = raise({
            key: `N3:${e.id}`,
            ruleId: 'N3',
            title: 'A stain during the seven clean days',
            facts: [`Found ${label(at.onah)}.`, e.data?.note ?? ''].filter(Boolean),
            at: e.at,
            holds: 'The count and mikvah night are on hold.',
            options: SEVEN_DAYS.filter((o) => o.value !== 'restart_flow'),
          })
          applySevenDays(cur, e, at, r)
          break
        }
        const r = raise({
          key: `V12:${e.id}`,
          ruleId: 'V12',
          title: 'A stain',
          facts: [`Found ${label(at.onah)}.`, e.data?.note ?? ''].filter(Boolean),
          at: e.at,
          holds: 'Logged only. A stain makes no veset.',
          options: [
            { value: 'no_effect', label: 'No effect' },
            { value: 'niddah', label: 'She is niddah (enter the earliest hefsek your rav gave)' },
          ],
          wantsDate: true,
        })
        if (r?.outcome === 'niddah' && !open(cur)) {
          cur = newCycle(e, 'stain', at, at.onah.abs, r.date ? absOfCivil(r.date) : null, false)
        }
        break
      }

      case 'immersion': {
        if (open(cur)) cur.immersion = e.at
        lastImmersion = e.at
        break
      }

      case 'pregnancy': {
        pregnantFrom = lastImmersion ?? e.at
        break
      }

      case 'birth':
      case 'miscarriage': {
        const at = place(e.at, z, s)
        const countsAsBirth = e.kind === 'birth' || !!e.data?.over40
        if (e.kind === 'miscarriage' && !e.data?.over40) {
          raise({
            key: `L2:${e.id}`,
            ruleId: 'L2',
            title: 'A miscarriage before 40 days',
            facts: ['How it affects the calendar is a question for your rav.'],
            at: e.at,
            holds: 'The calendar continues as before.',
            options: RESOLVED,
          })
        }
        const r = raise({
          key: `L3:${e.id}`,
          ruleId: 'L3',
          title: 'The earliest hefsek after a birth',
          facts: [`${e.kind === 'birth' ? 'Birth' : 'Miscarriage'} on ${hebrewLabel(at.onah.abs)}.`],
          at: e.at,
          holds: 'No hefsek day is shown until you enter the date your rav gives.',
          options: [{ value: 'date', label: 'Enter the date my rav gave' }],
          wantsDate: true,
        })
        if (open(cur)) cur.immersion = cur.immersion ?? e.at
        cur = newCycle(e, e.kind === 'birth' ? 'birth' : 'miscarriage', at, at.onah.abs, r?.date ? absOfCivil(r.date) : null, false)
        pregnantFrom = null
        if (countsAsBirth) {
          birthAt = e.at
          flowsSinceBirth = 0
        }
        break
      }

      case 'kallah': {
        const at = place(e.at, z, s)
        const r = raise({
          key: `L6:${e.id}`,
          ruleId: 'L6',
          title: 'A kallah: the first hefsek',
          facts: [`Bleeding after first relations, ${label(at.onah)}. It has no effect on the calendar.`],
          at: e.at,
          holds: 'No hefsek day is shown until you enter the date your rav gives.',
          options: [{ value: 'date', label: 'Enter the date my rav gave' }],
          wantsDate: true,
        })
        if (!open(cur)) cur = newCycle(e, 'kallah', at, at.onah.abs, r?.date ? absOfCivil(r.date) : null, false)
        break
      }

      case 'medication': {
        raise({
          key: `L5:${e.id}`,
          ruleId: 'L5',
          title: 'Medication, contraception or a procedure',
          facts: [e.data?.note ?? 'A change that may affect the cycle.'],
          at: e.at,
          holds: 'Nothing changes automatically.',
          options: RESOLVED,
        })
        break
      }

      case 'menopause':
        menopause = { since: e.at, flows: [] }
        break
      case 'symptom':
        symptoms.push(e.at)
        break
      case 'seed':
        if (e.data?.haflagah?.length) seed = { at: e.at, numbers: [...e.data.haflagah] }
        break
      case 'kavua':
        if (e.data?.kavua) kavuaRulings.push({ at: e.at, k: e.data.kavua })
        break
      case 'ruling':
        break
    }
  }

  function applySevenDays(w: Working, e: MkEvent, at: Placed, r: Ruling | null) {
    if (r === null) {
      w.frozen = `N3:${e.id}`
      return
    }
    if (r.outcome === 'fine') {
      if (w.frozen === `N3:${e.id}`) w.frozen = null
      return
    }
    // Restart: a new hefsek with no new five-day wait (D2), from the day it was seen.
    w.frozen = null
    const isFlow = r.outcome === 'restart_flow'
    w.segments.push({ flowId: isFlow ? e.id : null, startAt: e.at, earliest: at.onah.abs, attempts: [] })
    w.hefsek = null
    w.mochConfirmed = false
    w.bedikahEvents = []
    if (isFlow && w.calendar) addCalFlow(e, at.onah, [at.onah], w)
  }

  // --- each cycle: hefsek, the seven days, mikvah night --------------------------------

  const m = s.marginMinutes * MIN
  const flowById = new Map(calFlows.map((f) => [f.id, f]))
  for (const w of cycles) {
    const sg = seg(w)
    w.earliestHefsek = sg.earliest
    if (sg.earliest !== null) {
      const t = z.times(civilOf(sg.earliest))
      const shk = (s.sunset === 'amitis' ? t.shkiahAmitis : t.shkiah) ?? NaN
      w.hefsekDeadline = shk - m
    }
    // Which calendar flow each segment's hefsek belongs to.
    w.segments.forEach((g, i) => {
      if (i === w.segments.length - 1 && w.hefsek && g.flowId) {
        const f = flowById.get(g.flowId)
        if (f) f.hefsek = w.hefsek.abs
      }
    })
    // V12: a stain-forced new hefsek leaves the haflagah counting from the first one.
    const first = w.segments[0]
    if (first.flowId && w.firstHefsek !== null) {
      const f = flowById.get(first.flowId)
      if (f && f.hefsek === null) f.hefsek = w.firstHefsek
    }
    if (!w.hefsek) continue
    w.slots = sevenDays(w, z, s)
  }

  function sevenDays(w: Working, zz: Zmanim, ss: Settings): Slot[] {
    const H = w.hefsek!.abs
    const slots: Slot[] = []
    for (let n = 1; n <= 7; n++) {
      const abs = H + n
      const day = civilOf(abs)
      const t = zz.times(day)
      const netz = (t.netz ?? NaN) + ss.marginMinutes * MIN
      const shk = ((ss.sunset === 'amitis' ? t.shkiahAmitis : t.shkiah) ?? NaN) - ss.marginMinutes * MIN
      const mid = (netz + shk) / 2
      slots.push({ day: n, part: 'morning', abs, opens: netz, closes: shk, result: null, eventId: null })
      slots.push({ day: n, part: 'afternoon', abs, opens: mid, closes: shk, result: null, eventId: null })
    }
    for (const e of w.bedikahEvents) {
      const at = place(e.at, zz, ss)
      const abs = absOfCivil(at.day)
      const n = abs - H
      if (n < 1 || n > 7) continue
      const t = zz.times(at.day)
      const shk = (ss.sunset === 'amitis' ? t.shkiahAmitis : t.shkiah) ?? NaN
      if (e.at >= shk || (t.netz !== null && e.at < t.netz)) {
        warnings.push({ at: e.at, ruleId: 'N1', text: `A bedikah ${e.at >= shk ? 'after shkiah' : 'before netz'} on clean day ${n} doesn't count.` })
        continue
      }
      const mid = ((t.netz ?? 0) + shk) / 2
      const part = e.data?.slot ?? (e.at < mid ? 'morning' : 'afternoon')
      const slot = slots.find((x) => x.day === n && x.part === part)!
      if (!slot.result || slot.result === 'clean' || e.result !== 'clean') {
        slot.result = (e.result ?? 'clean') as Slot['result']
        slot.eventId = e.id
      }
    }
    return slots
  }

  function mikvahNight(w: Working): MikvahNight | null {
    const H = w.hefsek!.abs
    if (w.frozen) return { abs: H + 8, at: NaN, moved: [], waitingOn: [w.frozen], withheld: w.frozen, candleLighting: null }

    // N2: day 1 and day 7 each need at least one bedikah, once the day is over.
    for (const n of [1, 7]) {
      const daySlots = w.slots.filter((x) => x.day === n)
      const over = now > daySlots[0].closes
      if (over && !daySlots.some((x) => x.result === 'clean')) {
        const r = raise({
          key: `N2:${w.id}:${n}`,
          ruleId: 'N2',
          title: `No bedikah on clean day ${n}`,
          facts: [`Clean day ${n} was ${hebrewLabel(H + n)}.`],
          at: daySlots[0].closes,
          holds: 'No mikvah night is shown until your rav answers.',
          options: [
            { value: 'ok', label: 'My rav said the count stands' },
            { value: 'restart', label: 'My rav said to start a new count' },
          ],
        })
        if (r?.outcome !== 'ok') return { abs: H + 8, at: NaN, moved: [], waitingOn: [`N2:${w.id}:${n}`], withheld: 'N2', candleLighting: null }
      }
    }
    for (const x of w.slots) {
      if (x.result === null && now > x.closes && x.day !== 1 && x.day !== 7) {
        warnings.push({ at: x.closes, ruleId: 'N2', text: `Missed the ${x.part} bedikah on clean day ${x.day}. The count still stands.` })
      }
    }

    let abs = H + 8
    const moved: MikvahNight['moved'] = []
    const waitingOn: string[] = []
    for (let guard = 0; guard < 40; guard++) {
      const evening = civilOf(abs - 1)
      if (isMonth(abs, 'Tishrei', 10)) {
        moved.push({ from: abs, ruleId: 'M2', reason: 'Yom Kippur night: moved to the next night.' })
        abs++
        continue
      }
      if (isMonth(abs, 'Av', 9) && weekday(abs) !== 6) {
        moved.push({ from: abs, ruleId: 'M2', reason: "Tisha B'Av night: moved to the next night." })
        abs++
        continue
      }
      if (isMonth(abs, 'Av', 10) && weekday(abs - 1) === 6) {
        const r = raise({
          key: `M3:${w.id}:${abs}`,
          ruleId: 'M3',
          title: "Mikvah night on the night the postponed Tisha B'Av fast begins",
          facts: [`9 Av fell on Shabbat; the fast begins motzaei Shabbat, ${hebrewLabel(abs)}.`],
          at: Date.parse(`${evening}T12:00:00Z`),
          holds: 'Mikvah night is on hold until your rav answers.',
          options: [
            { value: 'immerse', label: 'My rav said to immerse that night' },
            { value: 'next_night', label: 'My rav said to wait for the next night' },
          ],
        })
        if (r?.outcome === 'next_night') {
          moved.push({ from: abs, ruleId: 'M3', reason: 'Your rav said to wait for the next night.' })
          abs++
          continue
        }
        if (r?.outcome !== 'immerse') waitingOn.push(`M3:${w.id}:${abs}`)
      }
      const night: Onah = { abs, half: 'night' }
      const onOnah = vestotCovering(night)
      if (onOnah.length > 0) {
        const key = `M5:${w.id}:${abs}`
        const r = raise({
          key,
          ruleId: 'M5',
          title: 'Mikvah night falls on an onat perishah',
          facts: [`${hebrewLabel(abs)} is ${onOnah.map((v) => vesetName(v.kind)).join(' and ')}.`],
          at: Date.parse(`${evening}T12:00:00Z`),
          holds:
            s.mikvahOnOnah === 'postpone'
              ? 'Postponed to the next permitted night, as the Chabad practice is; confirm with your rav.'
              : s.mikvahOnOnah === 'immerse_no_relations'
                ? 'Shown on time, with no relations that night, per your setting; confirm with your rav.'
                : 'On hold until your rav answers.',
          options: [
            { value: 'postpone', label: 'Postpone to the next permitted night' },
            { value: 'immerse_no_relations', label: 'Immerse, without relations that night' },
          ],
        })
        const choice = r?.outcome ?? (s.mikvahOnOnah === 'ask' ? null : s.mikvahOnOnah)
        if (choice === 'postpone') {
          moved.push({ from: abs, ruleId: 'M5', reason: `It falls on ${onOnah.map((v) => vesetName(v.kind)).join(' and ')}: postponed to the next permitted night.` })
          abs++
          continue
        }
        if (choice === null) waitingOn.push(key)
      }
      const inRange = (rs: { from: string; to: string }[]) => rs.some((x) => x.from <= evening && evening <= x.to)
      if (inRange(partner.away) || inRange(partner.shiva)) {
        const key = `M6:${w.id}:${abs}`
        const r = raise({
          key,
          ruleId: 'M6',
          title: inRange(partner.shiva) ? 'Mikvah night during shiva' : 'Mikvah night while he is away',
          facts: [`Mikvah night would be ${hebrewLabel(abs)}.`],
          at: Date.parse(`${evening}T12:00:00Z`),
          holds: 'On hold until your rav answers.',
          options: [
            { value: 'wait', label: 'Wait until he is back / shiva is over' },
            { value: 'immerse', label: 'My rav said to immerse' },
          ],
        })
        if (r?.outcome === 'wait') {
          moved.push({ from: abs, ruleId: 'M6', reason: 'Waiting until he is back, or shiva is over.' })
          abs++
          continue
        }
        if (r?.outcome !== 'immerse') waitingOn.push(key)
      }
      break
    }

    const evening = civilOf(abs - 1)
    const restBefore = z.isRestDay(evening)
    const base = restBefore ? z.times(evening).tzeitShabbat : s.tzeitAngle === 6 ? z.times(evening).tzeit : z.tzeitAt(evening, s.tzeitAngle)
    const restTonight = z.isRestDay(civilOf(abs)) && !restBefore
    const shk = z.times(evening).shkiah
    return {
      abs,
      at: (base ?? NaN) + m,
      moved,
      waitingOn,
      withheld: null,
      candleLighting: restTonight && shk !== null ? shk - 18 * MIN : null,
    }
  }

  // --- vestot ---------------------------------------------------------------------

  const vestot: Veset[] = []
  const bleeding = cycles
    .filter((w) => w.cause === 'flow')
    // A period with no hefsek yet is bleeding up to now, not forever.
    .map((w) => ({ from: onahIndex(w.onah), to: w.firstHefsek !== null ? onahIndex({ abs: w.firstHefsek, half: 'day' }) : onahIndex(place(now, z, s).onah) }))
  const inBleeding = (o: Onah, exceptFrom: number) => bleeding.some((b) => b.from !== exceptFrom && b.from <= onahIndex(o) && onahIndex(o) <= b.to)
  const birthIndex = birthAt !== null ? place(birthAt, z, s).onah : null
  const conception = pregnantFrom !== null ? place(pregnantFrom, z, s).onah.abs : null
  const pregnancyLimit = conception !== null ? addMonths(conception, 3) : null
  const kavuaNoOthers = kavuaRulings.find((k) => k.k && !k.k.keepOthers)?.at ?? null
  const suppressed = (o: Onah, kind: VesetKind) => {
    if (pregnancyLimit !== null && o.abs > pregnancyLimit) return true
    if (kavuaNoOthers !== null && kind !== 'kavua' && onahIndex(o) > onahIndex(place(kavuaNoOthers, z, s).onah)) return true
    return false
  }

  function push(kind: VesetKind, onot: Onah[], f: CalFlow, ruleId: string, reason: string, extra: Partial<Veset> = {}) {
    if (onot.some((o) => suppressed(o, kind))) return
    const first = onahSpan(onot[0], z, s)
    const last = onahSpan(onot[onot.length - 1], z, s)
    const key = `${kind}:${f.id}:${onahIndex(onot[0])}${extra.number ? `:${extra.number}` : ''}`
    if (vestot.some((v) => v.key === key)) return
    vestot.push({
      key,
      kind,
      onot,
      start: first.start,
      end: last.end,
      ruleId,
      reason,
      fromFlow: f.id,
      bedikahFrom: bedikahOpens(kind, onot, f.at, first.start, last.end),
      bedikahDone: false,
      ...extra,
    })
  }

  /** V10: after the clock time the flow began; the beinonit's about 10 minutes before shkiah. */
  function bedikahOpens(kind: VesetKind, onot: Onah[], flowAt: number, start: number, end: number): number {
    const tz = z.placeAt(flowAt).tz
    const hhmm = new Intl.DateTimeFormat('en-GB', { timeZone: tz, hour: '2-digit', minute: '2-digit', hour12: false }).format(new Date(flowAt))
    const [hh, mm] = hhmm.split(':').map(Number)
    const candidates: number[] = []
    const lastDay = civilOf(onot[onot.length - 1].abs)
    for (const day of [civilOf(onot[0].abs - 1), civilOf(onot[0].abs), lastDay]) {
      candidates.push(zonedTime(day, hh, mm, tz))
    }
    const clockInside = candidates.filter((t) => t >= start && t <= end).sort((a, b) => a - b)
    if (kind === 'beinonit' || kind === 'beinonit31') {
      const shk = (s.sunset === 'amitis' ? z.times(lastDay).shkiahAmitis : z.times(lastDay).shkiah) ?? end
      const tenBefore = shk - 10 * MIN
      const clockOnLast = zonedTime(lastDay, hh, mm, tz)
      return Math.min(Math.max(tenBefore, clockOnLast), end - MIN)
    }
    return clockInside[0] ?? start
  }

  let list: number[] = []
  let hPrev: number | null = null
  let fPrev: CalFlow | null = null
  calFlows.forEach((f, i) => {
    const prevAfterBirth = f.afterBirth === 1
    if (prevAfterBirth) {
      list = []
      hPrev = null
      fPrev = null
    }
    const thisSeed = seed && f.at <= seed.at && (calFlows[i + 1]?.at ?? Infinity) > seed.at ? seed : null

    // Veset hachodesh: every flow, kept until its date passes (V1–V4).
    for (const o of f.onot) {
      let target = sameDayNextMonth(o.abs)
      if (target === null) {
        warnings.push({ at: f.at, ruleId: 'V3', text: `No veset hachodesh from the flow on ${hebrewLabel(o.abs)}: next month has 29 days.` })
        continue
      }
      let carried = false
      for (let g = 0; g < 12 && target !== null; g++) {
        const on: Onah = { abs: target, half: o.half }
        if (!inBleeding(on, onahIndex(f.cycle.onah))) break
        if (s.chodeshInPeriod === 'carry') {
          target = sameDayNextMonth(target)
          carried = true
          continue
        }
        if (s.chodeshInPeriod === 'drop') {
          target = null
          break
        }
        raise({
          key: `V2:${f.id}`,
          ruleId: 'V2',
          title: 'Choose: a veset hachodesh inside a period',
          facts: [`The veset hachodesh from ${hebrewLabel(o.abs)} falls while you were already bleeding.`],
          at: f.at,
          holds: 'It is kept, the stricter way, until you choose in settings.',
          options: RESOLVED,
        })
        break
      }
      if (target === null) continue
      const on: Onah = { abs: target, half: o.half }
      push('hachodesh', [on], f, 'V1', `The same date as the flow on ${hebrewLabel(o.abs)}, ${o.half}${carried ? ', carried on from a month it fell inside a period' : ''}.`, { carried })
    }

    // Start-to-start haflagah (V7), when on.
    if (fPrev && s.haflagahMethod !== 'chabad') {
      const k = f.primary.abs - fPrev.primary.abs + 1
      push('haflagah_s2s', [{ abs: f.primary.abs + k - 1, half: f.primary.half }], f, 'V7', `${k} days from the flow on ${hebrewLabel(fPrev.primary.abs)} to this one, counted again from this flow.`, { number: k })
    }

    // Chabad haflagah (V5, V6), drawn only from a confirmed hefsek.
    if (hPrev !== null) {
      const flowIdx = onahIndex(f.primary)
      list = list.filter((n) => onahIndex(haflagahOnah(hPrev!, n)) >= flowIdx)
      const N = 2 * (f.primary.abs - hPrev) - (f.primary.half === 'night' ? 1 : 0)
      f.n = N
      if (N >= 1) list = [...new Set([...list.filter((n) => n >= N), N])].sort((a, b) => a - b)
    }
    if (thisSeed) list = [...new Set([...list, ...thisSeed.numbers])].sort((a, b) => a - b)
    if (f.hefsek !== null) {
      hPrev = f.hefsek
      if (s.haflagahMethod !== 'start_to_start' && f.afterBirth !== 1) {
        for (const n of list) {
          push('haflagah', [haflagahOnah(f.hefsek, n)], f, 'V5', `Haflagah ${n}: ${n} onot counted from the night after the hefsek on ${hebrewLabel(f.hefsek)}.`, { number: n })
        }
      }
    }
    fPrev = f
  })

  // Onah beinonit: only from the latest flow — each new flow replaces it (V8).
  const latest = calFlows[calFlows.length - 1]
  if (latest) {
    for (const o of latest.onot) {
      for (const [offset, kind] of [[29, 'beinonit'], ...(s.beinonitDay31 ? [[30, 'beinonit31']] : [])] as [number, VesetKind][]) {
        const abs = o.abs + offset
        const onot: Onah[] = s.beinonitScope === 'one_onah' ? [{ abs, half: o.half }] : [{ abs, half: 'night' }, { abs, half: 'day' }]
        push(kind, onot, latest, 'V8', `Day ${offset + 1} from the flow on ${hebrewLabel(o.abs)}, counting that day as day 1.`)
      }
    }
  }

  // Kavua set by her rav (K1).
  for (const { at, k } of kavuaRulings) {
    if (!k || !latest) continue
    const from = place(at, z, s).onah
    if (k.type === 'chodesh' && k.day) {
      let abs = from.abs
      for (let g = 0; g < 14; g++) {
        const next = monthDay(abs, k.day)
        if (next !== null && next >= from.abs) push('kavua', [{ abs: next, half: k.half }], latest, 'K1', `The kavua your rav set: day ${k.day} of each month, ${k.half}.`)
        abs = (sameDayNextMonth(abs - dayOfMonth(abs) + 1) ?? abs + 30) as number
      }
    } else if (k.interval) {
      push('kavua', [{ abs: latest.primary.abs + k.interval - 1, half: k.half }], latest, 'K1', `The kavua your rav set: every ${k.interval} days.`)
    }
  }

  // Or Zarua: the onah before each veset from the latest period (V9). Never blocks mikvah night.
  if (s.orZarua && latest) {
    for (const v of vestot.filter((x) => x.fromFlow === latest.id && x.kind !== 'or_zarua')) {
      const before = fromIndex(onahIndex(v.onot[0]) - 1)
      push('or_zarua', [before], latest, 'V9', `The onah before the ${vesetName(v.kind)}.`)
    }
  }

  // Ticks: a clean bedikah inside the window (V10, V11).
  for (const v of vestot) {
    v.bedikahDone = tehorahBedikot.some((b) => b.result === 'clean' && b.at >= v.bedikahFrom && b.at <= v.end + 12 * 3_600_000)
  }

  function vestotCovering(o: Onah): Veset[] {
    const i = onahIndex(o)
    return vestot.filter((v) => v.kind !== 'or_zarua' && v.onot.some((x) => onahIndex(x) === i))
  }

  // Mikvah night needs the vestot (M5), so it comes after them.
  for (const w of cycles) if (w.hefsek && w.immersion === null) w.mikvah = mikvahNight(w)

  // Pattern notices (K1), never within 24 months of a birth (L2).
  const quietUntil = birthIndex ? place(birthAt! + 0, z, s).onah.abs + 730 : null
  for (const notice of detectKavua(calFlows.map((f) => ({ id: f.id, at: f.at, onah: f.primary, n: f.n })), symptoms)) {
    if (quietUntil !== null && calFlows.find((f) => f.id === notice.lastFlowId)!.primary.abs <= quietUntil) continue
    raise({
      key: `K1:${notice.type}:${notice.lastFlowId}`,
      ruleId: 'K1',
      title: `A possible veset kavua: ${notice.label}`,
      facts: notice.facts,
      at: calFlows.find((f) => f.id === notice.lastFlowId)!.at,
      holds: 'Nothing changes: the calendar keeps calculating as before until you enter your rav’s ruling.',
      options: [
        { value: 'not_kavua', label: 'My rav said it is not a kavua' },
        { value: 'kavua', label: 'My rav set a kavua (enter it in the kavua editor)' },
      ],
    })
  }

  // Kavua that may have been uprooted (K2): three of its dates passed with no flow.
  for (const { at, k } of kavuaRulings) {
    if (!k || k.type !== 'chodesh' || !k.day) continue
    const passed = vestot.filter((v) => v.kind === 'kavua' && v.end < now && v.start > at)
    const flowAfter = calFlows.filter((f) => f.at > at).length
    if (passed.length >= 3 && flowAfter === 0) {
      raise({
        key: `K2:${at}`,
        ruleId: 'K2',
        title: 'Possibly uprooted: confirm',
        facts: [`Three dates of the kavua (day ${k.day}) passed with no flow.`],
        at: passed[2].end,
        holds: 'The kavua stays until you enter your rav’s answer.',
        options: RESOLVED,
      })
    }
  }

  // Separation days for everyone: Yom Kippur and Tisha B'Av ahead, and shiva.
  const separation: Result['separation'] = []
  const today = place(now, z, s).onah.abs
  for (let abs = today; abs < today + 380; abs++) {
    if (isMonth(abs, 'Tishrei', 10)) separation.push({ abs, label: 'Yom Kippur', ruleId: 'SEP' })
    if (isMonth(abs, 'Av', 9) && weekday(abs) !== 6) separation.push({ abs, label: "Tisha B'Av", ruleId: 'SEP' })
    if (isMonth(abs, 'Av', 10) && weekday(abs - 1) === 6) separation.push({ abs, label: "Tisha B'Av (postponed)", ruleId: 'SEP' })
  }
  for (const sh of partner.shiva) {
    for (let abs = absOfCivil(sh.from); abs <= absOfCivil(sh.to); abs++) separation.push({ abs, label: 'Shiva', ruleId: 'SEP' })
  }

  // Questions still open after a day get a nudge; the reminder module schedules it.
  const out: Result = {
    cycles: cycles.map(stripWorking),
    vestot: vestot.sort((a, b) => a.start - b.start),
    flags: [...flags.values()].sort((a, b) => a.at - b.at),
    haflagahList: list,
    reminders: [],
    separation,
    warnings,
  }
  return out
}

function stripWorking(w: Working): Cycle {
  const { segments: _s, flowIds: _f, bedikahEvents: _b, ...rest } = w
  void _s
  void _f
  void _b
  return rest
}

/** Haflagah onah n, counted from the night after hefsek H: odd = night (V5). */
export function haflagahOnah(H: number, n: number): Onah {
  return { abs: H + Math.ceil(n / 2), half: (n % 2 === 1 ? 'night' : 'day') as Half }
}

function addMonths(abs: number, months: number): number {
  let a = abs
  for (let i = 0; i < months; i++) a = sameDayNextMonth(a) ?? a + 29
  return a
}

/** Day `d` of the month that `abs` falls in, or null when the month is shorter. */
function monthDay(abs: number, d: number): number | null {
  const first = abs - dayOfMonth(abs) + 1
  const candidate = first + d - 1
  return dayOfMonth(candidate) === d ? candidate : null
}

export function vesetName(kind: VesetKind): string {
  switch (kind) {
    case 'hachodesh':
      return 'veset hachodesh'
    case 'haflagah':
      return 'veset haflagah'
    case 'haflagah_s2s':
      return 'veset haflagah (start to start)'
    case 'beinonit':
      return 'onah beinonit'
    case 'beinonit31':
      return 'onah beinonit (day 31)'
    case 'or_zarua':
      return 'Or Zarua onah'
    case 'kavua':
      return 'veset kavua'
  }
}

/** A wall-clock time on a civil day in a zone, as an instant. */
export function zonedTime(day: string, hh: number, mm: number, tz: string): number {
  const [y, mo, d] = day.split('-').map(Number)
  const guess = Date.UTC(y, mo - 1, d, hh, mm)
  // Find the zone's offset at that moment and correct once (twice near a change).
  let t = guess
  for (let i = 0; i < 2; i++) {
    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone: tz,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    }).formatToParts(new Date(t))
    const get = (k: string) => Number(parts.find((p) => p.type === k)?.value)
    const shown = Date.UTC(get('year'), get('month') - 1, get('day'), get('hour') % 24, get('minute'))
    t += guess - shown
  }
  return t
}

export { DAY as ONE_DAY }
