import { get, set } from 'idb-keyval'
import type { ChangeHandler, DataAdapter, TableMap, TableName } from './adapter'
import { TABLES, nowIso, rowKey } from './adapter'
import { activityRow, deriveActivity, isActivityTable } from './activity'
import type { Chore, Weekday } from './types'

/**
 * IndexedDB-backed adapter.
 *
 * This is not a stub — it is the entire backend until Supabase credentials
 * exist, which keeps the app fully usable on day one and forces the offline
 * path to actually work rather than being bolted on at the end.
 */

const KEY = 'things:local:v1'

type Db = { [K in TableName]: TableMap[K][] }

const emptyDb = (): Db =>
  Object.fromEntries(TABLES.map((t) => [t, []])) as unknown as Db

let cache: Db | null = null
let writeChain: Promise<void> = Promise.resolve()

async function load(): Promise<Db> {
  if (cache) return cache
  const stored = await get<Db>(KEY)
  cache = stored ? { ...emptyDb(), ...stored } : emptyDb()
  return cache
}

/** Serialise writes so concurrent mutations can't clobber each other. */
function persist(): Promise<void> {
  writeChain = writeChain.then(async () => {
    if (cache) await set(KEY, cache)
  })
  return writeChain
}

const listeners = new Set<ChangeHandler>()

function emit(event: Parameters<ChangeHandler>[0]) {
  for (const l of listeners) l(event)
}

/**
 * Stands in for the `log_activity()` database trigger, which obviously doesn't
 * run here. Called after a write has already been applied, so a failure to log
 * can never take the write down with it.
 */
function logActivity(
  db: Db,
  table: TableName,
  op: 'insert' | 'update' | 'delete',
  before: Record<string, unknown> | null,
  after: Record<string, unknown> | null,
) {
  if (!isActivityTable(table)) return
  const derived = deriveActivity(table, op, before as never, after as never)
  if (!derived) return

  const source = (after ?? before) as { id: string; title?: string }
  const row = activityRow(table, source.id, source.title ?? '', derived)
  db.activity_log.push(row)
  emit({ table: 'activity_log', type: 'insert', row })
}

export function createLocalAdapter(): DataAdapter {
  return {
    kind: 'local',

    async list(table) {
      const db = await load()
      return [...db[table]] as never
    },

    async insert(table, row) {
      const db = await load()
      ;(db[table] as unknown[]).push(row)
      logActivity(db, table, 'insert', null, row as never)
      await persist()
      emit({ table, type: 'insert', row } as never)
      return row
    },

    async update(table, id, patch) {
      const db = await load()
      const rows = db[table] as unknown[]
      // Was `(r.id ?? String(r.singleton)) === id`, which matched neither of
      // the two tables that aren't keyed on `id`: profile_settings rows have
      // no `id` and no `singleton`, so it compared the string "undefined", and
      // household_settings compared "true" against the key "singleton". Both
      // returned -1, `update` returned null instead of throwing, and every
      // settings change in local mode was silently dropped on reload.
      const idx = rows.findIndex((r) => rowKey(table, r) === id)
      if (idx < 0) return null
      const before = rows[idx] as Record<string, unknown>
      const next = { ...before, ...patch, updated_at: nowIso() }
      rows[idx] = next as never
      logActivity(db, table, 'update', before as never, next as never)
      await persist()
      emit({ table, type: 'update', row: next } as never)
      return next as never
    },

    async remove(table, id) {
      const db = await load()
      const rows = db[table] as Array<{ id?: string }>
      const idx = rows.findIndex((r) => r.id === id)
      if (idx < 0) return
      const [removed] = rows.splice(idx, 1)
      logActivity(db, table, 'delete', removed as never, null)
      await persist()
      emit({ table, type: 'delete', id })
    },

    async claim(table, id, profileId) {
      const db = await load()
      const rows = db[table] as Array<{ id: string; claimed_by: string | null }>
      const row = rows.find((r) => r.id === id)
      if (!row) return { won: false }
      // Mirrors the server's conditional update so both adapters behave alike.
      if (row.claimed_by !== null) return { won: false, row: row as never }
      const beforeClaim = { ...row }
      row.claimed_by = profileId
      ;(row as { updated_at?: string }).updated_at = nowIso()
      logActivity(db, table, 'update', beforeClaim as never, row as never)
      await persist()
      emit({ table, type: 'update', row } as never)
      return { won: true, row: row as never }
    },

    async unclaim(table, id, profileId) {
      const db = await load()
      const rows = db[table] as Array<{ id: string; claimed_by: string | null }>
      const row = rows.find((r) => r.id === id)
      if (!row || row.claimed_by !== profileId) return null
      const beforeUnclaim = { ...row }
      row.claimed_by = null
      ;(row as { updated_at?: string }).updated_at = nowIso()
      logActivity(db, table, 'update', beforeUnclaim as never, row as never)
      await persist()
      emit({ table, type: 'update', row } as never)
      return row as never
    },

    async completeRecurring(id, profileId, seenLastCompletedAt) {
      const db = await load()
      const rows = db.chores as Chore[]
      const row = rows.find((r) => r.id === id)
      if (!row) return { won: false }
      if ((row.last_completed_at ?? null) !== seenLastCompletedAt) {
        return { won: false, row }
      }
      const beforeComplete = { ...row }
      row.last_completed_at = nowIso()
      row.last_completed_by = profileId
      row.claimed_by = null
      row.cooldown_notified_at = null
      row.next_due_at = computeNextDue(row)
      row.updated_at = nowIso()
      logActivity(db, 'chores', 'update', beforeComplete as never, row as never)
      await persist()
      emit({ table: 'chores', type: 'update', row })
      return { won: true, row }
    },

    subscribe(onChange) {
      listeners.add(onChange)
      return () => listeners.delete(onChange)
    },
  } satisfies DataAdapter as DataAdapter
}

/**
 * Local mirror of the Postgres `compute_next_due()` trigger, so a chore behaves
 * identically before and after Supabase is wired up.
 */
export function computeNextDue(chore: Chore): string | null {
  if (!chore.is_recurring || !chore.last_completed_at || !chore.recurrence_unit) return null

  if (chore.recurrence_unit === 'weekdays') {
    if (!chore.recurrence_days?.length) return null
    // Mirrors the Postgres trigger's loop: walk forward at most 7 days to the
    // next one that falls on a selected weekday.
    const start = new Date(chore.last_completed_at)
    for (let step = 1; step <= 7; step++) {
      const candidate = new Date(start)
      candidate.setDate(candidate.getDate() + step)
      if (chore.recurrence_days.includes(candidate.getDay() as Weekday)) {
        return candidate.toISOString()
      }
    }
    return null
  }

  if (!chore.recurrence_count) return null
  const d = new Date(chore.last_completed_at)
  const n = chore.recurrence_count
  switch (chore.recurrence_unit) {
    case 'hours':
      d.setHours(d.getHours() + n)
      break
    case 'days':
      d.setDate(d.getDate() + n)
      break
    case 'weeks':
      d.setDate(d.getDate() + n * 7)
      break
    case 'months':
      // Calendar-correct: this is why recurrence is (count, unit) and not
      // raw seconds. "Monthly" must mean the same day next month, not +30d.
      d.setMonth(d.getMonth() + n)
      break
    case 'years':
      d.setFullYear(d.getFullYear() + n)
      break
  }
  return d.toISOString()
}
