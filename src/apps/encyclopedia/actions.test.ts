import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useData } from '@/store/useData'
import type { DataAdapter } from '@/data/adapter'
import { addEntry, removeEntry, updateEntry } from './actions'

vi.mock('sonner', () => ({ toast: { error: vi.fn(), success: vi.fn() } }))

/**
 * The one property that matters: nothing here waits for the network. The row
 * is on the page — and handed back — the moment the action is called, and a
 * commit that fails takes it off again rather than leaving a ghost.
 */

function adapterThat(insert: () => Promise<unknown>): DataAdapter {
  return {
    kind: 'supabase',
    async list() {
      return [] as never
    },
    insert: insert as never,
    async update() {
      return null as never
    },
    async remove() {},
    async claim() {
      return { won: true } as never
    },
    async unclaim() {
      return null as never
    },
    async steal() {
      return { won: true } as never
    },
    async completeRecurring() {
      return { won: true } as never
    },
    subscribe() {
      return () => {}
    },
  }
}

const input = {
  term: 'schlumpy',
  pronunciation: ' SHLUM-pee ',
  part_of_speech: 'adjective' as const,
  definition: 'Looking as though one has been rained on, emotionally.',
  example: '',
  origin: null,
}

beforeEach(() => {
  useData.setState({ lexicon_entries: [] })
  vi.spyOn(console, 'error').mockImplementation(() => {})
})

describe('addEntry', () => {
  it('puts the entry on the page before the commit has resolved', () => {
    let resolve: (() => void) | null = null
    const pending = new Promise<void>((r) => (resolve = r))
    useData.setState({ adapter: adapterThat(() => pending) })

    const row = addEntry(input, 'jackie')
    expect(row?.term).toBe('schlumpy')
    expect(row?.pronunciation).toBe('SHLUM-pee')
    expect(row?.example).toBeNull()
    expect(useData.getState().lexicon_entries.map((e) => e.id)).toEqual([row!.id])
    resolve!()
  })

  it('refuses a blank term or definition without touching the store', () => {
    useData.setState({ adapter: adapterThat(async () => ({})) })
    expect(addEntry({ ...input, term: '  ' }, null)).toBeNull()
    expect(addEntry({ ...input, definition: '' }, null)).toBeNull()
    expect(useData.getState().lexicon_entries).toEqual([])
  })

  it('takes the entry back off the page when the commit fails', async () => {
    useData.setState({ adapter: adapterThat(async () => Promise.reject(new Error('offline'))) })
    const row = addEntry(input, null)
    expect(useData.getState().lexicon_entries).toHaveLength(1)
    await new Promise((r) => setTimeout(r, 0))
    expect(useData.getState().lexicon_entries).toEqual([])
    expect(row).not.toBeNull()
  })
})

describe('updateEntry and removeEntry', () => {
  it('apply at once and restore the old row if the commit fails', async () => {
    const adapter = adapterThat(async () => ({}))
    adapter.update = async () => Promise.reject(new Error('offline'))
    adapter.remove = async () => Promise.reject(new Error('offline'))
    useData.setState({ adapter })
    const row = addEntry(input, null)!

    expect(updateEntry(row, { ...input, definition: 'Revised.' }, 'avi')).toBe(true)
    expect(useData.getState().lexicon_entries[0].definition).toBe('Revised.')
    await new Promise((r) => setTimeout(r, 0))
    expect(useData.getState().lexicon_entries[0].definition).toBe(input.definition)

    removeEntry(row)
    expect(useData.getState().lexicon_entries).toEqual([])
    await new Promise((r) => setTimeout(r, 0))
    expect(useData.getState().lexicon_entries.map((e) => e.id)).toEqual([row.id])
  })

  it('refuses a revision that blanks the term', () => {
    useData.setState({ adapter: adapterThat(async () => ({})) })
    const row = addEntry(input, null)!
    expect(updateEntry(row, { ...input, term: '' }, null)).toBe(false)
    expect(useData.getState().lexicon_entries[0].term).toBe('schlumpy')
  })
})
