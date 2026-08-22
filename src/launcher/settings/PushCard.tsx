import { useEffect, useState } from 'react'
import { toast } from 'sonner'
import { Icon } from '@/components/primitives/Icon'
import { SettingsGroup, PrimaryButton } from './SettingsSheet'
import { enablePush, pushInstallHint, pushState, type PushState } from '@/lib/notifications'
import { sendTestPush } from '@/lib/pushDiagnostics'
import { useCurrentMember } from '@/store/useMember'
import { isNative } from '@/lib/platform'
import { fire } from '@/lib/haptics'

/**
 * Turning phone notifications on, and proving they arrive.
 *
 * This exists because of a failure that was invisible from inside the app: the
 * only control that registered a device for push lived several screens deep in
 * Things' own settings, and nothing ever prompted. A phone that had never been
 * through it simply had no row in `push_subscriptions` — so every notification
 * addressed to that person was computed correctly, counted as sent to zero
 * devices, and silently dropped. Nothing was broken; nobody had ever been asked.
 *
 * So the control is here, at the top of the launcher's own notification
 * settings, where someone wondering why nothing arrives will actually look.
 *
 * The prompt is behind a button and not on load, deliberately. A cold
 * permission request gets denied, and on iOS a denial can only be undone by
 * deleting and re-adding the Home Screen icon — an unrecoverable state to walk
 * someone into for the sake of saving one tap.
 */
export function PushCard() {
  const member = useCurrentMember()
  const [state, setState] = useState<PushState>('default')
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    setState(pushState())
  }, [])

  // Captured before the callbacks close over it, so TypeScript can see that the
  // early return below has already ruled out null.
  const profileId = member?.id ?? null
  const hint = pushInstallHint()

  async function turnOn() {
    if (!profileId) return
    setBusy(true)
    const next = await enablePush(profileId)
    setBusy(false)
    setState(next)

    if (next === 'granted') {
      fire('success')
      toast.success('Notifications are on for this device')
      return
    }
    fire('error')
    toast.error(
      next === 'denied'
        ? 'Your phone refused. Turn notifications on for Household in your phone settings.'
        : next === 'error'
          // The distinction that matters: permission was fine, the save wasn't,
          // so "check your phone settings" would be the wrong advice.
          ? "Your phone said yes but we couldn't save it — check your connection and try again"
          : 'That device cannot receive notifications',
    )
  }

  async function test() {
    if (!profileId) return
    setBusy(true)
    try {
      const { sent, devices } = await sendTestPush(profileId)
      fire(sent > 0 ? 'success' : 'warning')
      toast[sent > 0 ? 'success' : 'error'](
        sent > 0
          ? `Sent to ${sent} device${sent === 1 ? '' : 's'} — it should arrive now`
          : devices === 0
            ? 'No devices are registered for you yet. Tap "Turn on notifications" first.'
            // Registered but refused: the phone is known and the send was
            // rejected, which is a different problem from having no phone and
            // used to be reported with the same sentence.
            : `Your ${devices === 1 ? 'device is' : `${devices} devices are`} registered, but the server couldn't deliver. Run the check below.`,
      )
    } catch (err) {
      fire('error')
      toast.error(err instanceof Error ? err.message : "Couldn't send a test")
    } finally {
      setBusy(false)
    }
  }

  if (!profileId) return null

  // iOS in a Safari tab: asking would silently do nothing, so say what to do
  // instead of showing a button that cannot work.
  if (state === 'needs-install' || hint) {
    return (
      <SettingsGroup label="Phone notifications">
        <div className="flex items-start gap-3 px-3.5 py-3.5">
          <span className="mt-0.5 shrink-0" style={{ color: 'var(--warn)' }}>
            <Icon name="bell" size={17} />
          </span>
          <p className="text-[13px] leading-snug" style={{ color: 'var(--text-dim)' }}>
            Add Household to your Home Screen first, then open it from that icon.
            iPhone only delivers notifications to installed web apps, never to a
            Safari tab.
          </p>
        </div>
      </SettingsGroup>
    )
  }

  /*
    Android, built with no Firebase credentials.

    Shown rather than hidden, and worded as a setup step rather than a fault,
    because the phone is fine and there is nothing to fix on it. This is the
    state the crash used to live in: the button was offered, tapping it called
    into Firebase, and the app died on the spot with no message.
  */
  if (state === 'needs-fcm') {
    return (
      <SettingsGroup label="Phone notifications">
        <div className="flex items-start gap-3 px-3.5 py-3.5">
          <span className="mt-0.5 shrink-0" style={{ color: 'var(--warn)' }}>
            <Icon name="bell" size={17} />
          </span>
          <div className="min-w-0 flex-1">
            <p className="text-[13.5px] font-semibold">Not set up for this build</p>
            <p className="pt-1 text-[13px] leading-snug" style={{ color: 'var(--text-dim)' }}>
              The Android app needs a Firebase key before it can be sent
              anything, and this build doesn't have one. Everything else works —
              the badges and the notification centre still fill in whenever the
              app is open. Ask Claude to walk you through adding it; it is one
              file, added once.
            </p>
          </div>
        </div>
      </SettingsGroup>
    )
  }

  if (state === 'unsupported') {
    return (
      <SettingsGroup label="Phone notifications">
        <div className="px-3.5 py-3.5">
          <p className="text-[13px]" style={{ color: 'var(--text-dim)' }}>
            This browser can't receive notifications. The Android app and an
            installed iPhone web app both can.
          </p>
        </div>
      </SettingsGroup>
    )
  }

  const on = state === 'granted'

  return (
    <SettingsGroup
      label="Phone notifications"
      hint={
        on
          ? 'Send a test if you are not sure they are arriving — it ignores every setting below, so it tells you whether the pipe itself works.'
          : 'Until this is on, this phone gets nothing — the badges and the list below still work, but nothing reaches your lock screen.'
      }
    >
      <div className="flex items-center gap-3 px-3.5 py-3.5">
        <span
          className="grid h-9 w-9 shrink-0 place-items-center rounded-xl"
          style={{
            background: on ? 'var(--accent-soft)' : 'var(--surface-3)',
            color: on ? 'var(--accent-text)' : 'var(--text-faint)',
          }}
        >
          <Icon name="bell" size={18} />
        </span>
        <div className="min-w-0 flex-1">
          <div className="text-[14.5px] font-semibold">
            {on ? 'On for this device' : 'Off for this device'}
          </div>
          <div className="text-[12px]" style={{ color: 'var(--text-faint)' }}>
            {isNative() ? 'Android app' : 'Installed web app'}
            {state === 'denied' ? ' · your phone refused' : ''}
          </div>
        </div>
      </div>

      <div className="flex flex-col gap-2 px-3.5 pb-3.5">
        {!on && (
          <PrimaryButton onClick={() => void turnOn()} busy={busy}>
            Turn on notifications
          </PrimaryButton>
        )}
        <button
          onClick={() => void test()}
          disabled={busy}
          className="w-full rounded-2xl py-3 text-[13.5px] font-semibold disabled:opacity-40"
          style={{ background: 'var(--surface-3)', color: 'var(--text-dim)' }}
        >
          Send me a test
        </button>
        {state === 'denied' && (
          <p className="px-1 text-[11.5px] leading-snug" style={{ color: 'var(--text-faint)' }}>
            Your phone is blocking them. On Android: Settings → Apps → Household →
            Notifications. On iPhone the only fix is deleting the Home Screen icon
            and adding it again.
          </p>
        )}
      </div>
    </SettingsGroup>
  )
}
