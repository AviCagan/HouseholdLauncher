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
export async function redeemCode(
  code: string,
): Promise<HouseholdResult<RedeemedSession['profile']>> {
  const result = await call<RedeemedSession>('redeem', { code })
  if (!result.ok) return result

  const sb = supabase()
  if (!sb) return { ok: false, error: 'This device is not connected to the household yet' }

  const { error } = await sb.auth.setSession({
    access_token: result.data.session.access_token,
    refresh_token: result.data.session.refresh_token,
  })
  if (error) return { ok: false, error: error.message }

  return { ok: true, data: result.data.profile }
}

/** Who the current session belongs to, straight from the server. */
export const whoAmI = () =>
  call<{ profile: { id: string; role: MemberRole; display_name: string } | null; legacy: boolean }>(
    'whoami',
  )

// --- managing people --------------------------------------------------------

export interface NewMember {
  display_name: string
  avatar_emoji?: string
  color_hex?: string
  role?: MemberRole
  /** Blank asks the server to generate one. */
  code?: string
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
export const createMember = (member: NewMember) =>
  call<{ profile_id: string; code: string }>('create-member', { ...member })

/** Set or rotate a code. Blank generates one. Owners may target anyone. */
export const setMemberCode = (profileId: string, code: string) =>
  call<{ code: string }>('set-code', { profile_id: profileId, code })

export const updateMember = (
  profileId: string,
  patch: Partial<{
    display_name: string
    avatar_emoji: string
    avatar_url: string | null
    color_hex: string
    role: MemberRole
    is_active: boolean
  }>,
) => call<{ ok: true }>('update-member', { profile_id: profileId, ...patch })

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
