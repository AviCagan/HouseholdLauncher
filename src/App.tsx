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
import { useProfile } from './store/useProfile'
import { useLauncher } from './store/useLauncher'
import { useBoot } from './launcher/useBoot'
import { isConfigured } from './lib/env'
import { isNative } from './lib/platform'

export default function App() {
  const profiles = useData((s) => s.profiles)
  const profileId = useProfile((s) => s.profileId)
  const screen = useLauncher((s) => s.screen)
  const { boot, bootError, retry, unlock } = useBoot()

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

  if (boot === 'locked') {
    return (
      <>
        <CodeGate onUnlocked={unlock} />
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
          onClick={() => void retry()}
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
        /*
          Both, and the second one is the one that matters.

          Under 600px wide — every phone this app runs on — sonner ignores
          `offset` completely and lays the toaster out from `--mobile-offset-*`
          instead, which defaults to a flat 16px. So the inset-aware offset
          below was correct and simply never applied on the devices it was
          written for, and the toast kept landing on the Dynamic Island.
        */
        offset="calc(var(--safe-top) + 54px)"
        mobileOffset={{ top: 'calc(var(--safe-top) + 16px)' }}
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
      className="mx-3 mt-[max(var(--safe-top),0.5rem)] flex shrink-0 items-center gap-2 rounded-full px-3.5 py-2"
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
