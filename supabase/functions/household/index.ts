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
import {
  approvalProblem,
  clientAddress,
  codeProblem,
  GUESS_WINDOW_MS,
  GUESSES_HOUSEHOLD,
  GUESSES_PER_CLIENT,
  guessWait,
  codeFormat,
  makeCode,
  normaliseCode,
  waitMessage,
} from '../_shared/signin.ts'

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

  There used to be a public default so a half-configured deploy still ran.
  Now there isn't: without the secret, no code is issued and none is
  accepted, and Settings tells the owners (see `whoami`). Nobody is locked
  out by that — a code made without the secret was never protected — and the
  shared PIN still works until the owners turn it off.

  Set it once and leave it: changing it later turns every issued code into a
  wrong one, and everybody needs a new code.
*/
const PEPPER = Deno.env.get('HOUSEHOLD_CODE_PEPPER') ?? ''
const PEPPER_SET = PEPPER.length >= 16
const NO_PEPPER = 'Codes are switched off until the code secret is set on the server (HOUSEHOLD_CODE_PEPPER)'

const db = createClient(SUPABASE_URL, SERVICE_ROLE, {
  auth: { persistSession: false },
})

/*
  `apikey` has to be in the allowed headers: the app sends it on every call
  (see src/lib/household.ts and src/lib/unfurl.ts). Without it the browser's
  preflight came back without permission and the browser never sent the real
  request at all — so from a browser this function could not be reached, and
  the app reported it as "Can't reach the household right now".
*/
const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, 'Content-Type': 'application/json' },
  })

// --- codes ------------------------------------------------------------------

async function sha256(text: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text))
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('')
}

const hashCode = (raw: string) => sha256(`${PEPPER}:${normaliseCode(raw)}`)

/**
 * Guesses are counted per device without keeping anyone's address: the
 * table holds a peppered hash of it, which is only good for telling two
 * requests apart.
 */
const guesserKey = (req: Request) => sha256(`${PEPPER}:guesser:${clientAddress(req.headers)}`)

/** Codes are generated, not typed, when nobody supplies one. */
const randomCode = (format: Parameters<typeof makeCode>[0]) =>
  makeCode(format, (n) => crypto.getRandomValues(new Uint8Array(n)))

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
    .select('id, role, display_name, is_active')
    .eq('auth_user_id', data.user.id)
    .maybeSingle()

  if (profile) {
    // A member who was switched off (or Nano, turned off) is nobody. They
    // must not fall through to the legacy branch below, which would treat
    // their still-valid session as the shared owner account.
    if (!profile.is_active) return null
    return { profile: { id: profile.id, role: profile.role, display_name: profile.display_name }, legacy: false }
  }

  const { data: settings } = await db
    .from('household_settings')
    .select('legacy_auth_enabled')
    .limit(1)
    .maybeSingle()

  if (settings?.legacy_auth_enabled) return { profile: null, legacy: true }
  return null
}

const isOwner = (caller: Caller) => caller.legacy || caller.profile?.role === 'owner'
const isNano = (caller: Caller) => caller.profile?.role === 'agent'
const MEMBER_ROLES = ['owner', 'member', 'guest']

/**
 * Nano asking for an owner action.
 *
 * She gets it only with an approval Avi gave with his code: one row in
 * nano_approvals, of the right kind, naming the right person, approved in the
 * last ten minutes and not used yet. It is used up here, before the action
 * runs, by a conditional update, so the same approval can't be spent twice by
 * two calls at once. The action then runs as the owner she asked for.
 */
async function nanoGate(
  caller: Caller,
  body: Record<string, unknown>,
  action: string,
): Promise<{ caller: Caller } | { refused: Response }> {
  if (!isNano(caller)) return { caller }
  const target = body.profile_id ? String(body.profile_id) : null
  const approvalId = String(body.approval ?? '')
  const { data: approval } = approvalId
    ? await db
        .from('nano_approvals')
        .select('id, kind, status, approved_at, target_profile, asked_for')
        .eq('id', approvalId)
        .maybeSingle()
    : { data: null }
  const problem = approvalProblem(approval, action, target, new Date())
  if (problem) return { refused: json({ error: problem }, 403) }
  if (target && (await isAgentProfile(target))) return { refused: json({ error: "Nano can't change her own account" }, 403) }

  const { data: owner } = await db
    .from('profiles')
    .select('id, role, display_name, is_active')
    .eq('id', approval!.asked_for)
    .maybeSingle()
  if (!owner || owner.role !== 'owner' || !owner.is_active) {
    return { refused: json({ error: 'Only an approval for Avi or Jackie can do that' }, 403) }
  }

  const { data: spent } = await db
    .from('nano_approvals')
    .update({ status: 'used', used_at: new Date().toISOString() })
    .eq('id', approvalId)
    .eq('status', 'approved')
    .select('id')
  if (!spent || spent.length === 0) return { refused: json({ error: 'That approval has already been used' }, 403) }

  return { caller: { profile: { id: owner.id, role: 'owner', display_name: owner.display_name }, legacy: false } }
}

/** True when this member is Nano, whom only the Nano settings may change. */
async function isAgentProfile(id: string): Promise<boolean> {
  const { data } = await db.from('profiles').select('role').eq('id', id).maybeSingle()
  return data?.role === 'agent'
}

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
  if (!PEPPER_SET) return { error: NO_PEPPER }
  const { data: profile } = await db
    .from('profiles')
    .select('id, auth_user_id, role')
    .eq('id', profileId)
    .maybeSingle()
  if (!profile) return { error: 'No such member' }
  const problem = codeProblem(code, profile.role as string)
  if (problem) return { error: problem }

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

/**
 * How long this device has to wait before another guess, from the wrong
 * codes in the last quarter of an hour. Null when the count itself can't be
 * read: then nobody gets to guess, rather than everybody getting to.
 */
async function guessesWait(key: string): Promise<number | null> {
  const since = new Date(Date.now() - GUESS_WINDOW_MS).toISOString()
  const [mine, all] = await Promise.all([
    db.from('sign_in_failures').select('at').eq('client_key', key).gt('at', since).order('at', { ascending: false }).limit(GUESSES_PER_CLIENT),
    db.from('sign_in_failures').select('at').gt('at', since).order('at', { ascending: false }).limit(GUESSES_HOUSEHOLD),
  ])
  if (mine.error || all.error) return null
  const dates = (rows: { at: string }[]) => rows.map((r) => new Date(r.at))
  return guessWait(dates(mine.data ?? []), dates(all.data ?? []), new Date())
}

async function recordWrongCode(key: string): Promise<void> {
  await db.from('sign_in_failures').insert({ client_key: key })
  // Nothing older than a day is ever read again. Trimmed now and then on the
  // way past rather than by a scheduled job.
  if (Math.random() < 0.1) {
    await db.from('sign_in_failures').delete().lt('at', new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString())
  }
}

async function redeem(req: Request, code: string) {
  if (!code?.trim()) return json({ error: 'Enter your household code' }, 400)

  // One message for "no such code", "that member is switched off" and "codes
  // aren't on yet", so the response cannot be used to enumerate which codes
  // are real. The owners see the last of those in Settings instead.
  const denied = () => json({ error: 'That code did not work' }, 401)
  if (!PEPPER_SET) return denied()

  const key = await guesserKey(req)
  const wait = await guessesWait(key)
  if (wait === null) return json({ error: 'Signing in is unavailable right now. Try again in a minute.' }, 503)
  if (wait > 0) {
    return new Response(JSON.stringify({ error: waitMessage(wait), retry_after: wait }), {
      status: 429,
      headers: { ...CORS, 'Content-Type': 'application/json', 'Retry-After': String(wait) },
    })
  }

  const { data: cred } = await db
    .from('member_credentials')
    .select('profile_id, auth_email, auth_password')
    .eq('code_hash', await hashCode(code))
    .maybeSingle()

  const { data: profile } = cred
    ? await db
        .from('profiles')
        .select('id, slug, display_name, avatar_emoji, avatar_url, color_hex, role, is_active')
        .eq('id', cred.profile_id)
        .maybeSingle()
    : { data: null }
  if (!cred || !profile || !profile.is_active) {
    await recordWrongCode(key)
    return denied()
  }

  // The right code clears this device's count, so a few typos earlier in
  // the quarter-hour don't count against the next phone signed in from it.
  await db.from('sign_in_failures').delete().eq('client_key', key)

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

  const code = String(body.code ?? '').trim() || randomCode(codeFormat(body.format))
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

  const { data: member } = await db.from('profiles').select('role').eq('id', target).maybeSingle()
  if (!member) return json({ error: 'No such member' }, 400)
  if (member.role === 'agent') return json({ error: "Make Nano's code in Settings › People › Nano" }, 400)
  // The length rule itself is checked in provision(), for every way in.
  const code = String(body.code ?? '').trim() || randomCode(codeFormat(body.format))

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

  // Which Owe & Owed name is them, so Nano can answer a friend about their
  // own balance and nobody else's. An owner's call, never a member's own.
  if ('owe_name' in body) {
    if (!isOwner(caller)) return json({ error: 'Not allowed' }, 403)
    const name = String(body.owe_name ?? '').trim()
    patch.owe_name = name || null
  }

  // Nano's row: only an owner, in person, switches her on or off. Nothing
  // else about it changes here, and never by Nano herself.
  if (await isAgentProfile(target)) {
    if (!isOwner(caller) || caller.legacy) return json({ error: 'Not allowed' }, 403)
    if (typeof body.is_active !== 'boolean') return json({ error: 'Only on or off' }, 400)
    const { error } = await db.from('profiles').update({ is_active: body.is_active }).eq('id', target)
    if (error) return json({ error: error.message }, 400)
    return json({ ok: true })
  }

  if ('role' in body || 'is_active' in body) {
    if (!isOwner(caller)) return json({ error: 'Not allowed' }, 403)
    if ('role' in body && !MEMBER_ROLES.includes(String(body.role))) return json({ error: 'Unknown role' }, 400)
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
  // Nano's reach comes from row-level security, never from app grants.
  if (await isAgentProfile(target)) return json({ error: 'Nano has no app grants' }, 400)

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

/**
 * Make Nano's code, creating her member row the first time.
 *
 * A new code replaces the old one completely: her sign-in account is deleted
 * and made again, so every session the old code started stops working at
 * once, not when its token runs out. Owners only, in person: the shared PIN
 * can't do it, and neither can Nano.
 */
async function nanoCode(caller: Caller) {
  if (!isOwner(caller) || caller.legacy || isNano(caller)) {
    return json({ error: "Only Avi or Jackie, signed in with their own code, can make Nano's code" }, 403)
  }
  if (!PEPPER_SET) return json({ error: NO_PEPPER }, 400)

  let { data: nano } = await db
    .from('profiles')
    .select('id, auth_user_id')
    .eq('role', 'agent')
    .maybeSingle()

  if (!nano) {
    const id = crypto.randomUUID()
    const { error } = await db.from('profiles').insert({
      id,
      slug: `nano-${id.slice(0, 4)}`,
      display_name: 'Nano',
      avatar_emoji: '✨',
      color_hex: '#ff7ac6',
      role: 'agent',
      is_active: true,
    })
    if (error) return json({ error: error.message }, 400)
    nano = { id, auth_user_id: null }
  } else if (nano.auth_user_id) {
    const { error } = await db.auth.admin.deleteUser(nano.auth_user_id as string)
    if (error) return json({ error: `Couldn't stop the old code: ${error.message}` }, 500)
    await db.from('profiles').update({ auth_user_id: null }).eq('id', nano.id)
    await db.from('member_credentials').delete().eq('profile_id', nano.id)
  }

  const result = await provision(nano.id as string, randomCode('nano'))
  if ('error' in result) return json({ error: result.error }, 400)
  return json({ profile_id: nano.id, code: result.code })
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
  if (action === 'redeem') return redeem(req, String(body.code ?? ''))

  const caller = await identify(req)
  if (!caller) return json({ error: 'Sign in first' }, 401)

  // Nano gets the owner actions only through an approval; everything else
  // below refuses her by role.
  if (isNano(caller) && !['create-member', 'set-code', 'update-member', 'set-access', 'whoami'].includes(action)) {
    return json({ error: "Nano can't do that" }, 403)
  }
  const gated = ['create-member', 'set-code', 'update-member', 'set-access'].includes(action)
    ? await nanoGate(caller, body, action)
    : { caller }
  if ('refused' in gated) return gated.refused
  const acting = gated.caller

  switch (action) {
    case 'create-member':
      return createMember(acting, body)
    case 'set-code':
      return setCode(acting, body)
    case 'update-member':
      return updateMember(acting, body)
    case 'set-access':
      return setAccess(acting, body)
    case 'nano-code':
      return nanoCode(caller)
    case 'close-legacy':
      return closeLegacy(caller)
    case 'whoami':
      return json({
        profile: caller.profile,
        legacy: caller.legacy,
        // For the Security card in Settings. Owners only: nobody else can act
        // on it, and it says something about how the server is set up.
        security: isOwner(caller) ? { pepper_set: PEPPER_SET } : undefined,
      })
    default:
      return json({ error: `Unknown action: ${action}` }, 400)
  }
})
