import { civilOf, hebrewLabel, type Zmanim } from './calendar'
import { vesetName } from './engine'
import type { Settings } from './settings'
import type { Reminder, Result } from './types'

/**
 * The reminder schedule, to the minute, from the calculated calendar.
 * Times come from the zmanim of where she is. Each reminder has a stable key
 * so the stored queue can be updated in place as the calendar changes, and
 * a sent reminder is never sent twice.
 *
 * The text here is the detail shown inside the app; notifications say only
 * "Calendar reminder" unless she turns detail on.
 */

const MIN = 60_000

export interface ReminderPrefs {
  /** Kinds he chose to get (his view). */
  him: { vestot: boolean; mikvah: boolean }
}

export const DEFAULT_PREFS: ReminderPrefs = { him: { vestot: true, mikvah: true } }

export function reminders(result: Result, z: Zmanim, s: Settings, now: number, days = 21, prefs: ReminderPrefs = DEFAULT_PREFS): Reminder[] {
  const until = now + days * 86_400_000
  const out: Reminder[] = []
  const add = (r: Reminder) => {
    if (Number.isFinite(r.at) && r.at > now && r.at <= until) out.push(r)
  }
  const m = s.marginMinutes * MIN

  for (const c of result.cycles) {
    if (c.immersion !== null) continue

    // Hefsek day: at plag, 30 and 20 minutes before shkiah, daily from day 5
    // until a clean hefsek is logged, up to flow day 15 (My Mikvah Calendar).
    if (!c.hefsek && c.earliestHefsek !== null) {
      for (let abs = c.earliestHefsek; abs <= c.day1 + 14; abs++) {
        const t = z.times(civilOf(abs))
        if (t.shkiah === null) continue
        const shk = t.shkiah - m
        add({ key: `hefsek:${c.id}:${abs}:plag`, at: t.plag ?? NaN, audience: 'her', detail: `Hefsek taharah today, after plag, before shkiah (${hebrewLabel(abs, false)}).`, ruleId: 'H2' })
        add({ key: `hefsek:${c.id}:${abs}:30`, at: shk - 30 * MIN, audience: 'her', detail: 'Hefsek taharah: 30 minutes to shkiah.', ruleId: 'H1' })
        add({ key: `hefsek:${c.id}:${abs}:20`, at: shk - 20 * MIN, audience: 'her', detail: 'Hefsek taharah: 20 minutes to shkiah.', ruleId: 'H1' })
      }
    }

    if (c.hefsek) {
      // Moch dachuk: at tzeit, to remove and check.
      const ht = z.times(civilOf(c.hefsek.abs))
      if (!c.mochConfirmed) add({ key: `moch:${c.id}`, at: (ht.tzeit ?? NaN) + m, audience: 'her', detail: 'Moch dachuk: remove and check now, and again by daylight.', ruleId: 'H3' })

      // The seven days: a morning bedikah, an afternoon one, and a last call.
      for (const slot of c.slots) {
        if (slot.result !== null) continue
        const t = z.times(civilOf(slot.abs))
        if (slot.part === 'morning') {
          add({ key: `bedikah:${c.id}:${slot.day}:am`, at: (t.netz ?? NaN) + s.morningMinutesAfterNetz * MIN, audience: 'her', detail: `Clean day ${slot.day}: morning bedikah.`, ruleId: 'N1' })
        } else {
          add({ key: `bedikah:${c.id}:${slot.day}:pm`, at: slot.closes - 30 * MIN, audience: 'her', detail: `Clean day ${slot.day}: afternoon bedikah, before shkiah.`, ruleId: 'N1' })
          add({ key: `bedikah:${c.id}:${slot.day}:last`, at: slot.closes - 10 * MIN, audience: 'her', detail: `Clean day ${slot.day}: last call for the bedikah — 10 minutes to shkiah.`, ruleId: 'N1' })
        }
      }

      // Day 7 and mikvah night.
      const mk = c.mikvah
      if (mk && !mk.withheld) {
        const day7 = civilOf(mk.abs - 1)
        const t7 = z.times(day7)
        const time = new Date(mk.at)
        const hhmm = new Intl.DateTimeFormat('en-GB', { timeZone: z.placeOn(day7).tz, hour: '2-digit', minute: '2-digit' }).format(time)
        const why = mk.moved.length ? ` ${mk.moved[mk.moved.length - 1].reason}` : ''
        add({ key: `mikvah:${c.id}:${mk.abs}:day`, at: (t7.netz ?? NaN) + s.morningMinutesAfterNetz * MIN + 5 * MIN, audience: 'her', detail: `Mikvah night tonight, after ${hhmm}.${why}`, ruleId: 'M1' })
        add({ key: `chafifah:${c.id}:${mk.abs}`, at: (t7.shkiah ?? NaN) - 75 * MIN, audience: 'her', detail: 'Start chafifah after your last bedikah.', ruleId: 'M8' })
        if (mk.candleLighting !== null) {
          add({ key: `candles:${c.id}:${mk.abs}`, at: mk.candleLighting - 60 * MIN, audience: 'her', detail: 'Finish all preparation before candle lighting.', ruleId: 'M4' })
        }
        if (prefs.him.mikvah) add({ key: `mikvah:${c.id}:${mk.abs}:him`, at: (t7.netz ?? NaN) + 60 * MIN, audience: 'him', detail: `Mikvah night tonight, after ${hhmm}.`, ruleId: 'M1' })
        if (mk.moved.length) {
          const first = mk.moved[0]
          const was = civilOf(first.from - 1)
          add({ key: `moved:${c.id}:${mk.abs}`, at: (z.times(was).netz ?? NaN) + 60 * MIN, audience: 'her', detail: `Mikvah night moved to ${hebrewLabel(mk.abs, false)}. ${first.reason}`, ruleId: first.ruleId })
        }
      }
    }
  }

  // Onat perishah: a heads-up the day before (both), at the start (both),
  // when the bedikah window opens (her), a last call before it ends (her).
  for (const v of result.vestot) {
    if (v.kind === 'or_zarua' && !s.orZarua) continue
    const name = vesetName(v.kind)
    const himToo = prefs.him.vestot
    add({ key: `veset:${v.key}:eve`, at: v.start - 24 * 3_600_000, audience: himToo ? 'both' : 'her', detail: `Tomorrow: ${name}.`, ruleId: v.ruleId })
    add({ key: `veset:${v.key}:start`, at: v.start, audience: himToo ? 'both' : 'her', detail: `Onat perishah now: ${name}.`, ruleId: v.ruleId })
    if (!v.bedikahDone) {
      add({ key: `veset:${v.key}:bedikah`, at: v.bedikahFrom, audience: 'her', detail: `Bedikah for the ${name}, before the onah ends.`, ruleId: 'V10' })
      add({ key: `veset:${v.key}:last`, at: v.end - 15 * MIN, audience: 'her', detail: `Last call: bedikah for the ${name}.`, ruleId: 'V10' })
    }
  }

  // An ask-a-rav question still open after a day.
  for (const f of result.flags) {
    if (f.ruling === null) add({ key: `flag:${f.key}`, at: f.at + 24 * 3_600_000, audience: 'her', detail: `Still open: ${f.title}.`, ruleId: f.ruleId })
  }

  return out.sort((a, b) => a.at - b.at)
}
