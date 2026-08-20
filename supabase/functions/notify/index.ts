// Things — notification sender (Supabase Edge Function, Deno)
//
// The only genuinely server-side component in this app, and therefore the only
// place that can hold real secrets: the FCM service account and the VAPID
// private key never reach a client.
//
// Invoked two ways:
//   1. Database Webhooks on insert/update of the list tables (see
//      005_notifications.sql). Server-side triggering matters — notifying from
//      the client would send nothing when the acting person's app is closed.
//   2. A pg_cron sweep for chores coming off cooldown, which no row change can
//      announce because nothing is written when a cooldown expires.
//
// Deploy:  supabase functions deploy notify --no-verify-jwt
// Secrets: supabase secrets set VAPID_PUBLIC_KEY=... VAPID_PRIVATE_KEY=... \
//            VAPID_SUBJECT=mailto:you@example.com \
//            FCM_SERVICE_ACCOUNT='<the full service-account JSON>'

import { createClient } from 'jsr:@supabase/supabase-js@2'
import webpush from 'npm:web-push@3.6.7'
import { JWT } from 'npm:google-auth-library@9'
import { classify, type NotifyEvent, type Push, type WebhookBody } from './classify.ts'

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!
const SERVICE_ROLE = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
const VAPID_PUBLIC = Deno.env.get('VAPID_PUBLIC_KEY') ?? ''
const VAPID_PRIVATE = Deno.env.get('VAPID_PRIVATE_KEY') ?? ''
const VAPID_SUBJECT = Deno.env.get('VAPID_SUBJECT') ?? 'mailto:things@example.com'
const FCM_SERVICE_ACCOUNT = Deno.env.get('FCM_SERVICE_ACCOUNT') ?? ''

const db = createClient(SUPABASE_URL, SERVICE_ROLE, {
  auth: { persistSession: false },
})

if (VAPID_PUBLIC && VAPID_PRIVATE) {
  webpush.setVapidDetails(VAPID_SUBJECT, VAPID_PUBLIC, VAPID_PRIVATE)
}

// --- delivery ---------------------------------------------------------------

interface Subscription {
  id: string
  platform: 'fcm' | 'webpush'
  token: string | null
  endpoint: string | null
  p256dh: string | null
  auth: string | null
}

let cachedFcmToken: { value: string; expires: number } | null = null

async function fcmAccessToken(): Promise<{ token: string; projectId: string } | null> {
  if (!FCM_SERVICE_ACCOUNT) return null
  const creds = JSON.parse(FCM_SERVICE_ACCOUNT)

  if (cachedFcmToken && cachedFcmToken.expires > Date.now() + 60_000) {
    return { token: cachedFcmToken.value, projectId: creds.project_id }
  }

  const jwt = new JWT({
    email: creds.client_email,
    key: creds.private_key,
    scopes: ['https://www.googleapis.com/auth/firebase.messaging'],
  })
  const { access_token } = await jwt.authorize()
  if (!access_token) return null

  cachedFcmToken = { value: access_token, expires: Date.now() + 55 * 60_000 }
  return { token: access_token, projectId: creds.project_id }
}

async function sendFcm(sub: Subscription, push: Push): Promise<boolean> {
  const auth = await fcmAccessToken()
  if (!auth || !sub.token) return false

  const res = await fetch(
    `https://fcm.googleapis.com/v1/projects/${auth.projectId}/messages:send`,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${auth.token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        message: {
          token: sub.token,
          notification: { title: push.title, body: push.body },
          data: {
            tab: push.tab ?? '',
            itemId: push.itemId ?? '',
          },
          android: {
            priority: 'HIGH',
            notification: { tag: push.tag, color: '#7c5cff' },
          },
        },
      }),
    },
  )

  // 404/410 mean the app was uninstalled or the token rotated.
  if (res.status === 404 || res.status === 410) {
    await db.from('push_subscriptions').delete().eq('id', sub.id)
    return false
  }
  return res.ok
}

async function sendWebPush(sub: Subscription, push: Push): Promise<boolean> {
  if (!VAPID_PUBLIC || !VAPID_PRIVATE || !sub.endpoint) return false
  try {
    await webpush.sendNotification(
      {
        endpoint: sub.endpoint,
        keys: { p256dh: sub.p256dh!, auth: sub.auth! },
      },
      JSON.stringify(push),
    )
    return true
  } catch (err) {
    const status = (err as { statusCode?: number }).statusCode
    // The subscription is dead — usually the icon was deleted from the Home
    // Screen, which silently ends Web Push on iOS.
    if (status === 404 || status === 410) {
      await db.from('push_subscriptions').delete().eq('id', sub.id)
    }
    return false
  }
}

/**
 * Deliver one event to a set of people.
 *
 * Two separate outcomes, and they are deliberately not the same decision:
 *
 *   1. A row in `notifications`, which is what the launcher's notification
 *      centre lists and what its badges are counted from.
 *   2. A push to the phone.
 *
 * `app_notify_prefs.enabled` governs (1) and `.push` governs (2), because
 * "badge me but don't buzz me at work" is the setting people actually want and
 * one boolean cannot say it. The recorded row also matters on its own: a push
 * can be swiped away, arrive while the app is force-stopped, or never be
 * permitted at all, and then the fact that a chore came due is simply lost.
 */
async function deliver(
  profileIds: string[],
  event: NotifyEvent,
  push: Push,
  appId: string,
  actorId: string | null = null,
) {
  if (profileIds.length === 0) return { sent: 0, skipped: 0, recorded: 0 }

  const { data: settings } = await db
    .from('profile_settings')
    .select('profile_id, notify_events')
    .in('profile_id', profileIds)

  // Things' original per-event mutes still apply, so an existing "stop telling
  // me about edits" survives the move to per-app preferences.
  const allowed = profileIds.filter((id) => {
    const row = (settings ?? []).find((s) => s.profile_id === id)
    return (row?.notify_events ?? {})[event] !== false
  })

  const { data: appPrefs } = await db
    .from('app_notify_prefs')
    .select('profile_id, enabled, push, events')
    .eq('app_id', appId)
    .in('profile_id', allowed.length > 0 ? allowed : ['00000000-0000-0000-0000-000000000000'])

  // Absent rows mean "not configured", which is on — a member who has never
  // opened the alerts screen should still hear about things.
  const prefFor = (id: string) =>
    (appPrefs ?? []).find((p) => p.profile_id === id) ?? {
      enabled: true,
      push: true,
      events: {} as Record<string, boolean>,
    }

  const wanted = allowed.filter((id) => {
    const pref = prefFor(id)
    return pref.enabled !== false && (pref.events ?? {})[event] !== false
  })

  if (wanted.length === 0) {
    return { sent: 0, skipped: profileIds.length, recorded: 0 }
  }

  // Recorded first, so the centre is right even if delivery falls over.
  const { data: recorded } = await db
    .from('notifications')
    .insert(
      wanted.map((profileId) => ({
        profile_id: profileId,
        app_id: appId,
        event,
        title: push.title,
        body: push.body,
        deep_link: push.tab ? { tab: push.tab, id: push.itemId ?? null } : null,
        actor_id: actorId,
      })),
    )
    .select('id')

  const pushable = wanted.filter((id) => prefFor(id).push !== false)
  if (pushable.length === 0) {
    return { sent: 0, skipped: profileIds.length - wanted.length, recorded: recorded?.length ?? 0 }
  }

  const { data: subs } = await db
    .from('push_subscriptions')
    .select('id, platform, token, endpoint, p256dh, auth, profile_id')
    .in('profile_id', pushable)

  let sent = 0
  for (const sub of (subs ?? []) as (Subscription & { profile_id: string })[]) {
    const ok =
      sub.platform === 'fcm'
        ? await sendFcm(sub, push)
        : await sendWebPush(sub, push)
    if (ok) sent++
  }
  return {
    sent,
    skipped: profileIds.length - wanted.length,
    recorded: recorded?.length ?? 0,
  }
}

/**
 * Who should hear about this: everyone except whoever caused it.
 *
 * Filtered by app access as well as by identity. A guest who was never given
 * the Owe list must not be told a debt was added — the database already
 * refuses to show them the row, and a notification naming it would leak
 * exactly what the grant exists to withhold.
 */
async function recipients(
  actorId: string | null,
  explicitTarget: string | null,
  appId: string,
) {
  const { data: profiles } = await db
    .from('profiles')
    .select('id, role, is_active')

  const { data: grants } = await db
    .from('app_access')
    .select('profile_id, granted')
    .eq('app_id', appId)

  // Things is the one app everyone gets by default, matching the registry's
  // defaultForEveryone flag. Keeping the list here rather than importing it
  // avoids the function depending on the app bundle.
  const openToAll = appId === 'things'

  const eligible = (profiles ?? [])
    .filter((p) => p.is_active !== false)
    .filter((p) => {
      // A profile with no role predates the launcher migration — Avi and
      // Jackie — and is treated as an owner.
      if (p.role === undefined || p.role === null || p.role === 'owner') return true
      const grant = (grants ?? []).find((g) => g.profile_id === p.id)
      return grant ? grant.granted : openToAll
    })
    .map((p) => p.id)

  if (explicitTarget && explicitTarget !== actorId) {
    return eligible.includes(explicitTarget) ? [explicitTarget] : []
  }
  return eligible.filter((id) => id !== actorId)
}

// --- cooldown sweep ---------------------------------------------------------

/**
 * Chores whose cooldown has expired.
 *
 * This needs a scheduled sweep specifically because cooldown expiry writes no
 * row, so there is no change event to hook. `cooldown_notified_at` makes it
 * idempotent — a retry or an overlapping run cannot double-send.
 */
async function sweepCooldowns() {
  const { data: due } = await db
    .from('chores')
    .select('id, title, next_due_at, cooldown_notified_at')
    .eq('is_recurring', true)
    .lte('next_due_at', new Date().toISOString())
    .is('cooldown_notified_at', null)

  // Hoisted: this returned the same two ids on every iteration, so a sweep of
  // twenty chores made twenty identical round-trips before sending anything.
  const ids = await recipients(null, null, 'things')

  let total = 0
  for (const chore of due ?? []) {
    /*
      Claim the chore BEFORE delivering, not after.

      The guard used to be written once the pushes had completed, which meant
      the `is('cooldown_notified_at', null)` filter above still matched while a
      slow run was mid-flight. The cron fires every five minutes, so an
      overlapping run re-selected the same chores and sent every "Ready again"
      twice — the exact outcome this column exists to prevent. The conditional
      update makes the claim atomic: whoever flips it from null wins, and a
      second runner gets zero rows back and skips.
    */
    const { data: claimed } = await db
      .from('chores')
      .update({ cooldown_notified_at: new Date().toISOString() })
      .eq('id', chore.id)
      .is('cooldown_notified_at', null)
      .select('id')

    if (!claimed || claimed.length === 0) continue

    const { sent } = await deliver(
      ids,
      'cooldown_ready',
      {
        title: 'Ready again',
        body: chore.title,
        tab: 'chores',
        itemId: chore.id,
        tag: `cooldown-${chore.id}`,
      },
      'things',
    )
    total += sent
  }
  return total
}

// --- entrypoint -------------------------------------------------------------

/*
  This function started life as a purely server-side one — Database Webhooks
  and pg_cron call it, and neither is a browser, so it never needed CORS. Then
  Settings gained a "Test" button that invokes it from the app, and a browser
  POST with an Authorization header triggers a preflight OPTIONS first. With
  nothing answering that, the request failed before it ever ran: the test came
  back as an Edge Function error on both the APK (Capacitor is an https origin
  and enforces CORS like any other) and the web app, while ordinary
  notifications kept working fine because those still arrive server-to-server.
*/
const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

const reply = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, 'Content-Type': 'application/json' },
  })

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS })

  try {
    const body = await req.json().catch(() => ({}))

    if (body.mode === 'sweep_cooldowns') {
      const sent = await sweepCooldowns()
      return reply({ ok: true, mode: 'sweep', sent })
    }

    /*
      Deliberately sends to the requester rather than "the other person", and
      deliberately ignores notify_events preferences: this is the diagnostic
      you reach for when nothing arrives, so it has to exercise the stored
      subscription and the delivery service without any of the routing rules
      that could quietly filter it out and make a working pipe look broken.
    */
    if (body.mode === 'test') {
      const profileId = String(body.profile_id ?? '')
      if (!profileId) {
        return reply({ ok: false, error: 'profile_id required' }, 400)
      }

      const { data: subs } = await db
        .from('push_subscriptions')
        .select('id, platform, token, endpoint, p256dh, auth')
        .eq('profile_id', profileId)

      const push: Push = {
        title: 'Things',
        body: 'Test notification — this is working.',
        tab: 'todos',
        tag: `test-${Date.now()}`,
      }

      let sent = 0
      for (const sub of (subs ?? []) as Subscription[]) {
        const ok =
          sub.platform === 'fcm' ? await sendFcm(sub, push) : await sendWebPush(sub, push)
        if (ok) sent++
      }
      return reply({ ok: true, mode: 'test', devices: subs?.length ?? 0, sent })
    }

    const classified = classify(body as WebhookBody)
    if (!classified) return reply({ ok: true, skipped: 'no-op' })

    const ids = await recipients(classified.actorId, classified.targetId, classified.appId)
    const result = await deliver(
      ids,
      classified.event,
      classified.push,
      classified.appId,
      classified.actorId,
    )

    return reply({ ok: true, event: classified.event, app: classified.appId, ...result })
  } catch (err) {
    console.error(err)
    return reply({ ok: false, error: String(err) }, 500)
  }
})
