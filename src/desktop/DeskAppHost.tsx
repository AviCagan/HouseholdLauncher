import { lazy, Suspense, type ComponentType } from 'react'
import { Icon, type IconName } from '@/components/primitives/Icon'
import { appById } from '@/launcher/registry'
import { appSupportedHere, useHasApp } from '@/store/useMember'
import { useLauncher, type Screen } from '@/store/useLauncher'
import { Overview } from './Overview'

/**
 * The laptop counterpart of launcher/AppHost.tsx: the same three guards —
 * the app might not exist, you might not be allowed it, it might be impossible
 * in a browser — each with its own answer, then the app's laptop view.
 *
 * Each view is its own chunk, loaded the first time it is opened, so the
 * page starts with the shell and the app in the address bar and nothing else.
 */

const VIEWS: Record<string, ComponentType> = {
  things: lazy(() => import('./apps/DeskThings').then((m) => ({ default: m.DeskThings }))),
  owe: lazy(() => import('./apps/DeskOwe').then((m) => ({ default: m.DeskOwe }))),
  meals: lazy(() => import('./apps/DeskMeals').then((m) => ({ default: m.DeskMeals }))),
  encyclopedia: lazy(() => import('./apps/DeskLexicon').then((m) => ({ default: m.DeskLexicon }))),
  watched: lazy(() => import('./apps/DeskWatched').then((m) => ({ default: m.DeskWatched }))),
}

export function DeskAppHost({ screen, onOpenPalette }: { screen: Screen; onOpenPalette: () => void }) {
  if (screen.kind === 'home') return <Overview onOpenPalette={onOpenPalette} />
  return <AppView appId={screen.appId} />
}

function AppView({ appId }: { appId: string }) {
  const app = appById(appId)
  const allowed = useHasApp(appId)

  if (!app) {
    return <Fallback icon="grid" title="App not found" hint="It may have been removed in a newer version of the launcher." />
  }
  if (!allowed) {
    return <Fallback icon="lock" title={`No access to ${app.name}`} hint="Ask Avi or Jackie to turn this one on for you." />
  }
  if (!appSupportedHere(app)) {
    return (
      <Fallback
        icon={app.icon}
        title={`${app.name} needs the Android app`}
        hint={
          appId === 'bluetooth'
            ? 'A browser has no way to see or change the Bluetooth pairings on your phone — only the Android build can do this.'
            : 'This one only works in the Android build.'
        }
      />
    )
  }

  const View = VIEWS[appId]
  if (!View) {
    return <Fallback icon={app.icon} title={`${app.name} isn't on the laptop yet`} hint="Open it from your phone for now." />
  }
  return (
    <Suspense fallback={<div className="h-full" />}>
      <View />
    </Suspense>
  )
}

function Fallback({ icon, title, hint }: { icon: IconName; title: string; hint: string }) {
  const goHome = useLauncher((s) => s.goHome)
  return (
    <div className="flex h-full flex-col items-center justify-center gap-4 px-10 text-center">
      <span style={{ color: 'var(--text-faint)', opacity: 0.5 }}>
        <Icon name={icon} size={40} />
      </span>
      <h1 className="text-[20px] font-bold">{title}</h1>
      <p className="max-w-[380px] text-[14px]" style={{ color: 'var(--text-dim)' }}>
        {hint}
      </p>
      <button
        onClick={goHome}
        className="mt-2 rounded-full px-5 py-2.5 text-[14px] font-semibold text-white"
        style={{ background: 'var(--accent)' }}
      >
        Back to the overview
      </button>
    </div>
  )
}
