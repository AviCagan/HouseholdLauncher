// Things — voice add endpoint (Supabase Edge Function, Deno)
//
// One URL that adds an item to a list from plain text, so both assistants can
// drive the app without either of them needing to know it exists:
//
//   Siri     → Shortcuts app → "Get Contents of URL"
//   Gemini / Google Assistant → IFTTT applet, or an Android shortcut
//
// Neither platform offers a real third-party voice integration for something
// like this — Apple's App Intents need a native App Store app, and Google Home
// routines cannot make arbitrary HTTP calls. A plain authenticated endpoint is
// what both can actually reach, so that is what this is.
//
// Auth is a token in the URL, matched against household_settings.voice_token.
// Same posture as the calendar feed: unguessable, revocable from Settings, and
// scoped to exactly one capability — this can only add items.
//
// Deploy: supabase functions deploy add --no-verify-jwt

import { createClient } from 'jsr:@supabase/supabase-js@2'
import { parseCommand, type ListName } from './parse.ts'
import { parseWhen, parseRecurrence } from './when.ts'

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!
const SERVICE_ROLE = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!

const db = createClient(SUPABASE_URL, SERVICE_ROLE, {
  auth: { persistSession: false },
})

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
}

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, 'Content-Type': 'application/json' },
  })

/** Every list this can write to, and the columns each one needs. */
function rowFor(
  list: ListName,
  title: string,
  urgency: number,
  profileId: string | null,
  storeId: string | null,
  dueAt: string | null,
  repeat: ReturnType<typeof parseRecurrence>,
): Record<string, unknown> {
  const now = new Date().toISOString()
  const base = {
    // The list tables declare `id uuid primary key` with NO default — every
    // id in this app is minted client-side so an optimistic row and its
    // realtime echo share identity. That makes generating one here mandatory,
    // not a nicety: without it the insert fails outright.
    id: crypto.randomUUID(),
    title,
    created_by: profileId,
    sort_order: Date.now(),
    created_at: now,
    updated_at: now,
  }

  if (list === 'wishlist_items') {
    // Wishes have no urgency — they have a desire level, and 3 is the neutral
    // middle of that scale rather than a translation of anything said aloud.
    return { ...base, desire_level: 3, owner_id: profileId }
  }
  if (list === 'chores') {
    // A schedule is only ever set when one was actually said. The shapes here
    // are pinned by the recurrence_complete constraint: weekday mode carries
    // days and no count, every other mode carries a count and no days.
    return {
      ...base,
      urgency,
      claimed_by: null,
      is_done: false,
      is_recurring: repeat !== null,
      recurrence_count: repeat && repeat.unit !== 'weekdays' ? repeat.count : null,
      recurrence_unit: repeat?.unit ?? null,
      recurrence_days: repeat && repeat.unit === 'weekdays' ? repeat.days : null,
    }
  }
  if (list === 'todos') {
    return { ...base, urgency, claimed_by: null, is_done: false, due_at: dueAt }
  }
  return { ...base, urgency, claimed_by: null, is_done: false, store_id: storeId }
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS })

  try {
    const url = new URL(req.url)
    // Accept both shapes: a GET with query params is far easier to paste into
    // an IFTTT applet, a POST body is tidier in Shortcuts. Support both rather
    // than making someone fight whichever one their tool prefers.
    const body =
      req.method === 'POST'
        ? await req.json().catch(() => ({} as Record<string, unknown>))
        : {}

    const param = (name: string): string | null =>
      (body as Record<string, unknown>)[name] != null
        ? String((body as Record<string, unknown>)[name])
        : url.searchParams.get(name)

    const token = param('token')
    if (!token) return json({ ok: false, error: 'token required' }, 401)

    const { data: settings } = await db
      .from('household_settings')
      .select('voice_token')
      .eq('singleton', true)
      .maybeSingle()

    // Reject before comparing when the feature is off, so a null token in the
    // database can never be satisfied by a missing one in the request.
    if (!settings?.voice_token) {
      return json({ ok: false, error: 'voice adding is turned off' }, 403)
    }
    if (settings.voice_token !== token) {
      return json({ ok: false, error: 'bad token' }, 403)
    }

    const text = param('text') ?? param('q') ?? ''

    /*
      The household's real store names, so "milk at Costco" can be understood
      without guessing. Fetched up front rather than after parsing because the
      parser needs them to decide whether a trailing "at ..." names a shop or
      is just part of what was said — "meet Sam at noon" has to keep its words.
    */
    const { data: storeRows } = await db.from('stores').select('id, name, is_online')
    const stores = (storeRows ?? []) as { id: string; name: string; is_online: boolean }[]

    // Both people, so a spoken "...this is Avi" sign-off on a shared device or
    // shared IFTTT applet can be attributed without the shortcut being scoped
    // to one person's own link.
    const { data: profileRows } = await db.from('profiles').select('id, slug, display_name')
    const profiles = (profileRows ?? []) as { id: string; slug: string; display_name: string }[]

    const parsed = parseCommand(
      text,
      param('list'),
      param('store'),
      stores.map((s) => s.name),
      profiles.map((p) => ({ slug: p.slug, name: p.display_name })),
    )
    if (!parsed) return json({ ok: false, error: 'nothing to add' }, 400)

    const storeId = parsed.store
      ? (stores.find((s) => s.name === parsed.store)?.id ?? null)
      : null

    /*
      A store was named but isn't one of ours.

      Nothing is written in this case. The shortcut is expected to offer the
      returned list plus a "none of these" choice and call back with an
      explicit `store`, so the item lands where it was meant to rather than
      silently unsorted under a misheard name. `stores` is read fresh on every
      request, so a shop added since the shortcut was built shows up without
      the shortcut being touched.
    */
    if (parsed.list === 'shopping_items') {
      const named = param('store') ?? parsed.storeSpoken
      if (named && !parsed.store) {
        const options = stores.filter((st) => !st.is_online).map((st) => st.name)
        return json({
          ok: false,
          needs: 'store',
          heard: named,
          title: parsed.title,
          stores: options,
          spoken: options.length
            ? `${named} isn't a store yet. Did you mean ${options.join(', ')}?`
            : `${named} isn't a store yet, and there are none set up. Open Things to add one.`,
        })
      }
    }

    const dueAt =
      parsed.list === 'todos' ? parseWhen(param('due') ?? param('when') ?? '') : null
    const repeat =
      parsed.list === 'chores' ? parseRecurrence(param('every') ?? param('repeat') ?? '') : null

    // Attribute to a named person, so the activity log and the scoreboard stay
    // honest about who asked for it. An explicit `who` param — how a link
    // generated for one person in Settings works — always wins; a shared
    // link or device falls back to whatever name was spoken in the phrase
    // itself.
    const whoParam = param('who')
    const whoSlug = whoParam ? whoParam.trim().toLowerCase() : parsed.who
    const profileId = whoSlug ? (profiles.find((p) => p.slug === whoSlug)?.id ?? null) : null

    const { error } = await db
      .from(parsed.list)
      .insert(
        rowFor(parsed.list, parsed.title, parsed.urgency, profileId, storeId, dueAt, repeat),
      )

    if (error) return json({ ok: false, error: error.message }, 500)

    // Spoken back by Siri and read out by IFTTT, so it has to be a sentence a
    // person would want to hear rather than a status code.
    return json({
      ok: true,
      list: parsed.list,
      title: parsed.title,
      store: parsed.store,
      due_at: dueAt,
      spoken: parsed.store
        ? `Added ${parsed.title} to ${parsed.store}`
        : `Added ${parsed.title}`,
    })
  } catch (err) {
    console.error(err)
    return json({ ok: false, error: String(err) }, 500)
  }
})
