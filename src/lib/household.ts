import { SUPABASE_ANON_KEY, SUPABASE_URL, isConfigured } from './env'
import { supabase } from './supabase'
import type { MemberRole, Profile } from '@/data/types'

/**
 * Client half of the household Edge Function.
 *
 * Nothing here decides anything. Every call is a request to a function holding
 * the service-role key, which re-checks the caller's session and role itself —
 * so a member editing this file, or calling the endpoint straight from a
 * console, gets exactly the same answers as one using the UI.
 */

const endpoint = () => `${SUPABASE_URL}/functions/v1/household`

export type HouseholdResult<T> = { ok: true; data: T } | { ok: false; error: string }

/**
 * POST one action.
 *
 * The Authorization header carries the member's own session when there is one
 * and falls back to the publishable key when there isn't — the gateway rejects
 * a request with no key at all before the function ever runs, even though the
 * function is deployed with JWT verification off.
 */
async function call<T>(
  action: string,
  body: Record<string, unknown> = {},
): Promise<HouseholdResult<T>> {
  if (!isConfigured()) {
    return { ok: false, error: 'This device is not connected to the household yet' }
  }

  let token = SUPABASE_ANON_KEY
  const sb = supabase()
  if (sb) {
    const { data } = await sb.auth.getSession()
    if (data.session) token = data.session.access_token
  }

  let response: Response
  try {
    response = await fetch(endpoint(), {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        apikey: SUPABASE_ANON_KEY,
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ action, ...body }),
    })
  } catch {
    // Distinguished from a rejection so the sign-in screen can say "you're
    // offline" rather than telling someone their correct code is wrong.
    return { ok: false, error: "Can't reach the household right now" }
  }

  let payload: Record<string, unknown>
  try {
    payload = await response.json()
  } catch {
    return { ok: false, error: `Unexpected response (${response.status})` }
  }

  if (!response.ok) {
    // The server no longer recognises this phone's sign-in (it was ended, or
    // it ran out). Say what fixes it rather than "Sign in first".
    if (response.status === 401 && !['redeem', 'sign-in', 'pick'].includes(action)) {
      return {
        ok: false,
        error: "This phone's sign-in has ended. Sign out of this device below, then sign back in with your code.",
      }
    }
    return { ok: false, error: String(payload.error ?? `Something went wrong (${response.status})`) }
  }
  return { ok: true, data: payload as T }
}

// --- signing in -------------------------------------------------------------

export interface RedeemedSession {
  session: { access_token: string; refresh_token: string }
  profile: Profile & { role: MemberRole; is_active: boolean }
}

/**
 * Exchange a household code for that member's session.
 *
 * The function returns raw tokens rather than a cookie, so they have to be
 * installed into the client explicitly — `setSession` is what persists them
 * and starts the refresh timer, and skipping it means the app appears signed
 * in until the first reload.
 */
async function installSession(session: RedeemedSession['session']): Promise<string | null> {
  const sb = supabase()
  if (!sb) return 'This device is not connected to the household yet'
  const { error } = await sb.auth.setSession({
    access_token: session.access_token,
    refresh_token: session.refresh_token,
  })
  return error ? error.message : null
}

export async function redeemCode(
  code: string,
): Promise<HouseholdResult<RedeemedSession['profile']>> {
  const result = await call<RedeemedSession>('redeem', { code })
  if (!result.ok) return result
  const problem = await installSession(result.data.session)
  if (problem) return { ok: false, error: problem }
  return { ok: true, data: result.data.profile }
}

/** Someone the household code can sign in as. */
export interface Pickable {
  id: string
  display_name: string
  avatar_emoji: string
  avatar_url: string | null
  color_hex: string
}

export type SignInResult =
  | { kind: 'member'; profile: RedeemedSession['profile'] }
  | { kind: 'pick'; people: Pickable[] }

/**
 * What the code screen sends. The household code answers with who it can
 * sign in as (then `pickPerson`); a member's own code signs them straight in.
 */
export async function signInWithCode(code: string): Promise<HouseholdResult<SignInResult>> {
  const result = await call<RedeemedSession | { pick: Pickable[] }>('sign-in', { code })
  if (!result.ok) return result
  if ('pick' in result.data) return { ok: true, data: { kind: 'pick', people: result.data.pick } }
  const problem = await installSession(result.data.session)
  if (problem) return { ok: false, error: problem }
  return { ok: true, data: { kind: 'member', profile: result.data.profile } }
}

/** "Who's this?": the household code and the name tapped. The phone is them from then on. */
export async function pickPerson(
  code: string,
  profileId: string,
): Promise<HouseholdResult<RedeemedSession['profile']>> {
  const result = await call<RedeemedSession>('pick', { code, profile_id: profileId })
  if (!result.ok) return result
  const problem = await installSession(result.data.session)
  if (problem) return { ok: false, error: problem }
  return { ok: true, data: result.data.profile }
}

/** Change the shared household code. Avi or Jackie, signed in as themselves. */
export const setHouseholdCode = (code: string) => call<{ ok: true }>('set-household-code', { code })

/** How sign-in is set up on the server. Only owners are told. */
export interface SignInSecurity {
  /** Whether the secret that protects stored codes is set. No codes work without it. */
  pepper_set: boolean
}

/** Who the current session belongs to, straight from the server. */
export const whoAmI = () =>
  call<{
    profile: { id: string; role: MemberRole; display_name: string } | null
    legacy: boolean
    security?: SignInSecurity
  }>('whoami')

// --- managing people --------------------------------------------------------

export interface NewMember {
  display_name: string
  avatar_emoji?: string
  color_hex?: string
  role?: MemberRole
  /** Blank asks the server to generate one, in `format`. */
  code?: string
  format?: CodeFormat
  /** App ids to grant on creation. */
  apps?: string[]
}

/**
 * Add a person. Resolves with the code they should be told.
 *
 * Returned once and never stored in readable form — only its peppered hash
 * reaches the database — so the UI has to show it now. Losing it means
 * rotating to a new one, not looking the old one up.
 */
export type CodeFormat = 'digits4' | 'digits6' | 'letters'

export const createMember = (member: NewMember) =>
  call<{ profile_id: string; code: string }>('create-member', { ...member })

/** Set or rotate a code. Blank generates one in `format`. Owners may target anyone. */
export const setMemberCode = (profileId: string, code: string, format: CodeFormat = 'digits4') =>
  call<{ code: string }>('set-code', { profile_id: profileId, code, format })

export const updateMember = (
  profileId: string,
  patch: Partial<{
    display_name: string
    avatar_emoji: string
    avatar_url: string | null
    color_hex: string
    role: MemberRole
    is_active: boolean
    /** Their name as Owe & Owed writes it. Owners only. */
    owe_name: string | null
  }>,
) => call<{ ok: true }>('update-member', { profile_id: profileId, ...patch })

/**
 * Make Nano's code, creating her member row the first time. Shown once:
 * Avi puts it on the brain himself. A new code stops the old one and every
 * session it started.
 */
export const makeNanoCode = () => call<{ profile_id: string; code: string }>('nano-code')

export const setAppAccess = (profileId: string, appId: string, granted: boolean) =>
  call<{ ok: true }>('set-access', { profile_id: profileId, app_id: appId, granted })

/**
 * Stop accepting the old shared Things account.
 *
 * The last step of setup rather than a routine toggle: until it runs, anyone
 * holding the pre-launcher PIN still reaches every table, which is the bridge
 * that let codes be handed out in the first place.
 */
export const closeLegacyAuth = () => call<{ ok: true }>('close-legacy')
