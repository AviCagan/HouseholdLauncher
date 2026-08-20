import { get, set } from 'idb-keyval'
import type { DataAdapter, TableName } from './adapter'

/**
 * Offline mutation queue.
 *
 * Writes made while disconnected are appended here and replayed in order once
 * a connection returns. Consecutive updates to the same row collapse to the
 * last one, so a burst of urgency taps becomes a single write.
 */

const KEY = 'things:outbox:v1'
const MAX = 500

export interface Mutation {
  id: string
  table: TableName
  op: 'insert' | 'update' | 'delete'
  rowId: string
  payload?: unknown
  ts: number
}

let queue: Mutation[] | null = null

async function load(): Promise<Mutation[]> {
  if (queue) return queue
  queue = (await get<Mutation[]>(KEY)) ?? []
  return queue
}

async function persist(): Promise<void> {
  if (queue) await set(KEY, queue)
}

export async function enqueue(m: Omit<Mutation, 'id' | 'ts'>): Promise<number> {
  const q = await load()
  q.push({ ...m, id: crypto.randomUUID(), ts: Date.now() })
  if (q.length > MAX) q.splice(0, q.length - MAX)
  await persist()
  return q.length
}

export async function pendingCount(): Promise<number> {
  return (await load()).length
}

/** Keep only the last update per (table,row); inserts and deletes are kept. */
function collapse(items: Mutation[]): Mutation[] {
  const lastUpdate = new Map<string, number>()
  items.forEach((m, i) => {
    if (m.op === 'update') lastUpdate.set(`${m.table}:${m.rowId}`, i)
  })
  return items.filter(
    (m, i) => m.op !== 'update' || lastUpdate.get(`${m.table}:${m.rowId}`) === i,
  )
}

/**
 * Replay everything. Stops at the first failure and keeps the remainder, so a
 * transient network blip doesn't drop writes.
 */
export async function drain(adapter: DataAdapter): Promise<number> {
  const q = collapse(await load())
  let sent = 0

  for (const m of q) {
    try {
      if (m.op === 'insert') {
        await adapter.insert(m.table, m.payload as never)
      } else if (m.op === 'update') {
        await adapter.update(m.table, m.rowId, m.payload as never)
      } else {
        await adapter.remove(m.table, m.rowId)
      }
      sent++
    } catch {
      break
    }
  }

  queue = q.slice(sent)
  await persist()
  return sent
}

export async function clear(): Promise<void> {
  queue = []
  await persist()
}
