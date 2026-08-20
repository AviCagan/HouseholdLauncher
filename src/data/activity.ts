import type { ActivityLog } from './types'
import type { TableName } from './adapter'

/**
 * Local mirror of the Postgres `log_activity()` trigger.
 *
 * Same reasoning as `computeNextDue` mirroring `compute_next_due()`: the local
 * adapter is a real backend, not a stub, so a feature that exists only as a
 * database trigger would silently do nothing until Supabase is wired up — the
 * activity feed and the scoreboard would just sit empty and look broken.
 *
 * The branch order here is load-bearing and matches the SQL exactly:
 * completion is checked BEFORE claiming, because completing a recurring chore
 * clears `claimed_by` in the same write. Check claiming first and every chore
 * completion is logged as "unclaimed" — which is precisely the bug that had to
 * be fixed in the trigger.
 */

export const ACTIVITY_TABLES = [
  'todos',
  'chores',
  'shopping_items',
  'wishlist_items',
] as const

export type ActivityTable = (typeof ACTIVITY_TABLES)[number]

export const isActivityTable = (table: TableName): table is ActivityTable =>
  (ACTIVITY_TABLES as readonly string[]).includes(table)

/** The union of columns this looks at, across four differently-shaped tables. */
interface AnyRow {
  id: string
  title?: string
  created_by?: string | null
  updated_by?: string | null
  claimed_by?: string | null
  is_done?: boolean
  is_purchased?: boolean
  last_completed_by?: string | null
}

export interface DerivedActivity {
  event: ActivityLog['event']
  actorId: string | null
}

export function deriveActivity(
  table: ActivityTable,
  op: 'insert' | 'update' | 'delete',
  before: AnyRow | null,
  after: AnyRow | null,
): DerivedActivity | null {
  if (op === 'insert' && after) {
    return { event: 'added', actorId: after.created_by ?? null }
  }

  if (op === 'delete' && before) {
    return {
      event: 'deleted',
      actorId: before.updated_by ?? before.claimed_by ?? before.created_by ?? null,
    }
  }

  if (op !== 'update' || !before || !after) return null

  // --- completion, checked first (see the note above) ---
  if (table === 'todos' || table === 'shopping_items') {
    if (before.is_done !== after.is_done) {
      return {
        event: after.is_done ? 'completed' : 'uncompleted',
        actorId: after.updated_by ?? after.claimed_by ?? after.created_by ?? null,
      }
    }
  }

  if (table === 'chores') {
    if (
      before.last_completed_by !== after.last_completed_by &&
      after.last_completed_by != null
    ) {
      return { event: 'completed', actorId: after.last_completed_by }
    }
  }

  if (table === 'wishlist_items') {
    if (before.is_purchased !== after.is_purchased) {
      return {
        event: after.is_purchased ? 'completed' : 'uncompleted',
        actorId: after.updated_by ?? after.created_by ?? null,
      }
    }
  }

  // --- then claiming ---
  if (table !== 'wishlist_items') {
    const wasClaimed = before.claimed_by != null
    const isClaimed = after.claimed_by != null
    if (wasClaimed !== isClaimed) {
      return isClaimed
        ? { event: 'claimed', actorId: after.claimed_by ?? null }
        : { event: 'unclaimed', actorId: before.claimed_by ?? null }
    }
  }

  // --- then a plain edit ---
  if (after.updated_by != null && before.updated_by !== after.updated_by) {
    return { event: 'edited', actorId: after.updated_by }
  }

  // Sort-order shuffling from a drag, or the ticker touching next_due_at.
  return null
}

export function activityRow(
  table: ActivityTable,
  rowId: string,
  title: string,
  derived: DerivedActivity,
): ActivityLog {
  return {
    id: crypto.randomUUID(),
    table_name: table,
    row_id: rowId,
    title,
    event: derived.event,
    actor_id: derived.actorId,
    created_at: new Date().toISOString(),
  }
}
