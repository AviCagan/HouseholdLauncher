import type { ReactNode } from 'react'
import { Toaster } from 'sonner'
import { CodeGate } from '@/launcher/CodeGate'
import { useBoot } from '@/launcher/useBoot'
import { ProfileSelect } from '@/components/shell/ProfileSelect'
import { PulseLayer } from '@/components/feedback/PulseLayer'
import { useData } from '@/store/useData'
import { useProfile } from '@/store/useProfile'
import { Shell } from './Shell'

/**
 * The laptop page's root.
 *
 * Boots exactly as the phone launcher does (see launcher/useBoot.ts) — same
 * session, same code gate, same who-am-I — and then hands over to a shell
 * built for a wide screen instead of the home grid. A household code entered
 * on the phone page in this browser is the same session here: both pages are
 * one origin, and Supabase keeps the session in that origin's storage.
 */
export function DesktopApp() {
  const profiles = useData((s) => s.profiles)
  const profileId = useProfile((s) => s.profileId)
  const { boot, bootError, retry, unlock } = useBoot()

  let body: ReactNode
  if (boot === 'locked') {
    body = (
      <Centered>
        <CodeGate onUnlocked={unlock} />
      </Centered>
    )
  } else if (boot === 'error') {
    body = (
      <Centered>
        <div className="flex h-full flex-col items-center justify-center gap-4 px-8 text-center">
          <h1 className="text-[22px] font-bold">Couldn't connect</h1>
          <p className="text-[14px]" style={{ color: 'var(--text-dim)' }}>
            {bootError ?? 'Something went wrong reaching the household.'}
          </p>
          <button
            onClick={() => void retry()}
            className="rounded-full px-5 py-2.5 text-[14px] font-semibold text-white"
            style={{ background: 'var(--accent)' }}
          >
            Try again
          </button>
        </div>
      </Centered>
    )
  } else if (boot === 'loading') {
    body = <div className="h-full" />
  } else if (!profileId) {
    // Only with no backend, or a legacy shared session — see App.tsx.
    body = (
      <Centered>
        <ProfileSelect profiles={profiles} onSelect={(id) => void useProfile.getState().selectProfile(id)} />
      </Centered>
    )
  } else {
    body = <Shell />
  }

  return (
    <>
      {body}
      <PulseLayer />
      <Toaster
        position="bottom-right"
        toastOptions={{
          style: {
            background: 'var(--surface-3)',
            color: 'var(--text)',
            border: '1px solid var(--border)',
          },
        }}
      />
    </>
  )
}

/** The phone-sized screens (code, who's this), as a card in the middle. */
function Centered({ children }: { children: ReactNode }) {
  return (
    <div className="grid h-full place-items-center p-8" style={{ background: 'var(--bg)' }}>
      <div
        className="h-[560px] max-h-full w-[440px] max-w-full overflow-hidden rounded-[28px]"
        style={{ background: 'var(--surface)', border: '1px solid var(--border)', boxShadow: 'var(--shadow-lg)' }}
      >
        {children}
      </div>
    </div>
  )
}
