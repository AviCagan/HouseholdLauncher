import { describe, expect, it } from 'vitest'
import { absOfCivil, civilOf, clock, hebcalZmanim, hebrewLabel, type Place } from './calendar'
import { calculate, place, zonedTime } from './engine'
import { CHABAD, type Settings } from './settings'
import type { MkEvent, Result } from './types'

/**
 * The build prompt's test examples, run as written. New York City,
 * 40.7128, −74.0060, America/New_York, sea level; the Chabad defaults
 * unless a case says otherwise. These are synthetic: no one's real dates.
 *
 * If one of these fails, the expected value is not to be changed to match
 * the engine — the difference goes to the shared doc instead.
 */

const NYC: Place = { name: 'Example city', lat: 40.7128, lng: -74.006, tz: 'America/New_York', elevation: 0 }
const z = hebcalZmanim(NYC)
const TZ = NYC.tz
const at = (day: string, hh: number, mm: number) => zonedTime(day, hh, mm, TZ)

let seq = 0
const ev = (kind: MkEvent['kind'], t: number, extra: Partial<MkEvent> = {}): MkEvent => ({ id: `e${++seq}`, kind, at: t, ...extra })
const flow = (day: string, hh: number, mm: number) => ev('flow', at(day, hh, mm))
/** A clean hefsek 25 minutes before shkiah: after mincha ketanah and plag in every season. */
const hefsek = (day: string) => ev('hefsek', z.times(day).shkiah! - 25 * 60_000, { result: 'clean' })
const moch = (day: string) => ev('moch', at(day, 19, 0), { result: 'clean' })
const settings = (patch: Partial<Settings> = {}): Settings => ({ ...CHABAD, chodeshInPeriod: 'drop', ...patch })
const run = (events: MkEvent[], now: string, patch: Partial<Settings> = {}): Result =>
  calculate({ events, settings: settings(patch), zmanim: z, now: at(now, 12, 0) })

const heb = (abs: number) => hebrewLabel(abs)
const civil = (day: string) => absOfCivil(day)
const vestOf = (r: Result, kind: string) => r.vestot.filter((v) => v.kind === kind)

describe('zmanim, New York, to the minute', () => {
  // [date, netz, mincha ketanah, plag, shkiah, shkiah amitis, tzeit 6°, 8.5°]
  const table: [string, string, string, string, string, string, string, string][] = [
    ['2026-11-26', '06:55', '14:33', '15:34', '16:30', '16:35', '17:01', '17:15'],
    ['2026-12-03', '07:02', '14:33', '15:33', '16:28', '16:33', '16:59', '17:13'],
    ['2026-12-21', '07:16', '14:38', '15:37', '16:31', '16:36', '17:02', '17:17'],
    ['2027-01-06', '07:20', '14:48', '15:48', '16:43', '16:48', '17:14', '17:28'],
    ['2027-03-13', '06:11', '15:34', '16:49', '18:00', '18:04', '18:27', '18:40'],
    ['2027-03-14', '07:09', '16:35', '17:50', '19:01', '19:05', '19:28', '19:42'],
    ['2027-06-21', '05:24', '17:24', '19:00', '20:30', '20:35', '21:04', '21:21'],
    ['2027-10-10', '07:01', '16:03', '17:15', '18:23', '18:27', '18:51', '19:04'],
    ['2027-10-11', '07:02', '16:02', '17:14', '18:22', '18:26', '18:49', '19:02'],
  ]
  const toMin = (hhmm: string) => Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(3))
  for (const [day, ...expected] of table) {
    it(`matches the published times on ${day} within two minutes`, () => {
      const t = z.times(day)
      const got = [t.netz, t.minchaKetanah, t.plag, t.shkiah, t.shkiahAmitis, t.tzeit, t.tzeitShabbat].map((x) => clock(x!, TZ))
      got.forEach((g, i) => expect(Math.abs(toMin(g) - toMin(expected[i]))).toBeLessThanOrEqual(2))
    })
  }
})

describe('Example 8: a timestamp to an onah', () => {
  const cases: [string, number, number, string, 'night' | 'day', string?][] = [
    ['2026-11-22', 5, 30, '12 Kislev 5787', 'night'],
    ['2026-11-22', 10, 0, '12 Kislev 5787', 'day'],
    ['2026-11-22', 16, 20, '12 Kislev 5787', 'day', 'confirm'],
    ['2026-11-22', 16, 40, '13 Kislev 5787', 'night', 'bin'],
    ['2026-11-22', 17, 30, '13 Kislev 5787', 'night'],
    ['2027-03-13', 18, 30, '5 Adar II 5787', 'night'],
    ['2027-03-14', 18, 30, '5 Adar II 5787', 'day'],
    ['2027-03-14', 19, 30, '6 Adar II 5787', 'night'],
  ]
  for (const [day, hh, mm, hebrew, half, note] of cases) {
    it(`${day} ${hh}:${String(mm).padStart(2, '0')} is ${hebrew}, ${half}`, () => {
      const p = place(at(day, hh, mm), z, settings())
      expect(heb(p.onah.abs)).toBe(hebrew)
      expect(p.onah.half).toBe(half)
      if (note === 'confirm') expect(p.nearShkiah).toBe(true)
      if (note === 'bin') expect(p.bin).toBe(true)
      if (!note) expect(p.bin).toBe(false)
    })
  }

  // The 16:40 flow (7 minutes after shkiah), rule F2.
  const binFlow = () => [flow('2026-11-22', 16, 40)]
  it('by default: day 1 is 13 Kislev, earliest hefsek 17 Kislev, vestot from the night', () => {
    const r = run(binFlow(), '2026-11-23')
    const c = r.cycles[0]
    expect(heb(c.day1)).toBe('13 Kislev 5787')
    expect(civilOf(c.earliestHefsek!)).toBe('2026-11-27')
    const chodesh = vestOf(r, 'hachodesh')[0]
    expect(heb(chodesh.onot[0].abs)).toBe('13 Tevet 5787')
    expect(chodesh.onot[0].half).toBe('night')
    expect(clock(chodesh.start + 2 * 60_000, TZ)).toBe(clock(z.times('2026-12-22').shkiah!, TZ))
    const beinonit = vestOf(r, 'beinonit')[0]
    expect(heb(beinonit.onot[0].abs)).toBe('12 Tevet 5787')
    expect(civilOf(beinonit.onot[1].abs)).toBe('2026-12-22')
    expect(r.flags.some((f) => f.ruleId === 'F2')).toBe(true)
  })
  it('with "five days from the previous day within 9 minutes": day 1 is 12 Kislev, the vestot do not change', () => {
    const r = run(binFlow(), '2026-11-23', { binFiveDays: 'prev_day_9min' })
    expect(heb(r.cycles[0].day1)).toBe('12 Kislev 5787')
    expect(civilOf(r.cycles[0].earliestHefsek!)).toBe('2026-11-26')
    expect(heb(vestOf(r, 'hachodesh')[0].onot[0].abs)).toBe('13 Tevet 5787')
    expect(heb(vestOf(r, 'beinonit')[0].onot[0].abs)).toBe('12 Tevet 5787')
    expect(r.flags.some((f) => f.ruleId === 'F2')).toBe(true)
  })
})

// Examples 1 and 2 share a history.
const prevFlow = () => flow('2026-10-21', 10, 0) // 10 Cheshvan, day
const prevHefsek = () => hefsek('2026-10-26') // 15 Cheshvan, flow day 6
const prevImmersion = () => ev('immersion', at('2026-11-02', 19, 30))
const ex1 = () => [prevFlow(), prevHefsek(), moch('2026-10-26'), prevImmersion(), flow('2026-11-22', 10, 0), hefsek('2026-11-26'), moch('2026-11-26')]

describe('Example 1: an ordinary cycle; the two haflagah counts differ', () => {
  it('onah, hefsek, clean days and mikvah night', () => {
    const r = run(ex1(), '2026-11-27')
    const c = r.cycles[1]
    expect(heb(c.onah.abs)).toBe('12 Kislev 5787')
    expect(c.onah.half).toBe('day')
    expect(civilOf(c.earliestHefsek!)).toBe('2026-11-26')
    expect(heb(c.earliestHefsek!)).toBe('16 Kislev 5787')
    const days = [...new Set(c.slots.map((s) => s.abs))]
    expect(civilOf(days[0])).toBe('2026-11-27')
    expect(heb(days[0])).toBe('17 Kislev 5787')
    expect(civilOf(days[6])).toBe('2026-12-03')
    expect(heb(days[6])).toBe('23 Kislev 5787')
    expect(heb(c.mikvah!.abs)).toBe('24 Kislev 5787')
    expect(civilOf(c.mikvah!.abs - 1)).toBe('2026-12-03')
    expect(c.mikvah!.moved).toEqual([])
    expect(c.mikvah!.at).toBeGreaterThan(z.times('2026-12-03').tzeit!)
  })
  it('veset hachodesh 12 Tevet, day: Tue Dec 22', () => {
    const v = vestOf(run(ex1(), '2026-11-27'), 'hachodesh')
    expect(v.map((x) => [heb(x.onot[0].abs), x.onot[0].half, civilOf(x.onot[0].abs)])).toContainEqual(['12 Tevet 5787', 'day', '2026-12-22'])
  })
  it('onah beinonit 11 Tevet, shkiah Sun Dec 20 to shkiah Mon Dec 21', () => {
    const b = vestOf(run(ex1(), '2026-11-27'), 'beinonit')[0]
    expect(heb(b.onot[0].abs)).toBe('11 Tevet 5787')
    expect(clock(b.start + 2 * 60_000, TZ)).toBe(clock(z.times('2026-12-20').shkiah!, TZ))
    expect(civilOf(b.onot[1].abs)).toBe('2026-12-21')
  })
  it('haflagah, Chabad: N = 54, so 13 Tevet, day, Wed Dec 23', () => {
    const r = run(ex1(), '2026-11-27')
    const h = vestOf(r, 'haflagah')[0]
    expect(h.number).toBe(54)
    expect([heb(h.onot[0].abs), h.onot[0].half, civilOf(h.onot[0].abs)]).toEqual(['13 Tevet 5787', 'day', '2026-12-23'])
    expect(r.haflagahList).toEqual([54])
  })
  it('haflagah, start-to-start: k = 33, so 14 Tevet, day, Thu Dec 24', () => {
    const h = vestOf(run(ex1(), '2026-11-27', { haflagahMethod: 'both' }), 'haflagah_s2s').filter((x) => x.number === 33)[0]
    expect([heb(h.onot[0].abs), h.onot[0].half, civilOf(h.onot[0].abs)]).toEqual(['14 Tevet 5787', 'day', '2026-12-24'])
  })
})

describe('Example 2: a Friday-night flow; a larger number replaces a smaller one', () => {
  const ex2 = () => [
    ...ex1(),
    ev('immersion', at('2026-12-03', 18, 0)),
    flow('2027-01-01', 18, 30),
    hefsek('2027-01-06'),
    moch('2027-01-06'),
  ]
  it('onah, hefsek, clean days and mikvah night', () => {
    const r = run(ex2(), '2027-01-07')
    const c = r.cycles[2]
    expect([heb(c.onah.abs), c.onah.half]).toEqual(['23 Tevet 5787', 'night'])
    expect(civilOf(c.earliestHefsek!)).toBe('2027-01-06')
    expect(heb(c.earliestHefsek!)).toBe('27 Tevet 5787')
    const days = [...new Set(c.slots.map((s) => s.abs))]
    expect([civilOf(days[0]), heb(days[0])]).toEqual(['2027-01-07', '28 Tevet 5787'])
    expect([civilOf(days[6]), heb(days[6])]).toEqual(['2027-01-13', '5 Shevat 5787'])
    expect(heb(c.mikvah!.abs)).toBe('6 Shevat 5787')
    expect(civilOf(c.mikvah!.abs - 1)).toBe('2027-01-13')
  })
  it('veset hachodesh: 23 Shevat, night (shkiah Sat Jan 30 to netz Sun Jan 31)', () => {
    const v = vestOf(run(ex2(), '2027-01-07'), 'hachodesh').find((x) => heb(x.onot[0].abs) === '23 Shevat 5787')!
    expect(v.onot[0].half).toBe('night')
    expect(clock(v.start + 2 * 60_000, TZ)).toBe(clock(z.times('2027-01-30').shkiah!, TZ))
    expect(clock(v.end - 2 * 60_000, TZ)).toBe(clock(z.times('2027-01-31').netz!, TZ))
  })
  it('onah beinonit: 23 Shevat, shkiah Sat Jan 30 to shkiah Sun Jan 31', () => {
    const b = vestOf(run(ex2(), '2027-01-07'), 'beinonit')[0]
    expect(heb(b.onot[0].abs)).toBe('23 Shevat 5787')
    expect(clock(b.start + 2 * 60_000, TZ)).toBe(clock(z.times('2027-01-30').shkiah!, TZ))
    expect(clock(b.end - 2 * 60_000, TZ)).toBe(clock(z.times('2027-01-31').shkiah!, TZ))
  })
  it('haflagah, Chabad: N = 73; 54 is deleted; separation 5 Adar I, night', () => {
    const r = run(ex2(), '2027-01-07')
    expect(r.haflagahList).toEqual([73])
    const h = vestOf(r, 'haflagah').find((x) => x.number === 73)!
    expect([heb(h.onot[0].abs), h.onot[0].half]).toEqual(['5 Adar I 5787', 'night'])
    expect(clock(h.start + 2 * 60_000, TZ)).toBe(clock(z.times('2027-02-11').shkiah!, TZ))
  })
  it('haflagah, start-to-start: k = 42, the same onah', () => {
    const h = vestOf(run(ex2(), '2027-01-07', { haflagahMethod: 'both' }), 'haflagah_s2s').find((x) => x.number === 42)!
    expect([heb(h.onot[0].abs), h.onot[0].half]).toEqual(['5 Adar I 5787', 'night'])
  })
})

describe('Example 3: Yom Kippur moves mikvah night', () => {
  const events = () => [flow('2027-09-29', 11, 0), hefsek('2027-10-03'), moch('2027-10-03')]
  it('flow 27 Elul 5787, day; earliest hefsek 2 Tishrei', () => {
    const c = run(events(), '2027-10-04').cycles[0]
    expect([heb(c.onah.abs), c.onah.half]).toEqual(['27 Elul 5787', 'day'])
    expect([civilOf(c.earliestHefsek!), heb(c.earliestHefsek!)]).toEqual(['2027-10-03', '2 Tishrei 5788'])
  })
  it('clean days Oct 4 to Oct 10; the night of 10 Tishrei is blocked; mikvah Mon Oct 11 after Yom Kippur ends', () => {
    const c = run(events(), '2027-10-04').cycles[0]
    const days = [...new Set(c.slots.map((s) => s.abs))]
    expect([civilOf(days[0]), heb(days[0])]).toEqual(['2027-10-04', '3 Tishrei 5788'])
    expect([civilOf(days[6]), heb(days[6])]).toEqual(['2027-10-10', '9 Tishrei 5788'])
    expect(c.mikvah!.moved.map((m) => [heb(m.from), m.ruleId])).toEqual([['10 Tishrei 5788', 'M2']])
    expect(civilOf(c.mikvah!.abs - 1)).toBe('2027-10-11')
    // After Yom Kippur ends: Shabbat-and-Yom-Tov nightfall (8.5°), plus the margin.
    expect(c.mikvah!.at).toBe(z.times('2027-10-11').tzeitShabbat! + 2 * 60_000)
  })
})

describe("Example 4: Tisha B'Av", () => {
  const cycle = (hefsekDay: string) => {
    const h = absOfCivil(hefsekDay)
    const flowDay = civilOf(h - 4)
    return [flow(flowDay, 9, 0), hefsek(hefsekDay), moch(hefsekDay)]
  }
  it('hefsek Wed Aug 4, 2027 (1 Av 5787): the night of 9 Av moves to Thu Aug 12', () => {
    const c = run(cycle('2027-08-04'), '2027-08-05').cycles[0]
    expect(heb(c.hefsek!.abs)).toBe('1 Av 5787')
    expect(c.mikvah!.moved.map((m) => heb(m.from))).toEqual(['9 Av 5787'])
    expect(civilOf(c.mikvah!.abs - 1)).toBe('2027-08-12')
  })
  it('9 Av 5789 is Shabbat: hefsek Fri Jul 13, 2029 gives Fri Jul 20, not blocked', () => {
    const c = run(cycle('2029-07-13'), '2029-07-14').cycles[0]
    expect(heb(c.hefsek!.abs)).toBe('1 Av 5789')
    expect(c.mikvah!.moved).toEqual([])
    expect(civilOf(c.mikvah!.abs - 1)).toBe('2029-07-20')
    expect(c.mikvah!.waitingOn).toEqual([])
  })
  it('hefsek Sat Jul 14, 2029 gives Sat Jul 21, the night of the deferred fast: ask a rav', () => {
    const r = run(cycle('2029-07-14'), '2029-07-15')
    const c = r.cycles[0]
    expect(heb(c.hefsek!.abs)).toBe('2 Av 5789')
    expect(civilOf(c.mikvah!.abs - 1)).toBe('2029-07-21')
    expect(c.mikvah!.waitingOn.some((k) => k.startsWith('M3'))).toBe(true)
    expect(r.flags.some((f) => f.ruleId === 'M3')).toBe(true)
  })
})

describe('Example 5: the 30th', () => {
  it('flow on 30 Kislev 5787: no veset hachodesh in Tevet; beinonit 29 Tevet, Fri Jan 8', () => {
    const r = run([flow('2026-12-10', 10, 0)], '2026-12-11')
    expect(heb(r.cycles[0].onah.abs)).toBe('30 Kislev 5787')
    expect(vestOf(r, 'hachodesh')).toEqual([])
    const b = vestOf(r, 'beinonit')[0]
    expect([heb(b.onot[0].abs), civilOf(b.onot[0].abs)]).toEqual(['29 Tevet 5787', '2027-01-08'])
  })
})

describe('Example 6: month order for veset hachodesh', () => {
  const cases: [string, string | null][] = [
    ['2027-01-23', '2027-02-22'], // 15 Shevat → 15 Adar I
    [civilOf(civil('2027-02-22')), '2027-03-24'], // 15 Adar I → 15 Adar II
    ['2027-03-24', '2027-04-22'], // 15 Adar II → 15 Nisan
    ['2027-02-07', '2027-03-09'], // 30 Shevat → 30 Adar I
    ['2027-03-09', null], // 30 Adar I → none, Adar II has 29 days
    ['2027-10-01', '2027-10-30'], // 29 Elul → 29 Tishrei 5788
    ['2027-10-31', '2027-11-30'], // 30 Tishrei → 30 Cheshvan
    ['2028-02-12', '2028-03-13'], // 15 Shevat 5788 → 15 Adar
    [civilOf(civil('2028-03-13')), '2028-04-11'], // 15 Adar 5788 → 15 Nisan
  ]
  for (const [flowDay, expected] of cases) {
    it(`${heb(civil(flowDay))} → ${expected ? heb(civil(expected)) : 'none'}`, () => {
      const r = run([flow(flowDay, 10, 0)], flowDay)
      const v = vestOf(r, 'hachodesh')
      if (expected === null) expect(v).toEqual([])
      else expect(civilOf(v[0].onot[0].abs)).toBe(expected)
    })
  }
})

describe('Example 7: the haflagah list', () => {
  // Hefsek H0 = 1 Shevat 5787 (Sat Jan 9, 2027), list {52}: a seed from before the app.
  const base = () => [
    flow('2027-01-05', 10, 0),
    hefsek('2027-01-09'),
    moch('2027-01-09'),
    ev('seed', at('2027-01-10', 9, 0), { data: { haflagah: [52] } }),
    ev('immersion', at('2027-01-16', 19, 30)),
  ]
  it('from H0, onah 50 is the day of 26 Shevat and onah 52 the day of 27 Shevat', () => {
    const r = run(base(), '2027-01-20')
    const h = vestOf(r, 'haflagah').find((x) => x.number === 52)!
    expect([heb(h.onot[0].abs), h.onot[0].half, civilOf(h.onot[0].abs)]).toEqual(['27 Shevat 5787', 'day', '2027-02-04'])
  })
  it('a flow on the day of 26 Shevat: N = 50, list {50, 52}, re-dated from 30 Shevat', () => {
    const r = run([...base(), flow('2027-02-03', 10, 0), hefsek('2027-02-07'), moch('2027-02-07')], '2027-02-08')
    expect(r.haflagahList).toEqual([50, 52])
    const latest = vestOf(r, 'haflagah').filter((x) => r.cycles[1].hefsek && x.fromFlow === r.cycles[1].id)
    const at50 = latest.find((x) => x.number === 50)!
    const at52 = latest.find((x) => x.number === 52)!
    expect([heb(at50.onot[0].abs), at50.onot[0].half, civilOf(at50.onot[0].abs)]).toEqual(['25 Adar I 5787', 'day', '2027-03-04'])
    expect([heb(at52.onot[0].abs), at52.onot[0].half, civilOf(at52.onot[0].abs)]).toEqual(['26 Adar I 5787', 'day', '2027-03-05'])
  })
  it('both pass with no flow, and the next flow is the night of 29 Adar I: N = 57, list {57}', () => {
    const r = run(
      [
        ...base(),
        flow('2027-02-03', 10, 0),
        hefsek('2027-02-07'),
        moch('2027-02-07'),
        ev('immersion', at('2027-02-14', 19, 0)),
        flow('2027-03-07', 19, 0),
      ],
      '2027-03-08',
    )
    expect(r.haflagahList).toEqual([57])
  })
  it('variant: the first flow on the night of 27 Shevat: N = 51, list {51, 52}, re-dated from 1 Adar I', () => {
    const r = run([...base(), flow('2027-02-03', 19, 0), hefsek('2027-02-08'), moch('2027-02-08')], '2027-02-09')
    expect(r.haflagahList).toEqual([51, 52])
    const latest = vestOf(r, 'haflagah').filter((x) => x.fromFlow === r.cycles[1].id)
    const at51 = latest.find((x) => x.number === 51)!
    const at52 = latest.find((x) => x.number === 52)!
    expect([heb(at51.onot[0].abs), at51.onot[0].half]).toEqual(['27 Adar I 5787', 'night'])
    expect(clock(at51.start + 2 * 60_000, TZ)).toBe(clock(z.times('2027-03-05').shkiah!, TZ))
    expect([heb(at52.onot[0].abs), at52.onot[0].half, civilOf(at52.onot[0].abs)]).toEqual(['27 Adar I 5787', 'day', '2027-03-06'])
  })
})

describe('Example 10: pattern notice', () => {
  it('flows on 5 Tevet, 5 Shevat and 5 Adar I 5787, day: a possible veset kavua hachodesh, nothing applied', () => {
    const days = ['2026-12-15', '2027-01-13', '2027-02-12']
    expect(days.map((d) => heb(civil(d)))).toEqual(['5 Tevet 5787', '5 Shevat 5787', '5 Adar I 5787'])
    const events: MkEvent[] = []
    for (const d of days) {
      events.push(flow(d, 10, 0))
      const h = civilOf(civil(d) + 4)
      events.push(hefsek(h), moch(h), ev('immersion', at(civilOf(civil(h) + 7), 19, 0)))
    }
    const r = run(events, '2027-02-20')
    const notice = r.flags.find((f) => f.ruleId === 'K1')!
    expect(notice.title).toContain('hachodesh')
    expect(notice.ruling).toBeNull()
    // Still calculating as before: hachodesh, haflagah and beinonit all present.
    expect(vestOf(r, 'hachodesh').length).toBeGreaterThan(0)
    expect(vestOf(r, 'haflagah').length).toBeGreaterThan(0)
    expect(vestOf(r, 'beinonit').length).toBe(1)
    expect(vestOf(r, 'kavua')).toEqual([])
  })
})
