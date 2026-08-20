/**
 * Typed access to build-time config.
 *
 * These are VITE_-prefixed, which means they are inlined into the client bundle
 * and served publicly. They are NOT secrets — using GitHub Actions secrets for
 * them keeps them out of git history and nothing more. This is precisely why the
 * database is gated behind an authenticated session rather than left open to the
 * anon role.
 */

const raw = import.meta.env as Record<string, string | undefined>

export const SUPABASE_URL = raw.VITE_SUPABASE_URL?.trim() ?? ''

/**
 * The browser-safe key.
 *
 * Supabase now issues `sb_publishable_…` keys and calls the old JWT-style ones
 * "legacy anon". Both work identically here, so either env name is accepted —
 * whichever the dashboard happened to show when you set it up.
 */
export const SUPABASE_ANON_KEY =
  raw.VITE_SUPABASE_PUBLISHABLE_KEY?.trim() ||
  raw.VITE_SUPABASE_ANON_KEY?.trim() ||
  ''

export const VAPID_PUBLIC_KEY = raw.VITE_VAPID_PUBLIC_KEY?.trim() ?? ''

/** The shared household account the PIN unlocks. */
export const HOUSEHOLD_EMAIL =
  raw.VITE_HOUSEHOLD_EMAIL?.trim() || 'household@things.local'

/**
 * Supabase enforces a 6-character minimum password, so the 4-digit PIN is padded
 * deterministically. Entropy is still 4 digits — see the plan. Changing this
 * prefix invalidates the existing account password.
 */
export const pinToPassword = (pin: string): string => `things-household-${pin}`

/**
 * False until Supabase credentials exist. The app stays fully usable on the
 * local adapter and shows a setup screen rather than a blank page or a crash.
 */
export const isConfigured = (): boolean =>
  SUPABASE_URL.length > 0 && SUPABASE_ANON_KEY.length > 0
