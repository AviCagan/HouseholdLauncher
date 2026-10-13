import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import { createSupabaseAdapter } from './supabaseAdapter'
import { TABLES } from './adapter'

/**
 * The realtime wiring, against a fake client: which tables go on which
 * channel, and how many refetches a reconnect costs.
 */

interface FakeChannel {
  name: string
  tables: string[]
  subscribe: (cb: (status: string) => void) => FakeChannel
  status?: (status: string) => void
}

function fakeClient() {
  const channels: FakeChannel[] = []
  const removed: string[] = []
  const sb = {
    channel(name: string) {
      const ch: FakeChannel = {
        name,
        tables: [],
        subscribe(cb) {
          ch.status = cb
          return ch
        },
      }
      Object.assign(ch, {
        on(_kind: string, filter: { table: string }) {
          ch.tables.push(filter.table)
          return ch
        },
      })
      channels.push(ch)
      return ch
    },
    removeChannel(ch: FakeChannel) {
      removed.push(ch.name)
      return Promise.resolve('ok')
    },
  }
  return { sb: sb as unknown as SupabaseClient, channels, removed }
}

const WATCH = ['watch_shows', 'watch_seasons', 'watch_ratings', 'watch_settings']
const VIEWS = ['watch_views']

describe('supabase adapter: realtime', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    // The tests run in node; the adapter only needs to listen for visibility.
    vi.stubGlobal('document', { hidden: false, addEventListener() {}, removeEventListener() {} })
  })
  afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllGlobals()
  })

  it("gives Watched its own channel, so its missing tables can't stall the rest", () => {
    const { sb, channels } = fakeClient()
    const stop = createSupabaseAdapter(sb).subscribe(() => {}, () => {})
    const main = channels.find((c) => c.name === 'household')!
    const watched = channels.find((c) => c.name === 'household-watched')!
    const views = channels.find((c) => c.name === 'household-watched-views')!
    expect(views.tables).toEqual(VIEWS)
    expect(watched.tables.sort()).toEqual([...WATCH].sort())
    expect(main.tables.some((t) => WATCH.includes(t) || VIEWS.includes(t))).toBe(false)
    // Every table is listened to exactly once.
    expect([...main.tables, ...watched.tables, ...views.tables].sort()).toEqual([...TABLES].sort())
    stop()
  })

  it('refetches once when the channels come back together', () => {
    const { sb, channels } = fakeClient()
    const resync = vi.fn()
    const stop = createSupabaseAdapter(sb).subscribe(() => {}, resync)
    for (const c of channels) c.status?.('SUBSCRIBED')
    vi.advanceTimersByTime(100)
    expect(resync).toHaveBeenCalledTimes(1)
    // A channel that rejoins on its own later still gets its refetch.
    channels[1].status?.('SUBSCRIBED')
    vi.advanceTimersByTime(100)
    expect(resync).toHaveBeenCalledTimes(2)
    stop()
  })

  it('removes every channel and drops a pending refetch on stop', () => {
    const { sb, channels, removed } = fakeClient()
    const resync = vi.fn()
    const stop = createSupabaseAdapter(sb).subscribe(() => {}, resync)
    channels[0].status?.('SUBSCRIBED')
    stop()
    vi.advanceTimersByTime(100)
    expect(resync).not.toHaveBeenCalled()
    expect(removed.sort()).toEqual(channels.map((c) => c.name).sort())
  })
})
