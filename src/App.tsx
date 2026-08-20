import { useEffect, useState } from 'react'
import { AnimatePresence, motion } from 'motion/react'
import { Toaster } from 'sonner'
import { App as CapApp } from '@capacitor/app'
import { ProfileSelect } from './components/shell/ProfileSelect'
import { PulseLayer } from './components/feedback/PulseLayer'
import { Icon } from './components/primitives/Icon'
import { CodeGate } from './launcher/CodeGate'
import { Home } from './launcher/Home'
import { AppHost } from './launcher/AppHost'
import { NotificationCenter } from './launcher/NotificationCenter'
import { SettingsSheet } from './launcher/settings/SettingsSheet'
import { useData } from './store/useData'
import {
  applySettings,
  ensureMemberSettings,
  ensureSeeded,
  useProfile,
  useSettings,
} from './store/useProfile'
import { useLauncher } from './store/useLauncher'
import { isConfigured } from './lib/env'
import { hasSession, supabase } from './lib/supabase'
import { whoAmI } from './lib/household'
import { createSupabaseAdapter } from './data/supabaseAdapter'
import { drain } from './data/outbox'
import { startCleanup } from './lib/cleanup'
import { ensurePushRegistered } from './lib/notifications'
import { errorMessage, withRetry } from './lib/errors'
import { isNative } from './lib/platform'

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
type Boot = 'loading' | 'locked' | 'ready' | 'error'

export default function App() {
  const profiles = useData((s) => s.profiles)
  const profileId = useProfile((s) => s.profileId)
  const settings = useSettings()
  const screen = useLauncher((s) => s.screen)
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
        tap-your-name screen below — that is the only remaining path where
        "who am I" is a choice rather than a fact.
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

  useEffect(() => {
    void start()
  }, [])

  // Theme, accent, font scale and haptic config are CSS variables + module
  // state, so a settings change costs a variable write, not a re-render.
  useEffect(() => {
    applySettings(settings)
  }, [settings])

  /*
    The Android hardware back button.

    Without this, back closes the whole app from anywhere — including from
    inside an app with a sheet open, which is the moment it is most likely to
    be pressed and least likely to be meant. `back()` returns false only at the
    home screen with nothing over it, and that is the one case where letting
    the OS have the press is right.
  */
  useEffect(() => {
    if (!isNative()) return
    const listener = CapApp.addListener('backButton', () => {
      if (!useLauncher.getState().back()) void CapApp.exitApp()
    })
    return () => {
      void listener.then((l) => l.remove())
    }
  }, [])

  // Silently confirms push registration on every launch when OS permission is
  // already granted — no prompt shown either way.
  useEffect(() => {
    if (boot !== 'ready' || !profileId || !isConfigured()) return
    void ensurePushRegistered(profileId)
  }, [boot, profileId])

  if (boot === 'locked') {
    return (
      <>
        <CodeGate
          // Only leave the gate once the real data is actually loaded, so the
          // home screen never renders against an empty database.
          onUnlocked={async (id) => {
            try {
              await enter(id, false)
            } catch (err) {
              console.error('[unlock]', err)
              setBootError(errorMessage(err))
              setBoot('error')
            }
          }}
        />
        <PulseLayer />
      </>
    )
  }

  if (boot === 'error') {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-4 px-8 text-center">
        <h1 className="text-[20px] font-bold">Couldn't connect</h1>
        <p className="text-[14px]" style={{ color: 'var(--text-dim)' }}>
          {bootError ?? 'Something went wrong reaching the household.'}
        </p>
        <button
          onClick={() => void start()}
          className="rounded-full px-5 py-3 text-[15px] font-semibold text-white"
          style={{ background: 'var(--accent)' }}
        >
          Try again
        </button>
      </div>
    )
  }

  if (boot === 'loading') {
    return <div className="grid h-full place-items-center" style={{ color: 'var(--text-faint)' }} />
  }

  /*
    Tap-your-name, for two situations only: running with no backend at all, and
    a legacy shared session that predates personal codes. A member who signed
    in with their own code never sees this — their code already said who they
    are, and offering the choice would let anyone holding one guest code browse
    as somebody else.
  */
  if (!profileId) {
    return (
      <>
        <ProfileSelect
          profiles={profiles}
          onSelect={(id) => void useProfile.getState().selectProfile(id)}
        />
        <PulseLayer />
      </>
    )
  }

  return (
    <div className="flex h-full flex-col overflow-hidden">
      {!isConfigured() && <LocalModeBanner />}

      <div className="relative min-h-0 flex-1">
        <AnimatePresence mode="wait" initial={false}>
          <motion.div
            key={screen.kind === 'app' ? screen.appId : 'home'}
            className="h-full"
            // Apps come forward and home falls back, so the two directions read
            // as entering and leaving rather than as a carousel.
            initial={{ opacity: 0, scale: screen.kind === 'app' ? 0.97 : 1.02 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: screen.kind === 'app' ? 1.02 : 0.97 }}
            transition={{ duration: 0.2, ease: [0.22, 1, 0.36, 1] }}
          >
            {screen.kind === 'home' ? <Home /> : <AppHost appId={screen.appId} />}
          </motion.div>
        </AnimatePresence>
      </div>

      <NotificationCenter />
      <SettingsSheet />
      <PulseLayer />
      <Toaster
        position="top-center"
        offset={54}
        toastOptions={{
          style: {
            background: 'var(--surface-3)',
            color: 'var(--text)',
            border: '1px solid var(--border)',
          },
        }}
      />
    </div>
  )
}

/**
 * Shown only when Supabase credentials are absent. The app is fully functional
 * in this state — it just isn't shared yet — so the message says that plainly
 * rather than presenting as an error.
 */
function LocalModeBanner() {
  const [dismissed, setDismissed] = useState(false)
  if (dismissed) return null

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      className="mx-3 mt-2 flex shrink-0 items-center gap-2 rounded-full px-3.5 py-2 safe-top"
      style={{ background: 'var(--surface-3)', border: '1px solid var(--border)' }}
    >
      <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: 'var(--warn)' }} />
      <span className="flex-1 text-[12px]" style={{ color: 'var(--text-dim)' }}>
        On this device only — not syncing yet
      </span>
      <button onClick={() => setDismissed(true)} aria-label="Dismiss" style={{ color: 'var(--text-faint)' }}>
        <Icon name="close" size={14} />
      </button>
    </motion.div>
  )
}
