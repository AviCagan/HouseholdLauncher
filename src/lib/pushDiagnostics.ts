import { supabase } from './supabase'
import { VAPID_PUBLIC_KEY, isConfigured } from './env'
import { isNative, isIOS, isStandalone, supportsWebPush } from './platform'

/**
 * Why notifications aren't arriving, answered from the device itself.
 *
 * Every previous attempt at this was a guess made from the other side of the
 * wire — the partial-index bug, then the already-granted-but-never-saved gap.
 * Both were real, both were invisible from here, and each round cost a build
 * and a day. The failure modes are all locally observable, so this reads them
 * out on the phone that's actually broken instead of inferring them.
 *
 * Each check reports one of:
 *   ok    — verified working
 *   bad   — definitely the problem, with what to do about it
 *   warn  — can't be sure, but worth knowing
 */

export type CheckStatus = 'ok' | 'warn' | 'bad'

export interface Check {
  label: string
  status: CheckStatus
  detail: string
  /** What the person holding the phone should actually do. */
  fix?: string
}

async function serviceWorkerCheck(): Promise<Check> {
  if (isNative()) {
    return {
      label: 'Delivery channel',
      status: 'ok',
      detail: 'Android push (FCM) — no service worker needed',
    }
  }
  if (!('serviceWorker' in navigator)) {
    return {
      label: 'Service worker',
      status: 'bad',
      detail: 'Not supported by this browser',
    }
  }
  const reg = await navigator.serviceWorker.getRegistration()
  if (!reg) {
    return {
      label: 'Service worker',
      status: 'bad',
      detail: 'Not registered',
      fix: 'Close the app fully and reopen it. If it keeps saying this, remove the Home Screen icon and add it again.',
    }
  }
  if (!reg.active) {
    return {
      label: 'Service worker',
      status: 'warn',
      detail: reg.installing ? 'Still installing' : 'Registered but not active yet',
      fix: 'Give it a few seconds and check again.',
    }
  }
  return { label: 'Service worker', status: 'ok', detail: 'Active' }
}

async function subscriptionCheck(): Promise<Check> {
  if (isNative()) {
    return {
      label: 'Device registration',
      status: 'ok',
      detail: 'Handled by the Android app',
    }
  }
  if (!supportsWebPush()) {
    return { label: 'Push subscription', status: 'bad', detail: 'Push not supported here' }
  }
  try {
    const reg = await navigator.serviceWorker.getRegistration()
    const sub = await reg?.pushManager.getSubscription()
    if (!sub) {
      return {
        label: 'Push subscription',
        status: 'bad',
        detail: 'This device has no subscription',
        fix: 'Tap "Turn on notifications" above.',
      }
    }
    return {
      label: 'Push subscription',
      status: 'ok',
      detail: new URL(sub.endpoint).hostname,
    }
  } catch (err) {
    return {
      label: 'Push subscription',
      status: 'bad',
      detail: err instanceof Error ? err.message : 'Could not read subscription',
    }
  }
}

/**
 * The one that actually caught the real bug: permission can be granted and a
 * subscription can exist while nothing was ever written to the database, and
 * from the phone's side everything looks fine.
 */
async function savedRowCheck(profileId: string | null): Promise<Check> {
  const sb = supabase()
  if (!sb || !profileId) {
    return {
      label: 'Saved on the server',
      status: 'warn',
      detail: 'Not signed in to the shared database',
    }
  }

  const { data, error } = await sb
    .from('push_subscriptions')
    .select('id, platform, last_seen_at')
    .eq('profile_id', profileId)

  if (error) {
    return {
      label: 'Saved on the server',
      status: 'bad',
      detail: error.message,
      fix: 'Re-paste supabase/setup.sql in the Supabase SQL editor.',
    }
  }
  if (!data || data.length === 0) {
    return {
      label: 'Saved on the server',
      status: 'bad',
      detail: 'No device registered for you',
      fix: 'Tap "Turn on notifications" above — this is the step that has been silently failing.',
    }
  }
  return {
    label: 'Saved on the server',
    status: 'ok',
    detail: `${data.length} device${data.length === 1 ? '' : 's'} registered`,
  }
}

export async function runPushDiagnostics(profileId: string | null): Promise<Check[]> {
  const checks: Check[] = []

  // iOS refuses Web Push outside a Home Screen install, and refuses it
  // silently — the single most common reason for "it just doesn't work".
  if (!isNative() && isIOS()) {
    checks.push(
      isStandalone()
        ? {
            label: 'Installed to Home Screen',
            status: 'ok',
            detail: 'Running as an installed app',
          }
        : {
            label: 'Installed to Home Screen',
            status: 'bad',
            detail: 'Open in a Safari tab',
            fix: 'Share → Add to Home Screen, then open Things from that icon. iOS never delivers notifications to a browser tab, and it does not warn you.',
          },
    )
  }

  const permission = isNative()
    ? 'granted'
    : 'Notification' in window
      ? Notification.permission
      : 'unsupported'

  checks.push({
    label: 'Permission',
    status: permission === 'granted' ? 'ok' : permission === 'denied' ? 'bad' : 'warn',
    detail: permission,
    fix:
      permission === 'denied'
        ? 'iOS cannot re-ask once refused. Delete the Home Screen icon, add it again, then tap "Turn on notifications".'
        : permission === 'default'
          ? 'Tap "Turn on notifications" above.'
          : undefined,
  })

  checks.push(await serviceWorkerCheck())
  checks.push(await subscriptionCheck())
  checks.push(await savedRowCheck(profileId))

  checks.push({
    label: 'Server keys',
    status: isConfigured() ? (isNative() || VAPID_PUBLIC_KEY ? 'ok' : 'bad') : 'bad',
    detail: !isConfigured()
      ? 'Supabase not configured'
      : isNative() || VAPID_PUBLIC_KEY
        ? 'Configured'
        : 'VAPID public key missing from this build',
  })

  // Not a failure by itself, but it silences everything downstream of here and
  // is invisible from inside the app, so it's worth saying out loud.
  if (!isNative()) {
    checks.push({
      label: 'Focus / Do Not Disturb',
      status: 'warn',
      detail: 'Cannot be checked from inside the app',
      fix: 'If every check above passes but nothing arrives, look at Focus modes and Settings → Notifications → Things on the phone itself.',
    })
  }

  return checks
}

/**
 * Sends a real notification through the real path — Edge Function, stored
 * subscription, delivery service. A test that skipped any of that would prove
 * nothing about the part that keeps breaking.
 */
export async function sendTestPush(profileId: string): Promise<{ sent: number }> {
  const sb = supabase()
  if (!sb) throw new Error('Not connected')
  const { data, error } = await sb.functions.invoke('notify', {
    body: { mode: 'test', profile_id: profileId },
  })
  if (error) throw new Error(error.message)
  return { sent: (data as { sent?: number })?.sent ?? 0 }
}
