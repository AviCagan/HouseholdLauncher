// Household Launcher — identity and access (Supabase Edge Function, Deno)
//
// Everything that mints a session or changes who may do what lives here,
// because all of it needs the service-role key and none of it can be trusted
// to a client. The browser's job is to collect a code and show the result.
//
// Deployed with --no-verify-jwt on purpose: `redeem` is called by someone who
// has no session yet, which is the entire point of it. Every other action
// authenticates the caller itself, below — do not assume the platform did it.
//
// Deploy:  supabase functions deploy household --no-verify-jwt
// Secrets: supabase secrets set HOUSEHOLD_CODE_PEPPER='<a long random string>'

import { createClient } from 'jsr:@supabase/supabase-js@2'

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!
const SERVICE_ROLE = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
const ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY')!

/*
  The pepper is what makes a stolen `member_credentials` dump useless.

  Household codes are short and human-chosen, so a plain sha256 of one falls to
  a wordlist in seconds. Mixing in a secret the database has never seen means
  an attacker needs this function's environment as well as the table, and
  getting the environment means they already have the service-role key and
  don't need the codes.

  There is a default so a half-configured deploy still runs rather than 500ing
  on every sign-in, but it is a known constant and therefore no protection —
  set the real secret.
*/
const PEPPER = Deno.env.get('HOUSEHOLD_CODE_PEPPER') ?? 'household-launcher-unset-pepper'

const db = createClient(SUPABASE_URL, SERVICE_ROLE, {
  auth: { persistSession: false },
})

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, 'Content-Type': 'application/json' },
  })

// --- codes ------------------------------------------------------------------

/**
 * Fold a typed code to its canonical form.
 *
 * Someone reading a code off a note types "sunset 42", "Sunset-42" or
 * "SUNSET42" and means the same thing every time, so none of those may be a
 * wrong code. Normalising before hashing is what allows that without storing
 * the code itself to compare loosely against.
 */
function normaliseCode(raw: string): string {
  return raw.toUpperCase().replace(/[^A-Z0-9]/g, '')
}

async function hashCode(raw: string): Promise<string> {
  const data = new TextEncoder().encode(`${PEPPER}:${normaliseCode(raw)}`)
  const digest = await crypto.subtle.digest('SHA-256', data)
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('')
}

/** Codes are generated, not typed, when nobody supplies one. */
function randomCode(): string {
  // No I/O/0/1: these are read off a screen and typed on a phone, and every
  // one of them gets confused for another character by somebody.
  const alphabet = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'
  const bytes = crypto.getRandomValues(new Uint8Array(8))
  return [...bytes].map((b) => alphabet[b % alphabet.length]).join('')
}

function randomPassword(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(32))
  return btoa(String.fromCharCode(...bytes))
}

// --- caller identity --------------------------------------------------------

interface Caller {
  /** The member row this session belongs to, or null for a legacy session. */
  profile: { id: string; role: string; display_name: string } | null
  /** True for the shared pre-launcher account, while the hatch is still open. */
  legacy: boolean
}

/**
 * Work out who is calling, from the Authorization header they sent.
 *
 * The legacy branch is the bootstrap path and it is deliberately narrow: it
 * only exists while `household_settings.legacy_auth_enabled` is true, and the
 * settings screen turns that off once real codes are handed out. Without it
 * there is no first move — assigning the first code needs an owner session,
 * and getting an owner session needs a code that only that call can create.
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

  const { data: profile } = await db
    .from('profiles')
    .select('id, role, display_name')
    .eq('auth_user_id', data.user.id)
    .eq('is_active', true)
    .maybeSingle()

  if (profile) return { profile, legacy: false }

  const { data: settings } = await db
    .from('household_settings')
    .select('legacy_auth_enabled')
    .limit(1)
    .maybeSingle()

  if (settings?.legacy_auth_enabled) return { profile: null, legacy: true }
  return null
}

const isOwner = (caller: Caller) => caller.legacy || caller.profile?.role === 'owner'

// --- provisioning -----------------------------------------------------------

/**
 * Give a profile an auth user and a code, creating either if missing.
 *
 * Idempotent by necessity: rotating a code must not orphan the auth user, or
 * every rotation would strand the member's `auth_user_id` and silently break
 * every row that references them. So the auth user is created once and only
 * its password is rewritten afterwards.
 */
async function provision(profileId: string, code: string): Promise<{ code: string } | { error: string }> {
  const { data: profile } = await db
    .from('profiles')
    .select('id, auth_user_id')
    .eq('id', profileId)
    .maybeSingle()
  if (!profile) return { error: 'No such member' }

  const codeHash = await hashCode(code)

  // Reject a code already in use — two members sharing one code would make
  // sign-in ambiguous, and the lookup would hand the session to whichever row
  // Postgres returned first.
  const { data: clash } = await db
    .from('member_credentials')
    .select('profile_id')
    .eq('code_hash', codeHash)
    .maybeSingle()
  if (clash && clash.profile_id !== profileId) {
    return { error: 'That code is already taken by someone else' }
  }

  const password = randomPassword()
  let authUserId = profile.auth_user_id as string | null
  const email = `member-${profileId}@household.local`

  if (authUserId) {
    const { error } = await db.auth.admin.updateUserById(authUserId, { password })
    if (error) return { error: error.message }
  } else {
    const { data: created, error } = await db.auth.admin.createUser({
      email,
      password,
      // No mailbox exists behind this address and nobody will ever click a
      // link in it — the code is the credential. Leaving it unconfirmed just
      // makes sign-in fail.
      email_confirm: true,
    })
    if (error || !created.user) return { error: error?.message ?? 'Could not create the account' }
    authUserId = created.user.id

    const { error: linkError } = await db
      .from('profiles')
      .update({ auth_user_id: authUserId })
      .eq('id', profileId)
    if (linkError) return { error: linkError.message }
  }

  const { error: credError } = await db.from('member_credentials').upsert(
    {
      profile_id: profileId,
      code_hash: codeHash,
      auth_email: email,
      auth_password: password,
      updated_at: new Date().toISOString(),
    },
    { onConflict: 'profile_id' },
  )
  if (credError) return { error: credError.message }

  return { code: normaliseCode(code) }
}

// --- actions ----------------------------------------------------------------

async function redeem(code: string) {
  if (!code?.trim()) return json({ error: 'Enter your household code' }, 400)

  const { data: cred } = await db
    .from('member_credentials')
    .select('profile_id, auth_email, auth_password')
    .eq('code_hash', await hashCode(code))
    .maybeSingle()

  // One message for "no such code" and for "that member is switched off", so
  // the response cannot be used to enumerate which codes are real.
  const denied = () => json({ error: 'That code did not work' }, 401)
  if (!cred) return denied()

  const { data: profile } = await db
    .from('profiles')
    .select('id, slug, display_name, avatar_emoji, avatar_url, color_hex, role, is_active')
    .eq('id', cred.profile_id)
    .maybeSingle()
  if (!profile || !profile.is_active) return denied()

  // Sign in on a throwaway anon client: `db` holds the service role, and a
  // service-role client does not mint user sessions.
  const auth = createClient(SUPABASE_URL, ANON_KEY, { auth: { persistSession: false } })
  const { data: session, error } = await auth.auth.signInWithPassword({
    email: cred.auth_email,
    password: cred.auth_password,
  })
  if (error || !session.session) return json({ error: 'Could not start your session' }, 500)

  return json({
    session: {
      access_token: session.session.access_token,
      refresh_token: session.session.refresh_token,
    },
    profile,
  })
}

async function createMember(caller: Caller, body: Record<string, unknown>) {
  if (!isOwner(caller)) return json({ error: 'Only Avi or Jackie can add people' }, 403)

  const name = String(body.display_name ?? '').trim()
  if (!name) return json({ error: 'Give them a name' }, 400)

  const role = String(body.role ?? 'guest')
  if (!['owner', 'member', 'guest'].includes(role)) {
    return json({ error: 'Unknown role' }, 400)
  }

  const id = crypto.randomUUID()
  // Slug is a handle, not a display name, and it is UNIQUE — so it gets the
  // id's tail appended rather than risking a collision with an existing member
  // who happens to share a first name.
  const slug = `${name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'member'}-${id.slice(0, 4)}`

  const { error } = await db.from('profiles').insert({
    id,
    slug,
    display_name: name,
    avatar_emoji: String(body.avatar_emoji ?? '🙂'),
    color_hex: String(body.color_hex ?? '#7c5cff'),
    role,
    is_active: true,
  })
  if (error) return json({ error: error.message }, 400)

  const code = String(body.code ?? '').trim() || randomCode()
  const result = await provision(id, code)
  if ('error' in result) {
    // Roll the profile back: a member who exists but can never sign in is a
    // dead row that still shows up in every roster and picker.
    await db.from('profiles').delete().eq('id', id)
    return json({ error: result.error }, 400)
  }

  // Grant whatever the caller ticked at creation time.
  const apps = Array.isArray(body.apps) ? (body.apps as string[]) : []
  if (apps.length > 0) {
    await db.from('app_access').upsert(
      apps.map((appId) => ({
        profile_id: id,
        app_id: appId,
        granted: true,
        granted_by: caller.profile?.id ?? null,
      })),
      { onConflict: 'profile_id,app_id' },
    )
  }

  return json({ profile_id: id, code: result.code })
}

async function setCode(caller: Caller, body: Record<string, unknown>) {
  const target = String(body.profile_id ?? '')
  if (!target) return json({ error: 'Which member?' }, 400)

  // Changing your own code is a general-settings action available to everyone;
  // changing somebody else's is an owner action.
  const self = caller.profile?.id === target
  if (!self && !isOwner(caller)) return json({ error: 'Not allowed' }, 403)

  const code = String(body.code ?? '').trim() || randomCode()
  if (normaliseCode(code).length < 4) {
    return json({ error: 'Codes need at least 4 letters or numbers' }, 400)
  }

  const result = await provision(target, code)
  if ('error' in result) return json({ error: result.error }, 400)
  return json({ code: result.code })
}

async function updateMember(caller: Caller, body: Record<string, unknown>) {
  const target = String(body.profile_id ?? '')
  if (!target) return json({ error: 'Which member?' }, 400)

  const self = caller.profile?.id === target
  const patch: Record<string, unknown> = {}

  // Anyone may restyle themselves; only owners may touch anyone else, and
  // role/active are owner-only even on your own row so the last owner cannot
  // demote themselves out of the household by accident.
  for (const field of ['display_name', 'avatar_emoji', 'avatar_url', 'color_hex']) {
    if (field in body) patch[field] = body[field]
  }
  if (!self && !isOwner(caller)) return json({ error: 'Not allowed' }, 403)

  if ('role' in body || 'is_active' in body) {
    if (!isOwner(caller)) return json({ error: 'Not allowed' }, 403)
    if ('role' in body) patch.role = body.role
    if ('is_active' in body) patch.is_active = body.is_active

    // Refuse to remove the last way into the household. Demoting or switching
    // off the only remaining owner locks everyone out of people management
    // permanently, and the fix would be a hand-written SQL statement.
    const losingOwner =
      (patch.role !== undefined && patch.role !== 'owner') || patch.is_active === false
    if (losingOwner) {
      const { count } = await db
        .from('profiles')
        .select('id', { count: 'exact', head: true })
        .eq('role', 'owner')
        .eq('is_active', true)
        .neq('id', target)
      if ((count ?? 0) === 0) {
        return json({ error: 'Someone has to stay an owner' }, 400)
      }
    }
  }

  if (Object.keys(patch).length === 0) return json({ ok: true })

  const { error } = await db.from('profiles').update(patch).eq('id', target)
  if (error) return json({ error: error.message }, 400)

  // A deactivated member keeps their history but must lose their session.
  // Revoking refresh tokens is what actually ends it — clearing the code alone
  // leaves an already-signed-in phone working until its access token expires.
  if (patch.is_active === false) {
    const { data: profile } = await db
      .from('profiles')
      .select('auth_user_id')
      .eq('id', target)
      .maybeSingle()
    if (profile?.auth_user_id) {
      await db.auth.admin.signOut(profile.auth_user_id as string, 'global').catch(() => {})
    }
  }

  return json({ ok: true })
}

async function setAccess(caller: Caller, body: Record<string, unknown>) {
  if (!isOwner(caller)) return json({ error: 'Only Avi or Jackie can change access' }, 403)

  const target = String(body.profile_id ?? '')
  const appId = String(body.app_id ?? '')
  const granted = body.granted !== false
  if (!target || !appId) return json({ error: 'Which member, which app?' }, 400)

  const { error } = await db.from('app_access').upsert(
    {
      profile_id: target,
      app_id: appId,
      granted,
      granted_by: caller.profile?.id ?? null,
      updated_at: new Date().toISOString(),
    },
    { onConflict: 'profile_id,app_id' },
  )
  if (error) return json({ error: error.message }, 400)
  return json({ ok: true })
}

/**
 * Close the legacy hatch.
 *
 * Refuses while no owner can actually sign in, because the alternative is a
 * household nobody can get into: the shared account stops being accepted the
 * moment this flips, and if no code has been issued there is nothing to
 * replace it with.
 */
async function closeLegacy(caller: Caller) {
  if (!isOwner(caller)) return json({ error: 'Not allowed' }, 403)

  const { data: owners } = await db
    .from('profiles')
    .select('id, member_credentials(profile_id)')
    .eq('role', 'owner')
    .eq('is_active', true)

  const provisioned = (owners ?? []).filter(
    (o: Record<string, unknown>) =>
      Array.isArray(o.member_credentials) && o.member_credentials.length > 0,
  )
  if (provisioned.length === 0) {
    return json({ error: 'Set a household code for yourself first' }, 400)
  }

  const { error } = await db
    .from('household_settings')
    .update({ legacy_auth_enabled: false })
    .eq('singleton', true)
  if (error) return json({ error: error.message }, 400)
  return json({ ok: true })
}

// --- entrypoint -------------------------------------------------------------

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS })
  if (req.method !== 'POST') return json({ error: 'POST only' }, 405)

  let body: Record<string, unknown>
  try {
    body = await req.json()
  } catch {
    return json({ error: 'Expected JSON' }, 400)
  }

  const action = String(body.action ?? '')

  // The one action that runs without a session, because it is the one that
  // hands sessions out.
  if (action === 'redeem') return redeem(String(body.code ?? ''))

  const caller = await identify(req)
  if (!caller) return json({ error: 'Sign in first' }, 401)

  switch (action) {
    case 'create-member':
      return createMember(caller, body)
    case 'set-code':
      return setCode(caller, body)
    case 'update-member':
      return updateMember(caller, body)
    case 'set-access':
      return setAccess(caller, body)
    case 'close-legacy':
      return closeLegacy(caller)
    case 'whoami':
      return json({ profile: caller.profile, legacy: caller.legacy })
    default:
      return json({ error: `Unknown action: ${action}` }, 400)
  }
})
