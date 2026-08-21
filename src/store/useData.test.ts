import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useData } from './useData'
import { TABLES, type DataAdapter, type TableName } from '@/data/adapter'

/**
 * Booting against a backend that is one migration behind.
 *
 * This is not hypothetical: the launcher asks for five tables that only exist
 * after 015_launcher.sql, and a household that had already been running Things
 * for months hits exactly this state the first time it opens the new build.
 * refetchAll used to reject the whole batch, so those five missing tables took
 * down Things too — an app whose own tables were all present and correct.
 */

/** What PostgREST returns for a table missing from its schema cache. */
const missingTableError = (table: string) => ({
  code: 'PGRST205',
  message: `Could not find the table 'public.${table}' in the schema cache`,
  details: null,
  hint: null,
})

function stubAdapter(absent: TableName[]): DataAdapter {
  return {
    kind: 'supabase',
    async list(table) {
      if (absent.includes(table)) throw missingTableError(table)
      return [] as never
    },
    async insert(_table, row) {
      return row as never
    },
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

beforeEach(() => {
  useData.setState({ missingTables: [] })
  vi.spyOn(console, 'warn').mockImplementation(() => {})
})

describe('refetchAll against an out-of-date backend', () => {
  const LAUNCHER_TABLES: TableName[] = [
    'app_access',
    'app_prefs',
    'app_notify_prefs',
    'notifications',
    'debts',
  ]

  it('still resolves when the launcher tables do not exist yet', async () => {
    useData.setState({ adapter: stubAdapter(LAUNCHER_TABLES) })
    await expect(useData.getState().refetchAll()).resolves.toBeUndefined()
  })

  it('reports exactly which tables are missing', async () => {
    useData.setState({ adapter: stubAdapter(LAUNCHER_TABLES) })
    await useData.getState().refetchAll()
    expect([...useData.getState().missingTables].sort()).toEqual([...LAUNCHER_TABLES].sort())
  })

  it('still loads every table that does exist', async () => {
    useData.setState({ adapter: stubAdapter(LAUNCHER_TABLES) })
    await useData.getState().refetchAll()
    // Things keeps working, which is the whole point.
    for (const table of TABLES) {
      expect(Array.isArray(useData.getState()[table])).toBe(true)
    }
  })

  it('clears the missing list once the migration has been run', async () => {
    useData.setState({ adapter: stubAdapter(LAUNCHER_TABLES) })
    await useData.getState().refetchAll()
    expect(useData.getState().missingTables).not.toHaveLength(0)

    useData.setState({ adapter: stubAdapter([]) })
    await useData.getState().refetchAll()
    expect(useData.getState().missingTables).toHaveLength(0)
  })

  it('keeps rows already loaded for a table that briefly fails to resolve', async () => {
    useData.setState({ adapter: stubAdapter([]) })
    await useData.getState().refetchAll()
    useData.setState({ debts: [{ id: 'kept' }] as never })

    useData.setState({ adapter: stubAdapter(['debts']) })
    await useData.getState().refetchAll()
    expect(useData.getState().debts.map((d) => d.id)).toEqual(['kept'])
  })

  /*
    The other half of the contract, and the reason the check is narrow.

    Being offline must NOT be mistaken for a missing table: swallowing it would
    blank every list and present a network outage as "your data is gone", with
    no retry and no offline banner.
  */
  it('still rejects on a network failure rather than reporting empty data', async () => {
    const offline: DataAdapter = {
      ...stubAdapter([]),
      async list() {
        throw new TypeError('Failed to fetch')
      },
    }
    useData.setState({ adapter: offline })
    await expect(useData.getState().refetchAll()).rejects.toThrow('Failed to fetch')
  })

  it('still rejects on a permission error rather than reporting empty data', async () => {
    const denied: DataAdapter = {
      ...stubAdapter([]),
      async list() {
        throw { code: '42501', message: 'permission denied for table debts' }
      },
    }
    useData.setState({ adapter: denied })
    await expect(useData.getState().refetchAll()).rejects.toMatchObject({ code: '42501' })
  })
})
