import { describe, expect, it } from 'vitest'
import { absOfCivil, civilOf, hebcalZmanim, type Place } from './calendar'
import { calculate, zonedTime } from './engine'
import { reminders } from './reminders'
import { CHABAD } from './settings'
import { hisView, segmentAt } from './shared'
import { nextThing, statusAt } from './status'
import type { MkEvent } from './types'

const CITY: Place = { name: 'Example city', lat: 40.7128, lng: -74.006, tz: 'America/New_York' }
const z = hebcalZmanim(CITY)
const at = (day: string, hh: number, mm: number) => zonedTime(day, hh, mm, CITY.tz)
const s = { ...CHABAD, chodeshInPeriod: 'drop' as const }
const MIN = 60_000

let seq = 0
const ev = (kind: MkEvent['kind'], t: number, extra: Partial<MkEvent> = {}): MkEvent => ({ id: `s${++seq}`, kind, at: t, ...extra })

// Example 1's current cycle: flow Sun Nov 22 10:00, hefsek Thu Nov 26.
const flow = ev('flow', at('2026-11-22', 10, 0))
const hef = ev('hefsek', z.times('2026-11-26').shkiah! - 25 * MIN, { result: 'clean' })
const moch = ev('moch', at('2026-11-26', 19, 30), { result: 'clean' })

describe('status', () => {
  const r = calculate({ events: [flow, hef, moch], settings: s, zmanim: z, now: at('2026-11-27', 12, 0) })
  it('waiting, day n of 5, before the hefsek', () => {
    expect(statusAt(r, at('2026-11-24', 12, 0), z, s)).toMatchObject({ kind: 'waiting', day: 3, of: 5 })
  })
  it('counting, day n of 7, from the night after the hefsek', () => {
    expect(statusAt(r, at('2026-11-27', 12, 0), z, s)).toMatchObject({ kind: 'counting', day: 1, of: 7 })
    // After shkiah the Hebrew date is the next clean day.
    expect(statusAt(r, at('2026-11-27', 18, 0), z, s)).toMatchObject({ kind: 'counting', day: 2 })
  })
  it('mikvah night on day 7 and that night', () => {
    expect(statusAt(r, at('2026-12-03', 12, 0), z, s).kind).toBe('mikvah')
    expect(statusAt(r, at('2026-12-03', 20, 0), z, s).kind).toBe('mikvah')
  })
  it('tehorah after the immersion, with the onat perishah laid over it', () => {
    const after = calculate({ events: [flow, hef, moch, ev('immersion', at('2026-12-03', 19, 0))], settings: s, zmanim: z, now: at('2026-12-04', 12, 0) })
    expect(statusAt(after, at('2026-12-10', 12, 0), z, s).kind).toBe('tehorah')
    const onBeinonit = statusAt(after, at('2026-12-21', 12, 0), z, s)
    expect(onBeinonit.kind).toBe('tehorah')
    expect(onBeinonit.vestot.map((v) => v.kind)).toContain('beinonit')
  })
  it('the next thing to do', () => {
    const waiting = calculate({ events: [flow], settings: s, zmanim: z, now: at('2026-11-23', 12, 0) })
    const next = nextThing(waiting, at('2026-11-23', 12, 0), z, s)!
    expect(next.ruleId).toBe('H1')
    expect(next.at).toBe(z.times('2026-11-26').shkiah! - 2 * MIN)
  })
})

describe('reminders, to the minute', () => {
  it('on hefsek day: at plag, 30 and 20 minutes before shkiah', () => {
    const r = calculate({ events: [flow], settings: s, zmanim: z, now: at('2026-11-23', 12, 0) })
    const list = reminders(r, z, s, at('2026-11-23', 12, 0))
    const shk = z.times('2026-11-26').shkiah! - 2 * MIN
    const day5 = list.filter((x) => x.key.includes(`:${absOfCivil('2026-11-26')}:`))
    expect(day5.map((x) => x.at)).toEqual([z.times('2026-11-26').plag!, shk - 30 * MIN, shk - 20 * MIN])
    expect(day5.every((x) => x.audience === 'her')).toBe(true)
  })
  it('the seven days, mikvah night, and onot perishah for both', () => {
    const r = calculate({ events: [flow, hef, moch], settings: s, zmanim: z, now: at('2026-11-26', 20, 0) })
    const list = reminders(r, z, s, at('2026-11-26', 20, 0), 40)
    expect(list.filter((x) => x.key.startsWith('bedikah:')).length).toBe(21)
    expect(list.some((x) => x.key.endsWith(':him') && x.audience === 'him')).toBe(true)
    const beinonit = r.vestot.find((v) => v.kind === 'beinonit')!
    const start = list.find((x) => x.key === `veset:${beinonit.key}:start`)!
    expect(start.at).toBe(beinonit.start)
    expect(start.audience).toBe('both')
  })
})

describe('his view', () => {
  it('carries status, onot, mikvah night — and nothing from her records', () => {
    const now = at('2026-11-27', 12, 0)
    const r = calculate({ events: [flow, hef, moch], settings: s, zmanim: z, now })
    const snap = hisView(r, z, s, now)
    expect(segmentAt(snap, now)).toMatchObject({ kind: 'counting', day: 1 })
    expect(snap.mikvah?.label).toBe('24 Kislev 5787')
    expect(snap.onot.find((o) => o.beinonit)?.done).toBe(false)
    const text = JSON.stringify(snap)
    for (const secret of ['clean', 'not_clean', 'question', 'hefsek', 'moch', 'stain', flow.id, hef.id]) {
      expect(text).not.toContain(secret)
    }
    expect(civilOf(absOfCivil('2026-12-03'))).toBe('2026-12-03')
  })
})
