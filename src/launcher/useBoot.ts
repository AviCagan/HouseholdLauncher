import { useEffect, useState } from 'react'
import { useData } from '@/store/useData'
import {
  applySettings,
  ensureMemberSettings,
  ensureSeeded,
  useProfile,
  useSettings,
} from '@/store/useProfile'
import { isConfigured } from '@/lib/env'
import { hasSession, supabase } from '@/lib/supabase'
import { whoAmI } from '@/lib/household'
import { createSupabaseAdapter } from '@/data/supabaseAdapter'
import { drain } from '@/data/outbox'
import { startCleanup } from '@/lib/cleanup'
import { ensurePushRegistered } from '@/lib/notifications'
import { errorMessage, withRetry } from '@/lib/errors'

/**
 * Starting up, shared by both pages.
 *
 * The phone launcher (App.tsx) and the laptop one (desktop/DesktopApp.tsx)
 * draw very different screens over the same data, and the part that gets
 * them to that data — session, adapter swap, who-am-I, seeding — is the part
 * that took the most fixing to get right. It lives here once so a fix to it
 * is a fix to both.
 */

/** Swap the local adapter for Supabase and replay anything queued offline. */
async function goLive() {
  const sb = supabase()
  if (!sb) return
  const adapter = createSupabaseAdapter(sb)
  await drain(adapter).catch(() => 0)
  await useData.getState().setAdapter(adapter)
}

/**
 * Boot is an explicit state machine rather than a set of independent flags.
 *
 * The blank screen after entering a code came from exactly that: unlocking
 * flipped `locked` to false while `ready` was still true from a local-adapter
 * init, so the home screen rendered against an empty local database. And any
 * failure while swapping in the real adapter left `ready` false forever, which
 * is why only a restart recovered it.
 */
export type Boot = 'loading' | 'locked' | 'ready' | 'error'

export function useBoot() {
  const profileId = useProfile((s) => s.profileId)
  const settings = useSettings()
  const [boot, setBoot] = useState<Boot>('loading')
  const [bootError, setBootError] = useState<string | null>(null)

  /**
   * Finish signing in: bring the real data up, then work out who we are.
   *
   * `identify` is skipped when the caller already knows — redeeming a code
   * returns the member it belongs to, so asking the server again would be a
   * second round trip for an answer we were just handed.
   */
  async function enter(knownProfileId: string | null, identify: boolean) {
    await withRetry(() => goLive())
    await withRetry(() => ensureSeeded())
    startCleanup()

    if (knownProfileId) {
      await useProfile.getState().selectProfile(knownProfileId)
      await ensureMemberSettings(knownProfileId)
    } else if (identify) {
      /*
        Resolve a session that was persisted from a previous launch.

        A member's session carries no member id the client can read, so the
        server is asked once per cold start. A legacy shared session answers
        with no profile at all, which is the case that falls through to the
        tap-your-name screen — that is the only remaining path where "who am
        I" is a choice rather than a fact.
      */
      const me = await whoAmI()
      if (me.ok && me.data.profile) {
        await useProfile.getState().selectProfile(me.data.profile.id)
        await ensureMemberSettings(me.data.profile.id)
      }
    }

    setBoot('ready')
  }

  async function start() {
    setBoot('loading')
    setBootError(null)
    try {
      await useProfile.getState().hydrate()

      if (!isConfigured()) {
        // No credentials: the local adapter IS the backend, not a stub.
        await useData.getState().init()
        await ensureSeeded()
        startCleanup()
        setBoot('ready')
        return
      }

      // Configured but no session yet → a code is owed once on this device.
      if (!(await hasSession())) {
        setBoot('locked')
        return
      }

      await enter(null, true)
    } catch (err) {
      console.error('[boot]', err)
      setBootError(errorMessage(err))
      setBoot('error')
    }
  }

  /**
   * After a code is accepted. Only leave the gate once the real data is
   * actually loaded, so the home screen never renders against an empty
   * database.
   */
  async function unlock(id: string | null) {
    try {
      await enter(id, false)
    } catch (err) {
      console.error('[unlock]', err)
      setBootError(errorMessage(err))
      setBoot('error')
    }
  }

  useEffect(() => {
    void start()
  }, [])

  // Theme, accent, font scale and haptic config are CSS variables + module
  // state, so a settings change costs a variable write, not a re-render.
  useEffect(() => {
    applySettings(settings)
  }, [settings])

  // Silently confirms push registration on every launch when OS permission is
  // already granted — no prompt shown either way.
  useEffect(() => {
    if (boot !== 'ready' || !profileId || !isConfigured()) return
    void ensurePushRegistered(profileId)
  }, [boot, profileId])

  return { boot, bootError, retry: start, unlock }
}
