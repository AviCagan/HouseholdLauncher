import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import {
  HOUSEHOLD_EMAIL,
  SUPABASE_ANON_KEY,
  SUPABASE_URL,
  isConfigured,
  pinToPassword,
} from './env'

let client: SupabaseClient | null = null

/** Null until credentials are configured — the app runs locally until then. */
export function supabase(): SupabaseClient | null {
  if (!isConfigured()) return null
  if (!client) {
    client = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      auth: {
        // The whole point of the one-time PIN: the session is persisted and
        // silently refreshed forever, so it is asked for once per device.
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: false,
      },
      realtime: { params: { eventsPerSecond: 20 } },
    })
  }
  return client
}

export async function hasSession(): Promise<boolean> {
  const sb = supabase()
  if (!sb) return false
  const { data } = await sb.auth.getSession()
  return data.session !== null
}

export type UnlockResult =
  | { ok: true }
  | { ok: false; reason: 'bad-pin' | 'offline' | 'unconfigured' }

/**
 * Exchange the household PIN for a Supabase session.
 *
 * The PIN is padded because Supabase enforces a 6-character minimum password.
 * Entropy is still whatever the PIN itself carries — padding satisfies the
 * validator, it does not add security.
 */
export async function unlockWithPin(pin: string): Promise<UnlockResult> {
  const sb = supabase()
  if (!sb) return { ok: false, reason: 'unconfigured' }

  const { error } = await sb.auth.signInWithPassword({
    email: HOUSEHOLD_EMAIL,
    password: pinToPassword(pin),
  })

  if (!error) return { ok: true }
  // Distinguish "wrong code" from "no network" so the UI can say the right
  // thing instead of blaming the user for being offline.
  const message = error.message.toLowerCase()
  if (message.includes('fetch') || message.includes('network')) {
    return { ok: false, reason: 'offline' }
  }
  return { ok: false, reason: 'bad-pin' }
}

export async function signOut(): Promise<void> {
  await supabase()?.auth.signOut()
}
