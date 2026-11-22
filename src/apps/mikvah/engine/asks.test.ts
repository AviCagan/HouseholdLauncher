import { describe, expect, it } from 'vitest'
import { absOfCivil, civilOf, hebcalZmanim, hebrewLabel, type Place } from './calendar'
import { calculate, zonedTime } from './engine'
import { CHABAD, type Settings } from './settings'
import type { MkEvent, Result } from './types'

/**
 * Every ask-a-rav case raises a flag and waits; none is silently decided.
 * And a ruling or a changed setting redraws the calendar from the same
 * stored events. Synthetic dates in the example city only.
 */

const CITY: Place = { name: 'Example city', lat: 40.7128, lng: -74.006, tz: 'America/New_York' }
const z = hebcalZmanim(CITY)
const at = (day: string, hh: number, mm: number) => zonedTime(day, hh, mm, CITY.tz)
const before = (day: string, minutes: number) => z.times(day).shkiah! - minutes * 60_000

let seq = 0
const ev = (kind: MkEvent['kind'], t: number, extra: Partial<MkEvent> = {}): MkEvent => ({ id: `a${++seq}`, kind, at: t, ...extra })
const ruling = (flag: string, outcome: string, t: number, date?: string) => ev('ruling', t, { data: { flag, outcome, date } })
const run = (events: MkEvent[], now: number, patch: Partial<Settings> = {}): Result =>
  calculate({ events, settings: { ...CHABAD, chodeshInPeriod: 'drop', ...patch }, zmanim: z, now })

/** A period from a day flow, with a clean hefsek on day 5 and the moch. */
function period(flowDay: string) {
  const h = civilOf(absOfCivil(flowDay) + 4)
  const flow = ev('flow', at(flowDay, 10, 0))
  const hefsek = ev('hefsek', before(h, 25), { result: 'clean' })
  const moch = ev('moch', at(h, 19, 30), { result: 'clean' })
  return { flow, hefsek, moch, h, events: [flow, hefsek, moch] }
}

/** Every bedikah of the seven days, clean. */
function bedikot(h: string): MkEvent[] {
  const out: MkEvent[] = []
  for (let n = 1; n <= 7; n++) {
    const d = civilOf(absOfCivil(h) + n)
    out.push(ev('bedikah', z.times(d).netz! + 60 * 60_000, { result: 'clean', data: { slot: 'morning' } }))
    out.push(ev('bedikah', before(d, 30), { result: 'clean', data: { slot: 'afternoon' } }))
  }
  return out
}

describe('the hefsek', () => {
  it('after shkiah: a flag, and it does not count until the rav says it does', () => {
    const p = period('2026-11-22')
    const late = ev('hefsek', z.times(p.h).shkiah! + 60_000, { result: 'clean' })
    const events = [p.flow, late]
    const r = run(events, at('2026-11-27', 12, 0))
    expect(r.flags.find((f) => f.ruleId === 'H1')?.ruling).toBeNull()
    expect(r.cycles[0].hefsek).toBeNull()
    const ruled = run([...events, ruling(`H1:${late.id}`, 'valid', at('2026-11-27', 9, 0))], at('2026-11-27', 12, 0))
    expect(ruled.cycles[0].hefsek?.abs).toBe(absOfCivil(p.h))
  })

  it('before mincha ketanah: a flag', () => {
    const p = period('2026-11-22')
    const early = ev('hefsek', z.times(p.h).minchaKetanah! - 10 * 60_000, { result: 'clean' })
    const r = run([p.flow, early], at('2026-11-27', 12, 0))
    expect(r.flags.some((f) => f.ruleId === 'H2')).toBe(true)
    expect(r.cycles[0].hefsek).toBeNull()
  })

  it('the last attempt of the day counts', () => {
    const p = period('2026-11-22')
    const first = ev('hefsek', before(p.h, 80), { result: 'not_clean' })
    const second = ev('hefsek', before(p.h, 25), { result: 'clean' })
    expect(run([p.flow, first, second], at('2026-11-27', 12, 0)).cycles[0].hefsek?.eventId).toBe(second.id)
    const third = ev('hefsek', before(p.h, 10), { result: 'not_clean' })
    expect(run([p.flow, first, second, third], at('2026-11-27', 12, 0)).cycles[0].hefsek).toBeNull()
  })

  it('a forgotten moch dachuk holds the count', () => {
    const p = period('2026-11-22')
    const forgot = ev('moch', at(p.h, 19, 30), { data: { forgotten: true } })
    const r = run([p.flow, p.hefsek, forgot], at('2026-11-28', 12, 0))
    expect(r.flags.some((f) => f.ruleId === 'H3' && f.ruling === null)).toBe(true)
    expect(r.cycles[0].mikvah?.withheld).toBeTruthy()
  })
})

describe('the seven clean days', () => {
  it('a bedikah that is not clean freezes the count; the ruling decides what happens', () => {
    const p = period('2026-11-22')
    const bad = ev('bedikah', z.times('2026-11-29').netz! + 60 * 60_000, { result: 'not_clean' })
    const events = [...p.events, bad]
    const frozen = run(events, at('2026-11-29', 12, 0))
    expect(frozen.cycles[0].mikvah?.withheld).toBe(`N3:${bad.id}`)
    expect(frozen.flags.find((f) => f.key === `N3:${bad.id}`)?.ruling).toBeNull()

    // "Fine": the count stands again.
    const fine = run([...events, ...bedikot(p.h), ruling(`N3:${bad.id}`, 'fine', at('2026-11-29', 13, 0))], at('2026-11-29', 14, 0))
    expect(fine.cycles[0].mikvah?.withheld).toBeNull()

    // Restart, as a stain: a new hefsek with no new five days, and no new veset.
    const restart = run([...events, ruling(`N3:${bad.id}`, 'restart_stain', at('2026-11-29', 13, 0))], at('2026-11-29', 14, 0))
    expect(restart.cycles[0].hefsek).toBeNull()
    expect(restart.cycles[0].earliestHefsek).toBe(absOfCivil('2026-11-29'))
    expect(restart.vestot.filter((v) => v.kind === 'beinonit')).toHaveLength(1)
  })

  it('no bedikah on day 1: no mikvah night once the day is over, and a flag', () => {
    const p = period('2026-11-22')
    const onlyLater = bedikot(p.h).slice(2)
    const r = run([...p.events, ...onlyLater], at('2026-11-28', 18, 0))
    expect(r.cycles[0].mikvah?.withheld).toBe('N2')
    expect(r.flags.some((f) => f.ruleId === 'N2')).toBe(true)
  })
})

describe('mikvah night', () => {
  it('on an onat perishah: postponed (the Chabad default) and flagged for the rav', () => {
    // A night flow on 20 Kislev makes a hachodesh on the night of 20 Tevet;
    // the next period is timed so mikvah night lands on it.
    const target = absOfCivil('2027-01-08') // 29 Tevet: keep it simple, pick by abs below
    void target
    const first = ev('flow', at(civilOf(absOfCivil('2026-11-30') - 1), 20, 0)) // night of 20 Kislev
    const firstH = civilOf(absOfCivil('2026-11-30') + 4)
    const chodeshNight = absOfCivil('2026-12-30') // 20 Tevet
    expect(hebrewLabel(chodeshNight)).toBe('20 Tevet 5787')
    const flowDay = civilOf(chodeshNight - 12)
    const h = civilOf(chodeshNight - 8)
    const events = [
      first,
      ev('hefsek', before(firstH, 25), { result: 'clean' }),
      ev('moch', at(firstH, 19, 30), { result: 'clean' }),
      ev('immersion', at(civilOf(absOfCivil(firstH) + 7), 19, 0)),
      ev('flow', at(flowDay, 10, 0)),
      ev('hefsek', before(h, 25), { result: 'clean' }),
      ev('moch', at(h, 19, 30), { result: 'clean' }),
    ]
    const r = run(events, at(h, 20, 0))
    const c = r.cycles[1]
    expect(c.mikvah!.moved.map((x) => x.ruleId)).toEqual(['M5'])
    expect(c.mikvah!.abs).toBe(chodeshNight + 1)
    expect(r.flags.some((f) => f.ruleId === 'M5')).toBe(true)

    // Her setting: immerse without relations — it stays, still flagged.
    const stay = run(events, at(h, 20, 0), { mikvahOnOnah: 'immerse_no_relations' })
    expect(stay.cycles[1].mikvah!.abs).toBe(chodeshNight)
    expect(stay.flags.some((f) => f.ruleId === 'M5')).toBe(true)
  })

  it('while he is away: held for the rav', () => {
    const p = period('2026-11-22')
    const evening = civilOf(absOfCivil(p.h) + 7)
    const r = calculate({
      events: [...p.events, ...bedikot(p.h)],
      settings: { ...CHABAD, chodeshInPeriod: 'drop' },
      zmanim: z,
      now: at('2026-11-28', 12, 0),
      partner: { away: [{ from: evening, to: evening }], shiva: [] },
    })
    expect(r.cycles[0].mikvah!.waitingOn.some((k) => k.startsWith('M6'))).toBe(true)
  })

  it('a trip across the date line: held for the rav, and a trip that does not cross is not', () => {
    const p = period('2026-11-22')
    const far: Place = { name: 'Far east', lat: 35.68, lng: 139.69, tz: 'Asia/Tokyo' }
    const near: Place = { name: 'Not so far', lat: 51.5, lng: -0.12, tz: 'Europe/London' }
    const trip = (place: Place) => [{ id: 't1', from: '2026-11-28', to: '2026-11-30', place }]
    const go = (place: Place) =>
      calculate({
        events: [...p.events, ...bedikot(p.h)],
        settings: { ...CHABAD, chodeshInPeriod: 'drop' },
        zmanim: hebcalZmanim(CITY, trip(place)),
        now: at('2026-11-27', 12, 0),
        trips: trip(place),
      })
    const crossed = go(far)
    expect(crossed.flags.find((f) => f.key === 'T1:t1')?.ruling).toBeNull()
    expect(crossed.cycles[0].mikvah!.waitingOn).toContain('T1:t1')
    expect(go(near).flags.some((f) => f.ruleId === 'T1')).toBe(false)
  })
})

describe('the vestot', () => {
  it('a stain makes no veset; it raises a question', () => {
    const p = period('2026-11-22')
    const imm = ev('immersion', at(civilOf(absOfCivil(p.h) + 7), 19, 0))
    const stain = ev('stain', at('2026-12-10', 11, 0))
    const r = run([...p.events, imm, stain], at('2026-12-10', 12, 0))
    expect(r.flags.some((f) => f.ruleId === 'V12')).toBe(true)
    expect(r.vestot.every((v) => v.fromFlow === p.flow.id)).toBe(true)
  })

  it('a veset hachodesh inside a period with no V2 choice yet: kept, and she is asked to choose', () => {
    // Flow on 1 Kislev; the next flow on 28 Cheshvan... arrange a period covering 1 Tevet.
    const a = ev('flow', at('2026-11-11', 10, 0)) // 1 Kislev
    expect(hebrewLabel(absOfCivil('2026-11-11'))).toBe('1 Kislev 5787')
    const ah = civilOf(absOfCivil('2026-11-11') + 4)
    const b = ev('flow', at('2026-12-09', 10, 0)) // 29 Kislev, bleeding across 1 Tevet
    const events = [a, ev('hefsek', before(ah, 25), { result: 'clean' }), ev('immersion', at(civilOf(absOfCivil(ah) + 7), 19, 0)), b]
    const none = calculate({ events, settings: { ...CHABAD }, zmanim: z, now: at('2026-12-11', 12, 0) })
    expect(none.flags.some((f) => f.ruleId === 'V2')).toBe(true)
    expect(none.vestot.some((v) => v.kind === 'hachodesh' && v.fromFlow === a.id)).toBe(true)
    const drop = run(events, at('2026-12-11', 12, 0))
    expect(drop.vestot.some((v) => v.kind === 'hachodesh' && v.fromFlow === a.id)).toBe(false)
    const carry = run(events, at('2026-12-11', 12, 0), { chodeshInPeriod: 'carry' })
    const carried = carry.vestot.find((v) => v.kind === 'hachodesh' && v.fromFlow === a.id)!
    expect(carried.carried).toBe(true)
    expect(hebrewLabel(carried.onot[0].abs)).toBe('1 Shevat 5787')
  })

  it('changing a setting redraws from the same events: day 31 and one-onah beinonit', () => {
    const p = period('2026-11-22')
    const both = run(p.events, at('2026-11-23', 12, 0))
    expect(both.vestot.find((v) => v.kind === 'beinonit')!.onot).toHaveLength(2)
    const one = run(p.events, at('2026-11-23', 12, 0), { beinonitScope: 'one_onah', beinonitDay31: true })
    expect(one.vestot.find((v) => v.kind === 'beinonit')!.onot).toHaveLength(1)
    expect(one.vestot.some((v) => v.kind === 'beinonit31')).toBe(true)
  })

  it('Or Zarua, when on, adds the onah before each veset of the latest period', () => {
    const p = period('2026-11-22')
    const r = run(p.events, at('2026-11-23', 12, 0), { orZarua: true })
    expect(r.vestot.filter((v) => v.kind === 'or_zarua').length).toBeGreaterThan(0)
  })

  it('pregnancy: onot past three months from the immersion are not kept', () => {
    const p = period('2026-11-22')
    const imm = ev('immersion', at(civilOf(absOfCivil(p.h) + 7), 19, 0))
    const preg = ev('pregnancy', at('2026-12-20', 9, 0))
    const r = run([...p.events, imm, preg], at('2026-12-21', 12, 0))
    const limit = absOfCivil(civilOf(absOfCivil(p.h) + 7)) + 90
    expect(r.vestot.every((v) => v.onot[0].abs <= limit)).toBe(true)
  })

  it('a birth: no hefsek day until the rav gives one, and no veset from the birth', () => {
    const birth = ev('birth', at('2027-03-01', 6, 0))
    const r = run([birth], at('2027-03-02', 12, 0))
    expect(r.cycles[0].earliestHefsek).toBeNull()
    expect(r.flags.find((f) => f.ruleId === 'L3')?.wantsDate).toBe(true)
    expect(r.vestot).toEqual([])
    const dated = run([birth, ruling(`L3:${birth.id}`, 'date', at('2027-03-02', 9, 0), '2027-03-20')], at('2027-03-02', 12, 0))
    expect(civilOf(dated.cycles[0].earliestHefsek!)).toBe('2027-03-20')
  })

  it('a voided entry is ignored, and can be restored', () => {
    const p = period('2026-11-22')
    const voided = { ...p.flow, voided: true }
    expect(run([voided, p.hefsek, p.moch], at('2026-11-27', 12, 0)).cycles).toEqual([])
    expect(run(p.events, at('2026-11-27', 12, 0)).cycles).toHaveLength(1)
  })
})
