import { describe, expect, it } from 'vitest'
import { tileLook } from './useMember'

const HER = 'a'
const HIM = 'b'
const row = (owner: string, from: string, tile?: { name: string; icon: string }) => ({
  owner_id: owner,
  effective_from: from,
  settings: tile ? { tile } : {},
})

describe('tileLook', () => {
  it('her latest settings version names her tile', () => {
    const rows = [row(HER, '2026-12-01', { name: 'Dates', icon: 'star' }), row(HER, '2026-11-01', { name: 'Old', icon: 'book' })]
    expect(tileLook(HER, rows, [])).toEqual({ mikvah: { name: 'Dates', icon: 'star' } })
  })
  it('his partner row names his; nobody else gets an override', () => {
    const partner = [{ id: HIM, prefs: { tile: { name: 'Planner', icon: 'calendar' } } }]
    expect(tileLook(HIM, [], partner)).toEqual({ mikvah: { name: 'Planner', icon: 'calendar' } })
    expect(tileLook('c', [row(HER, '2026-12-01', { name: 'Dates', icon: 'star' })], partner)).toEqual({})
  })
  it('a blank name falls back to the registry name', () => {
    expect(tileLook(HER, [row(HER, '2026-12-01', { name: '  ', icon: 'star' })], [])).toEqual({ mikvah: { name: undefined, icon: 'star' } })
  })
})
