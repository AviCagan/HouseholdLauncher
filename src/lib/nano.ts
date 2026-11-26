import { toast } from 'sonner'
import { supabase } from './supabase'
import { newId, nowIso } from '@/data/adapter'
import { useData } from '@/store/useData'
import type { NanoApproval, NanoAsk, NanoChange, NanoSettings, NanoStatus } from '@/data/types'

/**
 * The launcher's half of Nano.
 *
 * Nano herself runs on the brain and signs in like any member, with a code
 * (see the household function's `nano-code`). What she may read and write is
 * decided by the database (029_nano.sql), never here. This file is the
 * buttons people press: making her code, switching her off, approving what
 * needs Avi's code, undoing what she did, and asking her something.
 */

export type NanoResult<T> = { ok: true; data: T } | { ok: false; error: string }

const offline = { ok: false as const, error: 'This device is not connected to the household yet' }

/** Turn a Postgres refusal into something a person can read. */
function plain(message: string | undefined): string {
  if (!message) return 'Something went wrong'
  return message.replace(/^nano: /, '')
}

/**
 * The code-checking functions answer {ok, error} instead of failing, so a
 * wrong code is still counted (a failure would undo the count).
 */
function verdict(data: unknown, error: { message: string } | null): NanoResult<null> {
  if (error) return { ok: false, error: plain(error.message) }
  const answer = data as { ok?: boolean; error?: string } | null
  if (answer?.ok) return { ok: true, data: null }
  return { ok: false, error: answer?.error ?? 'Something went wrong' }
}

// --- the heartbeat ------------------------------------------------------------

/** How old the brain's heartbeat can be before the button says she's away. */
export const HEARTBEAT_STALE_MS = 2 * 60 * 1000
/** How long the button waits for her to touch a request before saying so. */
export const PICKUP_MS = 20 * 1000
/** A request left for her expires after this. The database enforces it too. */
export const ASK_TTL_MS = 12 * 60 * 60 * 1000

export function nanoOnline(status: NanoStatus | undefined, now = Date.now()): boolean {
  if (!status?.last_seen_at) return false
  return now - new Date(status.last_seen_at).getTime() < HEARTBEAT_STALE_MS
}

/**
 * Has she picked this request up?
 *
 * Any write to the row counts, as Nano's side asked: her first answer may be
 * "working on it", so a status change, an answer, or just a newer updated_at
 * all mean she has it.
 */
export function pickedUp(ask: Pick<NanoAsk, 'status' | 'answer' | 'created_at' | 'updated_at'>): boolean {
  if (ask.status !== 'waiting') return true
  if (ask.answer) return true
  return new Date(ask.updated_at).getTime() > new Date(ask.created_at).getTime() + 500
}

// --- asking ---------------------------------------------------------------------

export interface AskContext {
  appId: string
  screen: string | null
  item: { table: string; id: string; title: string | null } | null
}

/**
 * Hand Nano a request. The row goes in under the signed-in member's own
 * session, and the database writes who asked: the brain reads it from
 * there, so nobody can ask "as" someone else.
 */
export async function askNano(context: AskContext, body: string, profileId: string): Promise<NanoAsk | null> {
  const row: NanoAsk = {
    id: newId(),
    asked_by: profileId,
    app_id: context.appId,
    screen: context.screen,
    item_table: context.item?.table ?? null,
    item_id: context.item?.id ?? null,
    item_title: context.item?.title ?? null,
    body: body.trim(),
    status: 'waiting',
    answer: null,
    created_at: nowIso(),
    updated_at: nowIso(),
  }
  useData.getState().applyChange({ table: 'nano_asks', type: 'insert', row })
  try {
    await useData.getState().adapter.insert('nano_asks', row)
    return row
  } catch (err) {
    useData.getState().applyChange({ table: 'nano_asks', type: 'delete', id: row.id })
    toast.error(`Couldn't send that to Nano: ${plain((err as Error).message)}`)
    return null
  }
}

export async function cancelAsk(id: string): Promise<void> {
  const current = useData.getState().nano_asks.find((a) => a.id === id)
  if (!current || current.status !== 'waiting') return
  useData.getState().applyChange({ table: 'nano_asks', type: 'update', row: { ...current, status: 'cancelled' } })
  try {
    await useData.getState().adapter.update('nano_asks', id, { status: 'cancelled' })
  } catch {
    useData.getState().applyChange({ table: 'nano_asks', type: 'update', row: current })
  }
}

// --- settings (owners) -------------------------------------------------------------

export async function updateNanoSettings(patch: Partial<Pick<NanoSettings, 'medschool_writes' | 'whatsapp'>>, profileId: string | null) {
  const current = useData.getState().nano_settings[0]
  try {
    if (current) {
      await useData.getState().adapter.update('nano_settings', 'singleton', { ...patch, updated_by: profileId })
    } else {
      await useData.getState().adapter.insert('nano_settings', {
        singleton: true,
        medschool_writes: false,
        whatsapp: null,
        ...patch,
        updated_by: profileId,
        updated_at: nowIso(),
      })
    }
    return true
  } catch (err) {
    toast.error(plain((err as Error).message))
    return false
  }
}

/** Her change log, newest first. Owners see all of it; others what was done for them. */
export async function listNanoChanges(limit = 60): Promise<NanoResult<NanoChange[]>> {
  const sb = supabase()
  if (!sb) return offline
  const { data, error } = await sb.from('nano_changes').select('*').order('at', { ascending: false }).limit(limit)
  if (error) return { ok: false, error: plain(error.message) }
  return { ok: true, data: (data ?? []) as NanoChange[] }
}

/** Put one change back. Refused if someone has changed the row since. */
export async function undoNanoChange(id: string): Promise<NanoResult<null>> {
  const sb = supabase()
  if (!sb) return offline
  const { error } = await sb.rpc('nano_undo', { change_id: id })
  if (error) return { ok: false, error: plain(error.message) }
  return { ok: true, data: null }
}

export async function listApprovals(): Promise<NanoResult<NanoApproval[]>> {
  const sb = supabase()
  if (!sb) return offline
  const { data, error } = await sb
    .from('nano_approvals')
    .select('id, created_at, kind, summary, table_name, max_rows, target_profile, status, approved_at, used_at')
    .eq('status', 'waiting')
    .order('created_at', { ascending: false })
  if (error) return { ok: false, error: plain(error.message) }
  return { ok: true, data: (data ?? []) as NanoApproval[] }
}

/** Approve one waiting request with the code from Avi's authenticator. */
export async function approveWithCode(approvalId: string, code: string): Promise<NanoResult<null>> {
  const sb = supabase()
  if (!sb) return offline
  const { data, error } = await sb.rpc('nano_approve', { approval_id: approvalId, code: code.replace(/\s+/g, '') })
  return verdict(data, error)
}

export async function refuseApproval(approvalId: string): Promise<NanoResult<null>> {
  const sb = supabase()
  if (!sb) return offline
  const { error } = await sb.from('nano_approvals').update({ status: 'cancelled' }).eq('id', approvalId)
  if (error) return { ok: false, error: plain(error.message) }
  return { ok: true, data: null }
}

// --- the authenticator (Settings › General › Security) -----------------------------

/** When the authenticator key was set, or null if it hasn't been. */
export async function authenticatorSetAt(): Promise<NanoResult<string | null>> {
  const sb = supabase()
  if (!sb) return offline
  const { data, error } = await sb.rpc('nano_authenticator_set_at')
  if (error) return { ok: false, error: plain(error.message) }
  return { ok: true, data: (data as string | null) ?? null }
}

/**
 * Store the authenticator's setup key. Replacing one that is already set
 * needs a current code from the old one, so a borrowed phone can't swap it.
 */
export async function setAuthenticator(setupKey: string, currentCode: string): Promise<NanoResult<null>> {
  const sb = supabase()
  if (!sb) return offline
  const { data, error } = await sb.rpc('nano_set_authenticator', {
    setup_key: setupKey.replace(/\s+/g, '').toUpperCase(),
    current_code: currentCode.replace(/\s+/g, '') || null,
  })
  return verdict(data, error)
}
