import type { SupabaseClient } from '@supabase/supabase-js'
import type {
  ChangeHandler,
  ClaimResult,
  DataAdapter,
  TableMap,
  TableName,
} from './adapter'
import { TABLES, isAppKeyed, rowKey, splitAppKey } from './adapter'
import type { Chore } from './types'

/**
 * Supabase-backed adapter: REST for writes, one realtime channel for reads.
 */

/**
 * Narrow a query to exactly the row `id` addresses.
 *
 * Not every table is keyed on `id`, and two different kinds of exception live
 * here. The settings tables swap in a different single column. The app_*
 * tables are keyed on the PAIR (profile_id, app_id), which rowKey() joins with
 * a colon — matching on either half alone would select every app for that
 * member, or every member for that app, and an update would rewrite all of
 * them without erroring.
 */
function whereKey(query: LooseQuery, table: TableName, id: string): LooseQuery {
  if (table === 'household_settings') return query.eq('singleton', true)
  if (table === 'profile_settings') return query.eq('profile_id', id)
  if (isAppKeyed(table)) {
    const [profileId, appId] = splitAppKey(id)
    return query.eq('profile_id', profileId).eq('app_id', appId)
  }
  return query.eq('id', id)
}

/**
 * Minimal shape of the PostgREST query builder.
 *
 * Without generated database types (`supabase gen types`), the client infers a
 * `never` row shape and rejects partial updates outright. Rather than scatter
 * casts through every method, the builder is loosened once here at the
 * boundary — the DataAdapter interface above still types every call site.
 */
interface LooseQuery extends PromiseLike<{ data: unknown; error: unknown }> {
  eq(column: string, value: unknown): LooseQuery
  is(column: string, value: unknown): LooseQuery
  select(columns?: string): LooseQuery
  single(): LooseQuery
  maybeSingle(): LooseQuery
  order(column: string, opts?: { ascending?: boolean }): LooseQuery
  limit(count: number): LooseQuery
}

interface LooseTable {
  select(columns?: string): LooseQuery
  insert(row: unknown): LooseQuery
  update(patch: unknown): LooseQuery
  delete(): LooseQuery
}

export function createSupabaseAdapter(sb: SupabaseClient): DataAdapter {
  const from = (table: TableName): LooseTable =>
    sb.from(table) as unknown as LooseTable

  return {
    kind: 'supabase',

    async list(table) {
      // activity_log grows forever — nothing ever deletes from it — so unlike
      // every other table it can't be fetched in full. Newest 200 is what the
      // bell shows anyway; there's no case for pulling the whole history down
      // to every device on every reconnect.
      const query =
        table === 'activity_log'
          ? from(table).select('*').order('created_at', { ascending: false }).limit(200)
          : from(table).select('*')
      const { data, error } = await query
      if (error) throw error
      return (data ?? []) as never
    },

    async insert(table, row) {
      const { data, error } = await from(table).insert(row).select().single()
      if (error) throw error
      return data as never
    },

    async update(table, id, patch) {
      const { data, error } = await whereKey(from(table).update(patch), table, id)
        .select()
        .maybeSingle()
      if (error) throw error
      return (data ?? null) as never
    },

    async remove(table, id) {
      const { error } = await whereKey(from(table).delete(), table, id)
      if (error) throw error
    },

    /**
     * Conditional update — `.is('claimed_by', null)` makes the database the
     * arbiter. Zero rows back means the other person won the race, which is a
     * real outcome rather than an error.
     */
    async claim(table, id, profileId) {
      const { data, error } = await from(table)
        .update({ claimed_by: profileId })
        .eq('id', id)
        .is('claimed_by', null)
        .select()
      if (error) throw error

      const rows = (data ?? []) as unknown[]
      if (rows.length === 0) {
        // Fetch the winner so the UI can name them.
        const { data: current } = await from(table)
          .select('*')
          .eq('id', id)
          .maybeSingle()
        return { won: false, row: (current ?? undefined) as never }
      }
      return { won: true, row: rows[0] as never }
    },

    async unclaim(table, id, profileId) {
      const { data, error } = await from(table)
        .update({ claimed_by: null })
        .eq('id', id)
        .eq('claimed_by', profileId)
        .select()
        .maybeSingle()
      if (error) throw error
      return (data ?? null) as never
    },

    /**
     * Take a claim, but only from the person the caller saw holding it.
     *
     * `.eq('claimed_by', seenHolder)` is what makes the theft honest: if the
     * holder released it a moment ago, this matches nothing and the row is
     * claimed the ordinary way instead of logged as taken from someone who had
     * already let go.
     */
    async steal(table, id, profileId, seenHolder) {
      const { data, error } = await from(table)
        .update({ claimed_by: profileId })
        .eq('id', id)
        .eq('claimed_by', seenHolder)
        .select()
      if (error) throw error

      const rows = (data ?? []) as unknown[]
      if (rows.length === 0) {
        const { data: current } = await from(table).select('*').eq('id', id).maybeSingle()
        return { won: false, row: (current ?? undefined) as never }
      }
      return { won: true, row: rows[0] as never }
    },

    /**
     * Guarded so two phones tapping "done" at the same moment can't advance the
     * cooldown twice. The filter pins the update to the state the caller saw.
     */
    async completeRecurring(id, profileId, seenLastCompletedAt) {
      const patch = {
        last_completed_at: new Date().toISOString(),
        last_completed_by: profileId,
        claimed_by: null,
        cooldown_notified_at: null,
      }

      let query = from('chores').update(patch).eq('id', id)
      query =
        seenLastCompletedAt === null
          ? query.is('last_completed_at', null)
          : query.eq('last_completed_at', seenLastCompletedAt)

      const { data, error } = await query.select()
      if (error) throw error
      const rows = (data ?? []) as Chore[]
      if (rows.length === 0) return { won: false }
      return { won: true, row: rows[0] }
    },

    subscribe(onChange: ChangeHandler, onResync: () => void) {
      const channel = sb.channel('household')

      for (const table of TABLES) {
        channel.on(
          'postgres_changes',
          { event: '*', schema: 'public', table },
          (payload) => {
            if (payload.eventType === 'DELETE') {
              // rowKey() rather than a column lookup: it is the one place that
              // knows every table's key shape, including the composite ones,
              // and the store addresses rows by exactly what it returns. This
              // only works because REPLICA IDENTITY FULL puts the whole old
              // row in the payload — with the default identity, `old` carries
              // the primary key alone and composite tables would come through
              // missing the half that isn't indexed.
              const id = rowKey(table, payload.old)
              if (id && !id.endsWith(':undefined')) {
                onChange({ table, type: 'delete', id })
              }
              return
            }
            onChange({
              table,
              type: payload.eventType === 'INSERT' ? 'insert' : 'update',
              row: payload.new as TableMap[typeof table],
            })
          },
        )
      }

      channel.subscribe((status) => {
        // Supabase does not replay events missed while disconnected, so every
        // (re)subscribe triggers a full refetch. That is the only thing that
        // actually guarantees the two phones converge.
        if (status === 'SUBSCRIBED') onResync()
      })

      const onVisible = () => {
        if (!document.hidden) onResync()
      }
      document.addEventListener('visibilitychange', onVisible)

      return () => {
        document.removeEventListener('visibilitychange', onVisible)
        void sb.removeChannel(channel)
      }
    },
  } satisfies DataAdapter as DataAdapter
}

export type { ClaimResult }
