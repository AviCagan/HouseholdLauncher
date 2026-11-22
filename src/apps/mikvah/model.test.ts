import { describe, expect, it } from 'vitest'
import type { MkEventRow, MkReminder, MkSettingsRow } from '@/data/types'
import { calculate, hebcalZmanim, zonedTime, CHABAD, type MkEvent, type Place } from './engine'
import { diffQueue, queueRows, readStored, settingsAt, toEvent, DEFAULT_STORED, type Stored } from './model'

const CITY: Place = { name: 'Example city', lat: 40.7128, lng: -74.006, tz: 'America/New_York' }
const z = hebcalZmanim(CITY)
const at = (day: string, hh: number, mm: number) => zonedTime(day, hh, mm, CITY.tz)
const HER = '11111111-1111-1111-1111-111111111111'
const HIM = '22222222-2222-2222-2222-222222222222'
const stored: Stored = { ...DEFAULT_STORED, chodeshInPeriod: 'drop', home: CITY }

const ev = (id: string, kind: MkEvent['kind'], t: number, extra: Partial<MkEvent> = {}): MkEvent => ({ id, kind, at: t, ...extra })
const flow = ev('f', 'flow', at('2026-11-22', 10, 0))
const hef = ev('h', 'hefsek', z.times('2026-11-26').shkiah! - 25 * 60_000, { result: 'clean' })
const moch = ev('m', 'moch', at('2026-11-26', 19, 30), { result: 'clean' })

describe('stored settings', () => {
  it('fills anything missing with the Chabad defaults and a discreet tile', () => {
    const s = readStored({ marginMinutes: 5 })
    expect(s.marginMinutes).toBe(5)
    expect(s.sunset).toBe(CHABAD.sunset)
    expect(s.chodeshInPeriod).toBeNull()
    expect(s.tile).toEqual({ name: 'Calendar', icon: 'calendar' })
    expect(s.home).toBeNull()
    expect(s.remind.hefsek).toBe(true)
  })
  it('explains a past date under the settings in force then', () => {
    const row = (id: string, from: string, settings: Record<string, unknown>): MkSettingsRow => ({
      id, owner_id: HER, settings, effective_from: from, created_at: from, updated_at: from,
    })
    const rows = [row('b', '2026-12-01T00:00:00Z', { marginMinutes: 4 }), row('a', '2026-01-01T00:00:00Z', { marginMinutes: 2 })]
    expect(settingsAt(rows, HER, Date.parse('2026-06-01T00:00:00Z'))?.marginMinutes).toBe(2)
    expect(settingsAt(rows, HER, Date.parse('2026-12-02T00:00:00Z'))?.marginMinutes).toBe(4)
    expect(settingsAt(rows, HIM, Date.parse('2026-12-02T00:00:00Z'))).toBeNull()
  })
})

describe('events', () => {
  it('a voided row is kept but ignored', () => {
    const row: MkEventRow = {
      id: 'x', owner_id: HER, kind: 'flow', at: '2026-11-22T15:00:00Z', result: null, data: {},
      voided_at: '2026-11-23T00:00:00Z', created_at: '', updated_at: '',
    }
    expect(toEvent(row)).toMatchObject({ id: 'x', kind: 'flow', at: Date.parse('2026-11-22T15:00:00Z'), voided: true })
  })
})

describe('the reminder queue', () => {
  const now = at('2026-11-26', 20, 0)
  const result = calculate({ events: [flow, hef, moch], settings: stored, zmanim: z, now })
  const rows = queueRows({ result, zmanim: z, stored, his: { vestot: true, mikvah: true }, her: HER, partner: HIM, now })

  it('one row per recipient, worded neutrally, on the minute', () => {
    expect(rows.length).toBeGreaterThan(20)
    expect(rows.every((r) => r.title === 'Calendar reminder' && r.body === '')).toBe(true)
    expect(rows.every((r) => Date.parse(r.fire_at) % 60_000 === 0)).toBe(true)
    // Her bedikot are hers alone; the onot reach both phones.
    expect(rows.filter((r) => r.id.startsWith('bedikah:')).every((r) => r.target_id === HER)).toBe(true)
    const start = rows.filter((r) => r.id.startsWith('veset:') && r.id.includes(':start@'))
    expect(new Set(start.map((r) => r.target_id))).toEqual(new Set([HER, HIM]))
  })

  it('his choices and hers are respected; detail only when she turns it on', () => {
    const quiet = queueRows({ result, zmanim: z, stored: { ...stored, remind: { ...stored.remind, bedikah: false } }, his: { vestot: false, mikvah: false }, her: HER, partner: HIM, now })
    expect(quiet.some((r) => r.id.startsWith('bedikah:'))).toBe(false)
    expect(quiet.some((r) => r.target_id === HIM)).toBe(false)
    const loud = queueRows({ result, zmanim: z, stored: { ...stored, detailInNotifications: true }, his: { vestot: true, mikvah: true }, her: HER, partner: HIM, now })
    expect(loud.find((r) => r.id.startsWith('bedikah:'))?.body).toMatch(/bedikah/)
    expect(loud.find((r) => r.id.startsWith('bedikah:'))?.title).toBe('Calendar')
  })

  it('with no partner named, nothing is queued for anyone else', () => {
    const solo = queueRows({ result, zmanim: z, stored, his: { vestot: true, mikvah: true }, her: HER, partner: null, now })
    expect(solo.every((r) => r.target_id === HER)).toBe(true)
  })

  it('diff: inserts new rows, updates moved ones, cancels the unwanted, leaves sent and due rows alone', () => {
    const t = (min: number) => new Date(now + min * 60_000).toISOString()
    const base = { owner_id: HER, target_id: HER, title: 'Calendar reminder', body: '', rule_id: 'N1', cancelled: false, sent_at: null, created_at: '', updated_at: '' }
    const existing: MkReminder[] = [
      { ...base, id: 'a', fire_at: t(10) },
      { ...base, id: 'b', fire_at: t(20) },
      { ...base, id: 'gone', fire_at: t(30) },
      { ...base, id: 'sent', fire_at: t(-5), sent_at: t(-5) },
      { ...base, id: 'due', fire_at: t(0) },
      { ...base, id: 'other', owner_id: HIM, fire_at: t(30) },
    ]
    const wanted = [
      { ...base, id: 'a', fire_at: t(10) },
      { ...base, id: 'b', fire_at: t(25) },
      { ...base, id: 'sent', fire_at: t(40) },
      { ...base, id: 'new', fire_at: t(50) },
    ].map(({ created_at: _c, updated_at: _u, ...r }) => r)
    const d = diffQueue(wanted, existing, HER, now)
    expect(d.insert.map((r) => r.id)).toEqual(['new'])
    expect(d.update).toEqual([
      { id: 'b', patch: { fire_at: t(25), title: 'Calendar reminder', body: '', rule_id: 'N1', cancelled: false } },
      { id: 'gone', patch: { cancelled: true } },
    ])
  })
})
