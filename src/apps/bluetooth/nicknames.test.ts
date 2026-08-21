import { beforeEach, describe, expect, it } from 'vitest'
import {
  __resetNicknameCache,
  displayName,
  isRenamed,
  loadNicknames,
  setNickname,
} from './nicknames'

/**
 * Nicknames live on the device, so these exercise the same localStorage path
 * the web build uses. The native build swaps in Capacitor Preferences behind
 * the same two functions.
 *
 * The suite runs in Node, which has no localStorage, so one is supplied here
 * rather than moving the whole project to jsdom — a browser environment for
 * 240 otherwise-pure tests would cost every run for the sake of this file.
 */
class MemoryStorage {
  private data = new Map<string, string>()
  getItem = (k: string): string | null => this.data.get(k) ?? null
  setItem = (k: string, v: string): void => void this.data.set(k, String(v))
  removeItem = (k: string): void => void this.data.delete(k)
  clear = (): void => this.data.clear()
  key = (i: number): string | null => [...this.data.keys()][i] ?? null
  get length(): number {
    return this.data.size
  }
}

globalThis.localStorage = new MemoryStorage() as unknown as Storage

beforeEach(() => {
  localStorage.clear()
  __resetNicknameCache()
})

describe('setNickname', () => {
  it('stores a name against the device address', async () => {
    const map = await setNickname('AA:BB', 'Car')
    expect(map['AA:BB']).toBe('Car')
  })

  it('survives a reload', async () => {
    await setNickname('AA:BB', 'Car')
    __resetNicknameCache()
    expect((await loadNicknames())['AA:BB']).toBe('Car')
  })

  it('trims surrounding whitespace', async () => {
    const map = await setNickname('AA:BB', '  Car  ')
    expect(map['AA:BB']).toBe('Car')
  })

  /*
    A blank name clears the entry rather than storing "". Otherwise "rename it
    back" leaves a row behind that makes the device display an empty name,
    which looks like the device lost its name entirely.
  */
  it('clears the entry when given a blank name', async () => {
    await setNickname('AA:BB', 'Car')
    const map = await setNickname('AA:BB', '   ')
    expect('AA:BB' in map).toBe(false)
  })

  it('keeps other devices untouched', async () => {
    await setNickname('AA:BB', 'Car')
    const map = await setNickname('CC:DD', 'Headphones')
    expect(map).toEqual({ 'AA:BB': 'Car', 'CC:DD': 'Headphones' })
  })
})

describe('displayName', () => {
  it('prefers the nickname', () => {
    expect(displayName({ 'AA:BB': 'Car' }, 'AA:BB', 'SYNC 3')).toBe('Car')
  })

  it('falls back to the name the phone reports', () => {
    expect(displayName({}, 'AA:BB', 'SYNC 3')).toBe('SYNC 3')
  })

  /*
    Keyed on address, not on the reported name — so a firmware update that
    renames the device itself doesn't quietly discard the name you chose.
  */
  it('keeps the nickname when the device renames itself', () => {
    const map = { 'AA:BB': 'Car' }
    expect(displayName(map, 'AA:BB', 'SYNC 3')).toBe('Car')
    expect(displayName(map, 'AA:BB', 'My Ford')).toBe('Car')
  })
})

describe('isRenamed', () => {
  it('is true only for devices with a stored name', () => {
    expect(isRenamed({ 'AA:BB': 'Car' }, 'AA:BB')).toBe(true)
    expect(isRenamed({ 'AA:BB': 'Car' }, 'CC:DD')).toBe(false)
  })
})

describe('corrupt storage', () => {
  it('recovers rather than throwing on every render', async () => {
    localStorage.setItem('bluetooth:nicknames', 'not json at all')
    __resetNicknameCache()
    await expect(loadNicknames()).resolves.toEqual({})
  })

  it('ignores a stored value of the wrong shape', async () => {
    localStorage.setItem('bluetooth:nicknames', '["an","array"]')
    __resetNicknameCache()
    await expect(loadNicknames()).resolves.toEqual({})
  })
})
