import { toast } from 'sonner'
import { useData } from '@/store/useData'
import { useProfile } from '@/store/useProfile'
import { newId, nowIso, type TableMap } from '@/data/adapter'
import { fire } from '@/lib/haptics'
import type { MkEventRow, MkPartner, MkReminder, MkShared } from '@/data/types'
import { diffQueue, type QueueDiff, type Stored } from './model'
import type { HisSnapshot } from './engine'

/**
 * Every write the calendar makes.
 *
 * Raw events only, and never a delete: a mistake is voided (voided_at) and
 * the calendar recomputes without it. Optimistic like the rest of the
 * launcher — on screen first, put back with a message if the write fails.
 * The database decides who may write what (027); nothing here is a guard.
 */

type MkTable = 'mk_shared' | 'mk_events' | 'mk_settings' | 'mk_trips' | 'mk_memos' | 'mk_contacts' | 'mk_source_notes' | 'mk_partner' | 'mk_reminders'

const me = (): string | null => useProfile.getState().profileId
const adapter = () => useData.getState().adapter
const rows = <T extends MkTable>(t: T) => useData.getState()[t] as TableMap[T][]

function put<T extends MkTable>(t: T, row: TableMap[T]) {
  const list = rows(t)
  const id = (row as { id: string }).id
  const next = list.some((r) => (r as { id: string }).id === id) ? list.map((r) => ((r as { id: string }).id === id ? row : r)) : [...list, row]
  useData.setState({ [t]: next } as never)
}

function drop(t: MkTable, id: string) {
  useData.setState({ [t]: rows(t).filter((r) => (r as { id: string }).id !== id) } as never)
}

function failed(message: string, err: unknown) {
  fire('error')
  toast.error(message)
  console.error('[calendar]', err)
}

async function insert<T extends MkTable>(t: T, row: TableMap[T], message = "Couldn't save that"): Promise<boolean> {
  put(t, row)
  try {
    await adapter().insert(t, row)
    return true
  } catch (err) {
    drop(t, (row as { id: string }).id)
    failed(message, err)
    return false
  }
}

async function patch<T extends MkTable>(t: T, id: string, change: Partial<TableMap[T]>, message = "Couldn't save that"): Promise<boolean> {
  const before = rows(t).find((r) => (r as { id: string }).id === id)
  if (before) put(t, { ...before, ...change, updated_at: nowIso() } as TableMap[T])
  try {
    await adapter().update(t, id, change)
    return true
  } catch (err) {
    if (before) put(t, before)
    failed(message, err)
    return false
  }
}

/** Insert, or update if the row is already there (a stable id written twice). */
async function upsert<T extends MkTable>(t: T, row: TableMap[T]): Promise<void> {
  const id = (row as { id: string }).id
  if (rows(t).some((r) => (r as { id: string }).id === id)) {
    const { id: _id, ...rest } = row as unknown as Record<string, unknown>
    await patch(t, id, rest as Partial<TableMap[T]>)
  } else {
    await insert(t, row)
  }
}

// --- her events -----------------------------------------------------------------

export async function logEvent(
  kind: MkEventRow['kind'],
  at: number,
  extra: { result?: MkEventRow['result']; data?: Record<string, unknown> } = {},
): Promise<string | null> {
  const owner = me()
  if (!owner) return null
  const row: MkEventRow = {
    id: newId(),
    owner_id: owner,
    kind,
    at: new Date(at).toISOString(),
    result: extra.result ?? null,
    data: extra.data ?? {},
    voided_at: null,
    created_at: nowIso(),
    updated_at: nowIso(),
  }
  fire('success')
  return (await insert('mk_events', row)) ? row.id : null
}

/** A mistaken entry: kept, marked void, and the calendar recomputes without it. */
export async function voidEvent(id: string): Promise<void> {
  fire('delete')
  const ok = await patch('mk_events', id, { voided_at: nowIso() })
  if (!ok) return
  toast('Entry voided', {
    id: 'mk-undo',
    action: { label: 'Undo', onClick: () => void patch('mk_events', id, { voided_at: null }) },
  })
}

/** Her rav's answer to one flag. */
export function enterRuling(flag: string, outcome: string, extra: { date?: string; note?: string } = {}) {
  return logEvent('ruling', Date.now(), { data: { flag, outcome, ...extra } })
}

/** Undo a ruling: void every ruling event for that flag. */
export async function withdrawRuling(flag: string) {
  for (const e of rows('mk_events')) {
    if (e.kind === 'ruling' && e.voided_at === null && (e.data as { flag?: string }).flag === flag) await voidEvent(e.id)
  }
}

// --- settings: a new version per change ---------------------------------------------

export async function saveSettings(stored: Stored, effectiveFrom = Date.now()): Promise<boolean> {
  const owner = me()
  if (!owner) return false
  return insert('mk_settings', {
    id: newId(),
    owner_id: owner,
    settings: stored as unknown as Record<string, unknown>,
    effective_from: new Date(effectiveFrom).toISOString(),
    created_at: nowIso(),
    updated_at: nowIso(),
  })
}

// --- the calendar row: partner and sharing ---------------------------------------------

export async function startCalendar(partnerId: string | null): Promise<boolean> {
  const owner = me()
  if (!owner) return false
  if (rows('mk_shared').some((r) => r.id === owner)) return setPartner(partnerId)
  return insert('mk_shared', {
    id: owner,
    partner_id: partnerId,
    snapshot: {},
    share_details: false,
    published_at: null,
    updated_at: nowIso(),
  })
}

export const setPartner = (partnerId: string | null) => {
  const owner = me()
  return owner ? patch('mk_shared', owner, { partner_id: partnerId }, "Couldn't change that — they need the app turned on first") : Promise.resolve(false)
}

export const setShareDetails = (on: boolean) => {
  const owner = me()
  return owner ? patch('mk_shared', owner, { share_details: on }) : Promise.resolve(false)
}

// --- trips, memos, contacts, source notes ---------------------------------------------

export function addTrip(t: { name: string; lat: number; lng: number; tz: string; from_day: string; to_day: string }) {
  const owner = me()
  if (!owner) return Promise.resolve(false)
  return insert('mk_trips', { id: newId(), owner_id: owner, ...t, voided_at: null, created_at: nowIso(), updated_at: nowIso() })
}
export const voidTrip = (id: string) => patch('mk_trips', id, { voided_at: nowIso() })

export function addMemo(day: string, body: string) {
  const owner = me()
  if (!owner) return Promise.resolve(false)
  return insert('mk_memos', { id: newId(), owner_id: owner, day, body, voided_at: null, created_at: nowIso(), updated_at: nowIso() })
}
export const editMemo = (id: string, body: string) => patch('mk_memos', id, { body })
export const voidMemo = (id: string) => patch('mk_memos', id, { voided_at: nowIso() })

export function addContact(c: { name: string; phone: string | null; note: string | null }) {
  const owner = me()
  if (!owner) return Promise.resolve(false)
  return insert('mk_contacts', { id: newId(), owner_id: owner, ...c, sort: Date.now(), voided_at: null, created_at: nowIso(), updated_at: nowIso() })
}
export const editContact = (id: string, c: { name: string; phone: string | null; note: string | null }) => patch('mk_contacts', id, c)
export const voidContact = (id: string) => patch('mk_contacts', id, { voided_at: nowIso() })

export function saveSourceNote(ruleId: string, idx: number, change: { ref: string | null; checked: boolean | null }) {
  const owner = me()
  if (!owner) return Promise.resolve()
  return upsert('mk_source_notes', {
    id: `${owner}:${ruleId}:${idx}`,
    owner_id: owner,
    rule_id: ruleId,
    idx,
    ref: change.ref,
    checked: change.checked,
    created_at: nowIso(),
    updated_at: nowIso(),
  })
}

// --- his inputs ---------------------------------------------------------------------------

export function savePartner(owner: string, change: Partial<Pick<MkPartner, 'away' | 'shiva' | 'prefs'>>) {
  const id = me()
  if (!id) return Promise.resolve()
  const existing = rows('mk_partner').find((r) => r.id === id)
  return upsert('mk_partner', {
    id,
    owner_id: owner,
    away: existing?.away ?? [],
    shiva: existing?.shiva ?? [],
    prefs: existing?.prefs ?? {},
    ...change,
    updated_at: nowIso(),
  })
}

// --- publishing: his view and the reminder queue ---------------------------------------------

/** The snapshot without its timestamp, for "has anything changed?". */
const content = (s: unknown) => {
  if (!s || typeof s !== 'object') return ''
  const { publishedAt: _p, ...rest } = s as HisSnapshot
  return JSON.stringify(rest)
}

/**
 * After a recompute: his view, if it changed, and the reminder queue brought
 * in line. Quiet on failure — the next recompute tries again — because this
 * runs on its own, not from a tap.
 */
export async function publish(snapshot: HisSnapshot, wanted: QueueDiff['insert'], now: number): Promise<void> {
  const owner = me()
  if (!owner) return
  const row = rows('mk_shared').find((r) => r.id === owner) as MkShared | undefined
  if (!row) return
  try {
    if (content(row.snapshot) !== content(snapshot)) {
      const change = { snapshot, published_at: new Date(now).toISOString() }
      put('mk_shared', { ...row, ...change })
      await adapter().update('mk_shared', owner, change)
    }
    const diff = diffQueue(wanted, rows('mk_reminders') as MkReminder[], owner, now)
    for (const r of diff.insert) {
      const full: MkReminder = { ...r, created_at: nowIso(), updated_at: nowIso() }
      put('mk_reminders', full)
      try {
        await adapter().insert('mk_reminders', full)
      } catch (err) {
        // Already there (the other copy of this list hadn't caught up): update it instead.
        if ((err as { code?: string })?.code !== '23505') throw err
        const { id, ...rest } = r
        await adapter().update('mk_reminders', id, rest)
      }
    }
    for (const u of diff.update) {
      const before = rows('mk_reminders').find((r) => r.id === u.id)
      if (before) put('mk_reminders', { ...before, ...u.patch })
      await adapter().update('mk_reminders', u.id, u.patch)
    }
  } catch (err) {
    console.error('[calendar] publish', err)
  }
}
