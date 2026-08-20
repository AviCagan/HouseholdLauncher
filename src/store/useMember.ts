import { useMemo } from 'react'
import { useData } from './useData'
import { useProfile } from './useProfile'
import { appKey, nowIso } from '@/data/adapter'
import { APPS, type AppDef } from '@/launcher/registry'
import { isNative } from '@/lib/platform'
import type { AppNotification, AppNotifyPref, MemberRole, Profile } from '@/data/types'

/**
 * Identity, permission and per-app preference, read from what the session
 * already loaded.
 *
 * Everything here is a *display* decision. The database answers the same
 * questions independently for every read and write (see `has_app()` in
 * 015_launcher.sql), so a member who forces `hasApp` true in a console gets a
 * screen that renders and then loads nothing — which is the intended outcome,
 * not a bug to defend against twice.
 */

export type Member = Profile & { role?: MemberRole; is_active?: boolean }

export function useCurrentMember(): Member | null {
  const id = useProfile((s) => s.profileId)
  const profiles = useData((s) => s.profiles)
  return (profiles.find((p) => p.id === id) as Member | undefined) ?? null
}

/** Everyone who can still sign in, owners first, then alphabetical. */
export function useMembers(): Member[] {
  const profiles = useData((s) => s.profiles) as Member[]
  return useMemo(
    () =>
      [...profiles]
        .filter((p) => p.is_active !== false)
        .sort((a, b) => {
          const rank = (m: Member) => (m.role === 'owner' ? 0 : m.role === 'member' ? 1 : 2)
          return rank(a) - rank(b) || a.display_name.localeCompare(b.display_name)
        }),
    [profiles],
  )
}

export const useIsOwner = (): boolean => useCurrentMember()?.role === 'owner'

/**
 * May this member open this app?
 *
 * Owners are unconditional, matching the server: they hand out grants, so a
 * missing row for an owner is a bookkeeping gap rather than a denial. A member
 * with no role at all is a pre-launcher profile that predates the migration —
 * treated as an owner, because the only two such rows are Avi and Jackie.
 */
export function useHasApp(appId: string): boolean {
  const member = useCurrentMember()
  const access = useData((s) => s.app_access)
  if (!member) return false
  if (member.role === undefined || member.role === 'owner') return true
  const row = access.find((a) => a.profile_id === member.id && a.app_id === appId)
  if (row) return row.granted
  return APPS.find((a) => a.id === appId)?.defaultForEveryone === true
}

/** Whether this app can do anything at all on the device it's running on. */
export const appSupportedHere = (app: AppDef): boolean =>
  app.platforms.includes(isNative() ? 'android' : 'web')

export interface LauncherTile {
  app: AppDef
  /** Unread notifications for this app, for the badge. */
  badge: number
  hidden: boolean
  supported: boolean
}

/**
 * The home grid, in order.
 *
 * Hidden apps are included rather than filtered out, so Settings can list every
 * app you have access to with its switch in the right position — the home
 * screen does the filtering itself.
 */
export function useTiles(): LauncherTile[] {
  const member = useCurrentMember()
  const access = useData((s) => s.app_access)
  const prefs = useData((s) => s.app_prefs)
  const notifications = useData((s) => s.notifications)

  return useMemo(() => {
    if (!member) return []

    const unrestricted = member.role === undefined || member.role === 'owner'
    const unread = new Map<string, number>()
    for (const n of notifications) {
      if (n.profile_id !== member.id || n.read_at) continue
      unread.set(n.app_id, (unread.get(n.app_id) ?? 0) + 1)
    }

    return APPS.filter((app) => {
      if (unrestricted) return true
      const row = access.find((a) => a.profile_id === member.id && a.app_id === app.id)
      return row ? row.granted : app.defaultForEveryone === true
    })
      .map((app) => {
        const pref = prefs.find((p) => p.profile_id === member.id && p.app_id === app.id)
        return {
          app,
          badge: unread.get(app.id) ?? 0,
          hidden: pref?.hidden ?? false,
          supported: appSupportedHere(app),
          sort: pref?.sort_order ?? APPS.indexOf(app),
        }
      })
      .sort((a, b) => a.sort - b.sort)
      .map(({ sort: _sort, ...tile }) => tile)
  }, [member, access, prefs, notifications])
}

// --- notifications ----------------------------------------------------------

/** This member's notification centre, newest first. */
export function useInbox(): AppNotification[] {
  const member = useCurrentMember()
  const notifications = useData((s) => s.notifications)
  return useMemo(() => {
    if (!member) return []
    return notifications
      .filter((n) => n.profile_id === member.id)
      .sort((a, b) => b.created_at.localeCompare(a.created_at))
  }, [member, notifications])
}

export function useUnreadCount(): number {
  const member = useCurrentMember()
  const notifications = useData((s) => s.notifications)
  if (!member) return 0
  return notifications.filter((n) => n.profile_id === member.id && !n.read_at).length
}

export const DEFAULT_NOTIFY_PREF = (profileId: string, appId: string): AppNotifyPref => ({
  profile_id: profileId,
  app_id: appId,
  enabled: true,
  push: true,
  sound: null,
  haptic: 'normal',
  events: {},
  updated_at: nowIso(),
})

export function useNotifyPref(appId: string): AppNotifyPref | null {
  const member = useCurrentMember()
  const prefs = useData((s) => s.app_notify_prefs)
  if (!member) return null
  return (
    prefs.find((p) => p.profile_id === member.id && p.app_id === appId) ??
    DEFAULT_NOTIFY_PREF(member.id, appId)
  )
}

// --- writes -----------------------------------------------------------------

/**
 * Upsert a preference row.
 *
 * Preference rows are created lazily — a member who never opened Settings has
 * none — so this cannot be a plain update: the first write for an app has
 * nothing to patch. Insert-then-fall-back-to-update rather than the reverse,
 * because the row is absent far more often than present and that ordering
 * makes the common case one request.
 */
type PrefTable = 'app_prefs' | 'app_notify_prefs'

async function upsertPref(
  table: PrefTable,
  row: { profile_id: string; app_id: string } & Record<string, unknown>,
): Promise<void> {
  const { adapter, applyChange } = useData.getState()
  const key = appKey(row.profile_id, row.app_id)
  const exists = (useData.getState()[table] as { profile_id: string; app_id: string }[]).some(
    (r) => appKey(r.profile_id, r.app_id) === key,
  )

  // Optimistic: the switch moves under the finger, not after a round trip.
  applyChange({ table, type: exists ? 'update' : 'insert', row } as never)

  try {
    if (exists) await adapter.update(table, key, row as never)
    else await adapter.insert(table, row as never)
  } catch (first) {
    try {
      // A duplicate here means another device inserted the same row between the
      // existence check and the write, and the update is the correct repair.
      await adapter.update(table, key, row as never)
    } catch (second) {
      /*
        Both failed. The realistic cause is the legacy-PIN bootstrap: these
        tables are keyed on current_profile_id(), which is null for the old
        shared session, so RLS refuses the write until personal codes are in
        use.

        Rolled back rather than left showing the optimistic value, because a
        switch that stays flipped and does nothing is worse than one that
        visibly springs back — and a toast is not raised for the same reason
        the app tolerates this at all: it is a transitional state, not a fault
        the person can act on.
      */
      useData.setState({
        [table]: (useData.getState()[table] as unknown[]).filter(
          (r) => appKey(
            (r as { profile_id: string }).profile_id,
            (r as { app_id: string }).app_id,
          ) !== key,
        ),
      } as never)
      console.warn('[prefs] not saved', first, second)
    }
  }
}

export async function setAppHidden(
  profileId: string,
  appId: string,
  hidden: boolean,
): Promise<void> {
  const existing = useData
    .getState()
    .app_prefs.find((p) => p.profile_id === profileId && p.app_id === appId)
  await upsertPref('app_prefs', {
    profile_id: profileId,
    app_id: appId,
    hidden,
    sort_order: existing?.sort_order ?? APPS.findIndex((a) => a.id === appId),
    updated_at: nowIso(),
  })
}

export async function setNotifyPref(
  profileId: string,
  appId: string,
  patch: Partial<AppNotifyPref>,
): Promise<void> {
  const current =
    useData
      .getState()
      .app_notify_prefs.find((p) => p.profile_id === profileId && p.app_id === appId) ??
    DEFAULT_NOTIFY_PREF(profileId, appId)

  await upsertPref('app_notify_prefs', {
    ...current,
    ...patch,
    updated_at: nowIso(),
  })
}

/**
 * Mark notifications read.
 *
 * Writes go one row at a time because the adapter addresses single rows, but
 * the local state is updated in one pass first — clearing a badge of 30 should
 * not repaint the grid 30 times, and the rows are already in memory.
 */
export async function markRead(ids: string[]): Promise<void> {
  if (ids.length === 0) return
  const stamp = nowIso()
  const wanted = new Set(ids)

  useData.setState({
    notifications: useData
      .getState()
      .notifications.map((n) => (wanted.has(n.id) ? { ...n, read_at: stamp } : n)),
  })

  const { adapter } = useData.getState()
  await Promise.allSettled(
    ids.map((id) => adapter.update('notifications', id, { read_at: stamp })),
  )
}

export async function markAppRead(profileId: string, appId: string): Promise<void> {
  const ids = useData
    .getState()
    .notifications.filter((n) => n.profile_id === profileId && n.app_id === appId && !n.read_at)
    .map((n) => n.id)
  await markRead(ids)
}

export async function clearNotifications(ids: string[]): Promise<void> {
  if (ids.length === 0) return
  const wanted = new Set(ids)
  useData.setState({
    notifications: useData.getState().notifications.filter((n) => !wanted.has(n.id)),
  })
  const { adapter } = useData.getState()
  await Promise.allSettled(ids.map((id) => adapter.remove('notifications', id)))
}
