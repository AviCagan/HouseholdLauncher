import { Icon } from '@/components/primitives/Icon'
import { SettingsGroup, Toggle } from './SettingsSheet'
import { APPS } from '@/launcher/registry'
import { setNotifyPref, useCurrentMember, useHasApp } from '@/store/useMember'
import { useData } from '@/store/useData'
import { DEFAULT_NOTIFY_PREF } from '@/store/useMember'
import { fire } from '@/lib/haptics'
import type { AppNotifyPref } from '@/data/types'

/**
 * Per-app notification behaviour.
 *
 * The reason notifications route through the launcher instead of each app
 * talking to the OS: a chore going overdue and a $200 debt being marked paid
 * should not arrive looking or feeling identical, and only something that sees
 * every app at once can offer that as one screen.
 *
 * Two switches per app, not one. "Show it in the launcher but don't buzz my
 * phone" is the setting people actually want, and a single toggle can't say
 * it — so `enabled` controls the badge and the notification centre entry, and
 * `push` controls whether it leaves the app at all.
 */
export function NotificationSettings() {
  const member = useCurrentMember()
  if (!member) return null

  return (
    <>
      {APPS.map((app) => (
        <AppNotifyCard key={app.id} appId={app.id} />
      ))}

      <p className="px-1 pt-1 text-[11.5px] leading-snug" style={{ color: 'var(--text-faint)' }}>
        Phone notifications also need permission from Android or iOS itself. If nothing
        arrives with these on, check the launcher's notification permission in your
        phone's settings.
      </p>
    </>
  )
}

function AppNotifyCard({ appId }: { appId: string }) {
  const member = useCurrentMember()
  const allowed = useHasApp(appId)
  const prefs = useData((s) => s.app_notify_prefs)
  const app = APPS.find((a) => a.id === appId)

  // An app you can't open has nothing to notify you about, so it isn't listed
  // at all rather than listed with dead switches.
  if (!member || !app || !allowed) return null

  const pref: AppNotifyPref =
    prefs.find((p) => p.profile_id === member.id && p.app_id === appId) ??
    DEFAULT_NOTIFY_PREF(member.id, appId)

  const update = (patch: Partial<AppNotifyPref>) => void setNotifyPref(member.id, appId, patch)

  return (
    <SettingsGroup>
      <div className="flex items-center gap-3 px-3.5 py-3" style={{ borderBottom: '1px solid var(--border)' }}>
        <span
          className="grid h-8 w-8 shrink-0 place-items-center rounded-lg"
          style={{
            background: `color-mix(in oklab, ${app.color} 18%, transparent)`,
            color: app.color,
          }}
        >
          <Icon name={app.icon} size={16} />
        </span>
        <span className="flex-1 text-[14.5px] font-semibold">{app.name}</span>
        <Toggle
          on={pref.enabled}
          label={`Notifications from ${app.name}`}
          onChange={(next) => update({ enabled: next })}
        />
      </div>

      {pref.enabled && (
        <>
          <div
            className="flex items-center gap-3 px-3.5 py-2.5"
            style={{ borderBottom: '1px solid var(--border)' }}
          >
            <span className="flex-1 text-[13.5px]" style={{ color: 'var(--text-dim)' }}>
              Send to my phone
            </span>
            <Toggle
              on={pref.push}
              label={`Push ${app.name} to my phone`}
              onChange={(next) => update({ push: next })}
            />
          </div>

          <div className="px-3.5 py-2.5">
            <p className="pb-1.5 text-[13.5px]" style={{ color: 'var(--text-dim)' }}>
              Vibration
            </p>
            <div className="flex gap-1.5">
              {(['off', 'subtle', 'normal', 'heavy'] as const).map((level) => (
                <button
                  key={level}
                  onClick={() => {
                    fire(level === 'off' ? 'toggleOff' : 'tap')
                    update({ haptic: level })
                  }}
                  className="flex-1 rounded-xl py-2 text-[12px] font-semibold capitalize"
                  style={{
                    background: pref.haptic === level ? 'var(--accent)' : 'var(--surface-3)',
                    color: pref.haptic === level ? '#fff' : 'var(--text-dim)',
                  }}
                >
                  {level}
                </button>
              ))}
            </div>
          </div>
        </>
      )}
    </SettingsGroup>
  )
}
