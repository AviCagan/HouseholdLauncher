// Household Launcher — Inventory's link to Google Drive (Supabase Edge Function, Deno)
//
// Every photo, manual and warranty in Inventory lives in Google Drive, in the
// household's "Warranties, manuals, extra parts" folder. The app never talks
// to Google itself: it asks this function, which checks who is asking and
// whether they have Inventory, then passes the request on to a small Apps
// Script running inside the Drive that owns the folder (see bridge.ts).
//
// The script's address and the secret it checks live in `inventory_drive`, a
// table no client can read. So a phone holds neither, and the only way to
// reach the folder is through here, as a member who has been given the app.
//
// Deployed with --no-verify-jwt like the household function: the CORS
// preflight carries no token, and every real request is authenticated below
// rather than by the platform.
//
// Deploy:  supabase functions deploy inventory --no-verify-jwt

import { createClient } from 'jsr:@supabase/supabase-js@2'
import { BRIDGE_OPS, bridgeSource, type BridgeOp } from './bridge.ts'

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!
const SERVICE_ROLE = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
const ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY')!

const db = createClient(SUPABASE_URL, SERVICE_ROLE, { auth: { persistSession: false } })

/*
  `apikey` must be allowed: the app sends it on every call, and a browser
  that is told no in the preflight never sends the request at all. (That is
  exactly how the household function was unreachable from browsers — see
  src/lib/functions-cors.test.ts.)
*/
const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...CORS, 'Content-Type': 'application/json' } })

/** A phone photo after the app has downscaled it is ~1 MB; a manual PDF a few. */
const MAX_PAYLOAD_CHARS = 28 * 1024 * 1024

/** Only a deployed Apps Script web app, nothing else, can be the bridge. */
const SCRIPT_URL = /^https:\/\/script\.google\.com\/macros\/s\/[A-Za-z0-9_-]+\/exec$/

// --- caller -----------------------------------------------------------------

interface Caller {
  owner: boolean
  allowed: boolean
}

/**
 * Who is asking, and may they use Inventory?
 *
 * Access is asked of the database as the caller, through `has_app()`, so this
 * answers exactly what row level security answers for their own reads — an
 * owner, a member granted Inventory, or the legacy shared session while that
 * is still switched on.
 */
async function identify(req: Request): Promise<Caller | null> {
  const header = req.headers.get('Authorization') ?? ''
  const token = header.startsWith('Bearer ') ? header.slice(7) : ''
  if (!token) return null

  const scoped = createClient(SUPABASE_URL, ANON_KEY, {
    global: { headers: { Authorization: `Bearer ${token}` } },
    auth: { persistSession: false },
  })
  const { data, error } = await scoped.auth.getUser()
  if (error || !data.user) return null

  const { data: allowed } = await scoped.rpc('has_app', { app: 'inventory' })

  const { data: profile } = await db
    .from('profiles')
    .select('role')
    .eq('auth_user_id', data.user.id)
    .eq('is_active', true)
    .maybeSingle()

  let owner = profile?.role === 'owner'
  if (!profile) {
    // The legacy shared session is an owner while the old PIN still works,
    // matching the household function.
    const { data: settings } = await db.from('household_settings').select('legacy_auth_enabled').limit(1).maybeSingle()
    owner = settings?.legacy_auth_enabled === true
  }

  return { owner, allowed: allowed === true }
}

// --- the bridge -------------------------------------------------------------

interface DriveRow {
  secret: string
  script_url: string | null
  account: string | null
  root_id: string | null
  root_url: string | null
  connected_at: string | null
}

async function driveRow(): Promise<DriveRow | null> {
  const { data } = await db.from('inventory_drive').select('*').eq('singleton', true).maybeSingle()
  return (data as DriveRow | null) ?? null
}

function newSecret(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(32))
  return btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

class BridgeError extends Error {}

/**
 * Ask the script to do one thing.
 *
 * An Apps Script web app answers a POST with a redirect to where its output
 * is waiting; fetch follows it as a GET, which is what the platform expects.
 * Anything that isn't JSON back means the script isn't deployed the way the
 * setup steps say — usually "Who has access" left on "Only myself", which
 * answers with Google's sign-in page.
 */
async function callBridge(url: string, secret: string, op: BridgeOp, args: Record<string, unknown>) {
  let res: Response
  try {
    res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...args, op, secret }),
      redirect: 'follow',
    })
  } catch {
    throw new BridgeError("Couldn't reach Google Drive")
  }
  const text = await res.text()
  let payload: Record<string, unknown>
  try {
    payload = JSON.parse(text)
  } catch {
    throw new BridgeError(
      "Google Drive's script didn't answer properly — check it's deployed as a Web app that Anyone can access",
    )
  }
  if (payload.error) throw new BridgeError(String(payload.error))
  return payload
}

// --- actions ----------------------------------------------------------------

async function status() {
  const row = await driveRow()
  return json({
    connected: !!row?.script_url,
    account: row?.account ?? null,
    root_url: row?.root_url ?? null,
    connected_at: row?.connected_at ?? null,
  })
}

/** The script to paste, with this household's secret already in it. */
async function setup() {
  let row = await driveRow()
  if (!row) {
    const { data, error } = await db
      .from('inventory_drive')
      .insert({ singleton: true, secret: newSecret() })
      .select('*')
      .single()
    if (error) return json({ error: error.message }, 500)
    row = data as DriveRow
  }
  return json({ script: bridgeSource(row.secret) })
}

async function connect(body: Record<string, unknown>) {
  const url = String(body.url ?? '').trim()
  if (!SCRIPT_URL.test(url)) {
    return json({ error: 'That isn\'t a Web app URL — it should start with https://script.google.com/macros/s/ and end in /exec' }, 400)
  }
  const row = await driveRow()
  if (!row) return json({ error: 'Get the script first, then deploy it' }, 400)

  // Prove it before saving it: a URL that can't answer would only fail later,
  // in the middle of someone adding a photo.
  const ping = await callBridge(url, row.secret, 'ping', {})
  const root = ping.root as { id: string; url: string } | undefined
  const { error } = await db
    .from('inventory_drive')
    .update({
      script_url: url,
      account: (ping.account as string) ?? null,
      root_id: root?.id ?? null,
      root_url: root?.url ?? null,
      connected_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    .eq('singleton', true)
  if (error) return json({ error: error.message }, 500)
  return status()
}

async function disconnect() {
  await db
    .from('inventory_drive')
    .update({ script_url: null, connected_at: null, updated_at: new Date().toISOString() })
    .eq('singleton', true)
  return status()
}

async function forward(op: BridgeOp, body: Record<string, unknown>) {
  const row = await driveRow()
  if (!row?.script_url) return json({ error: 'Google Drive isn\'t connected yet' }, 409)
  const { action: _action, op: _op, secret: _secret, ...args } = body
  return json(await callBridge(row.script_url, row.secret, op, args))
}

// --- entrypoint -------------------------------------------------------------

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS })
  if (req.method !== 'POST') return json({ error: 'POST only' }, 405)

  const raw = await req.text()
  if (raw.length > MAX_PAYLOAD_CHARS) return json({ error: 'That file is too big to send in one go' }, 413)
  let body: Record<string, unknown>
  try {
    body = JSON.parse(raw)
  } catch {
    return json({ error: 'Bad request' }, 400)
  }

  const caller = await identify(req)
  if (!caller) return json({ error: 'Sign in first' }, 401)
  if (!caller.allowed) return json({ error: "You don't have Inventory" }, 403)

  const action = String(body.action ?? '')
  try {
    switch (action) {
      case 'status':
        return await status()
      case 'setup':
        if (!caller.owner) return json({ error: 'Only Avi or Jackie can connect Drive' }, 403)
        return await setup()
      case 'connect':
        if (!caller.owner) return json({ error: 'Only Avi or Jackie can connect Drive' }, 403)
        return await connect(body)
      case 'disconnect':
        if (!caller.owner) return json({ error: 'Only Avi or Jackie can disconnect Drive' }, 403)
        return await disconnect()
      case 'drive': {
        const op = String(body.op ?? '') as BridgeOp
        // `ping` is setup's business, not something to forward on demand.
        if (!BRIDGE_OPS.includes(op) || op === 'ping') return json({ error: 'Unknown operation' }, 400)
        return await forward(op, body)
      }
      default:
        return json({ error: 'Unknown action' }, 400)
    }
  } catch (err) {
    if (err instanceof BridgeError) return json({ error: err.message }, 502)
    console.error('[inventory]', err)
    return json({ error: 'Something went wrong' }, 500)
  }
})
