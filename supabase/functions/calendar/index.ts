// Household — iCalendar feed for recurring chores and planned meals
// (Supabase Edge Function, Deno)
//
// Google Calendar can subscribe to a calendar "from URL". It fetches that URL
// on its own schedule with no headers you control, which decides the shape of
// this function:
//
//   * It must be deployed with `--no-verify-jwt`. Google cannot send an
//     Authorization header, so JWT verification would reject every poll.
//   * Authentication is therefore a random token in the query string, matched
//     against household_settings.calendar_token. Regenerating that column in
//     the app revokes the old URL immediately.
//   * It answers HEAD as well as GET — Google probes with HEAD first.
//
// The honest caveat, surfaced in the app too: Google refreshes subscribed
// feeds on its own cadence, typically somewhere between a few hours and a day.
// REFRESH-INTERVAL and X-PUBLISHED-TTL are hints, not commitments. For an
// instant event there is a per-chore "Add to Google Calendar" link in the app
// that creates the event directly.
//
// Deploy: supabase functions deploy calendar --no-verify-jwt

import { createClient } from 'jsr:@supabase/supabase-js@2'
import { buildCalendar, type ChoreRow, type MealRow } from './ics.ts'

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!
const SERVICE_ROLE = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!

const db = createClient(SUPABASE_URL, SERVICE_ROLE, {
  auth: { persistSession: false },
})

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'GET, HEAD, OPTIONS',
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS })
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    return new Response('Method not allowed', { status: 405, headers: CORS })
  }

  const key = new URL(req.url).searchParams.get('key')?.trim() ?? ''
  if (!key) return new Response('Not found', { status: 404, headers: CORS })

  const { data: settings } = await db
    .from('household_settings')
    .select('calendar_token, calendar_alarm_minutes')
    .eq('singleton', true)
    .maybeSingle()

  // A null token means sync is switched off, and must not match an empty or
  // missing key. 404 rather than 401, so a wrong URL reveals nothing.
  const token = settings?.calendar_token ?? null
  if (!token || token !== key) {
    return new Response('Not found', { status: 404, headers: CORS })
  }

  const { data: chores, error } = await db
    .from('chores')
    .select(
      'id, title, notes, is_recurring, recurrence_count, recurrence_unit, recurrence_days, next_due_at, created_at',
    )
    .eq('is_recurring', true)
    .eq('is_done', false)

  if (error) {
    return new Response(`Could not read chores: ${error.message}`, {
      status: 500,
      headers: CORS,
    })
  }

  // Planned meals from the last month on: enough that "what did we make last
  // Shabbat" is still on the calendar, without shipping the whole history on
  // every poll. Meals are optional — a household that never ran 017_meals.sql
  // simply has no table, and the feed carries on with the chores.
  const since = new Date(Date.now() - 31 * 86_400_000).toISOString().slice(0, 10)
  const { data: mealRows } = await db
    .from('meals')
    .select('id, name, emoji, planned_for, people, notes, courses')
    .not('planned_for', 'is', null)
    .gte('planned_for', since)
  const meals = (mealRows ?? []) as MealRow[]

  const dishIds = [...new Set(meals.flatMap((m) => (m.courses ?? []).map((c) => c.dish_id)).filter(Boolean))] as string[]
  const dishNames = new Map<string, string>()
  if (dishIds.length) {
    const { data: dishes } = await db.from('dishes').select('id, name').in('id', dishIds)
    for (const d of (dishes ?? []) as { id: string; name: string }[]) dishNames.set(d.id, d.name)
  }

  const body = buildCalendar(
    (chores ?? []) as ChoreRow[],
    settings?.calendar_alarm_minutes ?? 0,
    new Date(),
    meals,
    (id) => dishNames.get(id) ?? null,
  )

  const headers = {
    ...CORS,
    'Content-Type': 'text/calendar; charset=utf-8',
    'Content-Disposition': 'inline; filename="household.ics"',
    'Cache-Control': 'public, max-age=900',
  }

  // HEAD must carry the same headers and no body — Google probes with it
  // before subscribing.
  return new Response(req.method === 'HEAD' ? null : body, { headers })
})
