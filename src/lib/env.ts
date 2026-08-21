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

/*
  The household's own project, committed rather than injected at build time.

  This is a deliberate choice and not an oversight. Both values are inlined
  into the client bundle by definition — they were already readable by anyone
  who opened the deployed site and viewed source, which is literally where
  these two were recovered from. Keeping them in Actions secrets bought
  obscurity in git history and nothing else, at the cost of every build needing
  someone to have configured that repository first.

  What actually protects the data is unchanged and is the thing to keep true:

    - Row-level security grants `authenticated` only. The anon role has no
      policy on any table, so this key on its own reads empty from all of them.
    - Email signups are turned off in the dashboard, so the key cannot be used
      to mint an account that would satisfy `authenticated`.
    - Per-app access is enforced in RLS against the member the session belongs
      to, not in the client.

  If this key ever needs to stop working — rotate it in the Supabase dashboard
  under Settings → API Keys. Changing it here alone does nothing, because the
  old one keeps working until the project revokes it.

  An environment variable still wins when one is set, so pointing a build at a
  different project stays a matter of setting VITE_SUPABASE_URL.
*/
const DEFAULT_SUPABASE_URL = 'https://rixslpsozkfytcdeprma.supabase.co'
const DEFAULT_SUPABASE_KEY = 'sb_publishable_CHPXv-113XNtz4lZ7CSRLw_jMx3g3pw'

export const SUPABASE_URL = raw.VITE_SUPABASE_URL?.trim() || DEFAULT_SUPABASE_URL

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
  DEFAULT_SUPABASE_KEY

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
 * Whether there is a backend to talk to.
 *
 * True by default now that the project is committed above. It can still be
 * false two ways, and both matter: a build that blanks the values out with
 * `VITE_SUPABASE_URL=""`, and `VITE_LOCAL_ONLY=1`, which is the switch for
 * working on the UI without touching the household's real data. In either case
 * the app is fully usable on the local adapter and says so in a banner, rather
 * than showing a blank page or a crash.
 */
export const isConfigured = (): boolean =>
  raw.VITE_LOCAL_ONLY !== '1' && SUPABASE_URL.length > 0 && SUPABASE_ANON_KEY.length > 0
