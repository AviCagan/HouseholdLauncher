import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * The local adapter is the entire backend until Supabase credentials exist, so
 * a write that silently doesn't persist is a real data-loss bug rather than a
 * degraded fallback.
 *
 * These exist because `update()` addressed rows with
 * `(r.id ?? String(r.singleton)) === id`, which matches neither of the two
 * tables that aren't keyed on `id`. It returned null rather than throwing, so
 * every settings change in local mode looked saved and was gone on reload.
 */

const store = new Map<string, unknown>()
vi.mock('idb-keyval', () => ({
  get: async (k: string) => store.get(k),
  set: async (k: string, v: unknown) => {
    // Deep clone on write, like a real IndexedDB round-trip, so a test can't
    // pass by mutating the same object the adapter still holds in memory.
    store.set(k, structuredClone(v))
  },
}))

const { createLocalAdapter } = await import('./localAdapter')

beforeEach(() => {
  store.clear()
  vi.resetModules()
})

describe('localAdapter row addressing', () => {
  it('persists an update to profile_settings, which is keyed on profile_id', async () => {
    const a = createLocalAdapter()
    await a.insert('profile_settings', {
      profile_id: 'avi',
      theme_mode: 'system',
      accent_hex: '#7c5cff',
    } as never)

    const updated = await a.update('profile_settings', 'avi', {
      theme_mode: 'oled',
    } as never)

    expect(updated).not.toBeNull()
    const [row] = await a.list('profile_settings')
    expect((row as { theme_mode: string }).theme_mode).toBe('oled')
  })

  it('persists an update to household_settings, which is keyed on the literal "singleton"', async () => {
    const a = createLocalAdapter()
    await a.insert('household_settings', {
      singleton: true,
      home_address: null,
      auto_clear_days: 7,
    } as never)

    const updated = await a.update('household_settings', 'singleton', {
      home_address: '10 Downing Street',
    } as never)

    expect(updated).not.toBeNull()
    const [row] = await a.list('household_settings')
    expect((row as { home_address: string }).home_address).toBe('10 Downing Street')
  })

  it('still addresses ordinary tables by id', async () => {
    const a = createLocalAdapter()
    await a.insert('todos', { id: 't1', title: 'Milk', is_done: false } as never)
    await a.update('todos', 't1', { is_done: true } as never)
    const [row] = await a.list('todos')
    expect((row as { is_done: boolean }).is_done).toBe(true)
  })

  it('reports a genuinely missing row as null rather than silently matching', async () => {
    const a = createLocalAdapter()
    expect(await a.update('todos', 'nope', { is_done: true } as never)).toBeNull()
  })
})
