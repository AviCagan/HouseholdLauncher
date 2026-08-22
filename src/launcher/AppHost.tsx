import { lazy, Suspense } from 'react'
import { motion } from 'motion/react'
import { Icon } from '@/components/primitives/Icon'
import { appById } from './registry'
import { appSupportedHere, useHasApp } from '@/store/useMember'
import { useLauncher } from '@/store/useLauncher'
import { fire } from '@/lib/haptics'
import { ThingsApp } from '@/apps/things/ThingsApp'
import { OweApp } from '@/apps/owe/OweApp'

/**
 * Renders whichever app is open, with the guards that every app shares.
 *
 * Three things are checked before an app's own code runs, and each has a
 * distinct answer because they are genuinely different problems: the app might
 * not exist any more, you might not be allowed to use it, or it might be
 * impossible on this device. Collapsing them into one "unavailable" screen is
 * what makes people retry the one case that will never work.
 *
 * The Bluetooth app is loaded lazily because it pulls in the Capacitor plugin
 * bridge, which has no business being in the initial bundle on an iPhone where
 * the app cannot run at all.
 */
const BluetoothApp = lazy(() =>
  import('@/apps/bluetooth/BluetoothApp').then((m) => ({ default: m.BluetoothApp })),
)

export function AppHost({ appId }: { appId: string }) {
  const app = appById(appId)
  const allowed = useHasApp(appId)
  const goHome = useLauncher((s) => s.goHome)

  if (!app) {
    return (
      <Fallback
        icon="grid"
        title="App not found"
        hint="It may have been removed in a newer version of the launcher."
      />
    )
  }

  if (!allowed) {
    return (
      <Fallback
        icon="lock"
        title={`No access to ${app.name}`}
        hint="Ask Avi or Jackie to turn this one on for you."
      />
    )
  }

  if (!appSupportedHere(app)) {
    return (
      <Fallback
        icon={app.icon}
        title={`${app.name} needs the Android app`}
        hint={
          appId === 'bluetooth'
            ? "iPhone doesn't let a web app see or change your Bluetooth pairings — only the Android build can do this."
            : 'This one only works in the Android build.'
        }
      />
    )
  }

  return (
    <>
      {appId === 'things' && <ThingsApp />}
      {appId === 'owe' && (
        <AppFrame name={app.name} color={app.color} onBack={goHome}>
          <OweApp />
        </AppFrame>
      )}
      {appId === 'bluetooth' && (
        <AppFrame name={app.name} color={app.color} onBack={goHome}>
          <Suspense fallback={<div className="h-full" />}>
            <BluetoothApp />
          </Suspense>
        </AppFrame>
      )}
    </>
  )
}

/**
 * Header with a way back to the home screen.
 *
 * Things brings its own chrome — a four-tab dock with no room for this — and
 * gets out via the hardware back button or a swipe instead. Every other app
 * gets the frame, so "how do I leave" is never a question.
 */
function AppFrame({
  name,
  color,
  onBack,
  children,
}: {
  name: string
  color: string
  onBack: () => void
  children: React.ReactNode
}) {
  return (
    <div className="flex h-full flex-col">
      <header className="flex shrink-0 items-center gap-2 px-2 pb-1 pt-[max(var(--safe-top),0.5rem)]">
        <button
          onClick={() => {
            fire('tap')
            onBack()
          }}
          aria-label="Back to home"
          className="grid h-10 w-10 shrink-0 place-items-center rounded-full"
          style={{ color: 'var(--text-dim)' }}
        >
          <Icon name="back" size={21} strokeWidth={2.4} />
        </button>
        <h1 className="min-w-0 truncate text-[19px] font-bold tracking-tight" style={{ color }}>
          {name}
        </h1>
      </header>
      <div className="min-h-0 flex-1">{children}</div>
    </div>
  )
}

function Fallback({
  icon,
  title,
  hint,
}: {
  icon: Parameters<typeof Icon>[0]['name']
  title: string
  hint: string
}) {
  const goHome = useLauncher((s) => s.goHome)
  return (
    <div className="flex h-full flex-col items-center justify-center gap-4 px-10 text-center">
      <span style={{ color: 'var(--text-faint)', opacity: 0.5 }}>
        <Icon name={icon} size={38} />
      </span>
      <h1 className="text-[19px] font-bold">{title}</h1>
      <p className="max-w-[290px] text-[13.5px]" style={{ color: 'var(--text-dim)' }}>
        {hint}
      </p>
      <motion.button
        whileTap={{ scale: 0.96 }}
        onClick={() => {
          fire('tap')
          goHome()
        }}
        className="mt-2 rounded-full px-5 py-3 text-[15px] font-semibold text-white"
        style={{ background: 'var(--accent)' }}
      >
        Back to home
      </motion.button>
    </div>
  )
}
