import { describe, expect, it } from 'vitest'
import { calculate, hebcalZmanim, zonedTime, CHABAD, type MkEvent, type Place } from './engine'
import { cycleRows, stats } from './history'

const CITY: Place = { name: 'Example city', lat: 40.7128, lng: -74.006, tz: 'America/New_York' }
const z = hebcalZmanim(CITY)
const at = (day: string, hh: number, mm: number) => zonedTime(day, hh, mm, CITY.tz)
const ev = (id: string, kind: MkEvent['kind'], t: number, extra: Partial<MkEvent> = {}): MkEvent => ({ id, kind, at: t, ...extra })

describe('history', () => {
  it("Example 1's cycle: 32 days long, hefsek on flow day 6, then haflagah 54", () => {
    // Previous flow Wed Oct 21 (day onah), hefsek Mon Oct 26; new flow Sun Nov 22, 10:00.
    const events = [
      ev('f0', 'flow', at('2026-10-21', 12, 0)),
      ev('h0', 'hefsek', z.times('2026-10-26').shkiah! - 25 * 60_000, { result: 'clean' }),
      ev('m0', 'moch', at('2026-10-26', 19, 30), { result: 'clean' }),
      ev('i0', 'immersion', at('2026-11-02', 19, 30)),
      ev('f1', 'flow', at('2026-11-22', 10, 0)),
    ]
    const r = calculate({ events, settings: { ...CHABAD, chodeshInPeriod: 'drop' }, zmanim: z, now: at('2026-11-23', 12, 0) })
    const rows = cycleRows(r)
    expect(rows).toHaveLength(2)
    expect(rows[0]).toMatchObject({ length: 32, toHefsek: 6, haflagah: null })
    expect(rows[1]).toMatchObject({ length: null, haflagah: 54 })
  })
  it('average, shortest, longest', () => {
    expect(stats([30, null, 28, 33])).toEqual({ count: 3, average: 30.3, shortest: 28, longest: 33 })
    expect(stats([null])).toEqual({ count: 0, average: null, shortest: null, longest: null })
  })
})
