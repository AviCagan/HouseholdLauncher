import { useEffect, useState } from 'react'
import { SettingsGroup, SettingsRow } from './SettingsSheet'
import { APPS } from '@/launcher/registry'
import { useData } from '@/store/useData'
import { isConfigured } from '@/lib/env'
import { hapticBackend, HAPTIC_BACKEND_LABEL } from '@/lib/haptics'
import { isNative } from '@/lib/platform'
import { nativeVersion } from '@/lib/build'
import { applyNow, checkForUpdate, downloadApk, useAppUpdate, type UpdateStatus } from '@/lib/appUpdate'
import { fire } from '@/lib/haptics'

/**
 * What's actually installed and what it's talking to.
 *
 * This exists because of a real support dead-end: someone installs an APK,
 * says a feature is missing, and neither of you can tell whether the build is
 * stale or the feature is somewhere else. The build stamp settles it in one
 * look.
 */
export function AboutSettings() {
  const connection = useData((s) => s.connection)
  const pending = useData((s) => s.pendingCount)
  const missing = useData((s) => s.missingTables)

  /*
    Android's own version, which is not the same fact as the bundle stamp
    below it. A JS bundle updates over the air; the APK only changes when a new
    one is actually installed. When these two disagree, the install didn't
    take — which is the single most useful thing to know when a feature is
    "missing" right after an update.
  */
  const [nativeVer, setNativeVer] = useState<string | null>(null)
  useEffect(() => {
    void nativeVersion().then(setNativeVer)
  }, [])

  const connectionLabel = !isConfigured()
    ? 'On this device only'
    : connection === 'live'
      ? 'Syncing'
      : connection === 'offline'
        ? `Offline${pending > 0 ? ` · ${pending} waiting to send` : ''}`
        : 'Starting up'

  return (
    <>
      {/*
        Shown only when the backend is behind the app. Named plainly rather
        than as an error, because nothing is broken — the SQL just hasn't been
        run, and until it is these features have nowhere to store anything.
      */}
      {missing.length > 0 && (
        <SettingsGroup
          label="Setup unfinished"
          hint="Open your Supabase project → SQL Editor, paste in supabase/015_launcher.sql from the repo, and press Run. Safe to run twice."
        >
          <SettingsRow
            icon="lock"
            tint="var(--warn)"
            title="The database is missing some tables"
            subtitle={`Until the migration runs, these won't save: ${missing.join(', ')}`}
          />
        </SettingsGroup>
      )}

      {isNative() && <UpdatesGroup />}

      <SettingsGroup label="This build">
        <SettingsRow
          title="Version"
          subtitle={
            __BUILD_RUN__ ? `Build ${__BUILD_RUN__} · ${__BUILD_SHA__}` : `Local build · ${__BUILD_SHA__}`
          }
        />
        <SettingsRow title="Built" subtitle={new Date(__BUILD_TIME__).toLocaleString()} />
        <SettingsRow
          title="Running as"
          subtitle={
            isNative()
              ? `Android app${nativeVer ? ` · ${nativeVer}` : ''}`
              : 'Web app'
          }
        />
        <SettingsRow title="Connection" subtitle={connectionLabel} />
        <SettingsRow title="Haptics" subtitle={HAPTIC_BACKEND_LABEL[hapticBackend()]} />
      </SettingsGroup>

      <SettingsGroup label={`Apps installed · ${APPS.length}`}>
        {APPS.map((app) => (
          <SettingsRow
            key={app.id}
            icon={app.icon}
            tint={app.color}
            title={app.name}
            subtitle={app.platforms.join(' · ')}
          />
        ))}
      </SettingsGroup>
    </>
  )
}

/**
 * Where the Android app stands against the newest build. Updates happen on
 * their own (see lib/appUpdate.ts); this says what's going on and lets you
 * hurry it along.
 */
function UpdatesGroup() {
  const status = useAppUpdate((s) => s.status)
  const [checking, setChecking] = useState(false)
  const { title, subtitle } = describe(status)

  const button = (label: string, onClick: () => void) => (
    <button
      onClick={() => {
        fire('tap')
        onClick()
      }}
      className="rounded-full px-3.5 py-1.5 text-[12.5px] font-semibold text-white"
      style={{ background: 'var(--accent)' }}
    >
      {label}
    </button>
  )

  return (
    <SettingsGroup label="Updates" hint="New versions arrive on their own: they download in the background and go in the next time you open the app, or when you come back to it after an hour away.">
      <SettingsRow
        icon="sparkle"
        title={title}
        subtitle={subtitle}
        right={
          status.kind === 'ready'
            ? button('Restart now', () => void applyNow())
            : status.kind === 'apk'
              ? button('Download', () => void downloadApk())
              : undefined
        }
      />
      <SettingsRow
        icon="repeat"
        title={checking || status.kind === 'checking' ? 'Checking…' : 'Check now'}
        onClick={() => {
          if (checking) return
          fire('tap')
          setChecking(true)
          void checkForUpdate({ manual: true }).finally(() => setChecking(false))
        }}
      />
    </SettingsGroup>
  )
}

function describe(status: UpdateStatus): { title: string; subtitle?: string } {
  const at = (t: number) => new Date(t).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })
  switch (status.kind) {
    case 'idle':
    case 'checking':
      return { title: 'Looking for updates…' }
    case 'current':
      return { title: 'Up to date', subtitle: `Checked at ${at(status.checkedAt)}` }
    case 'downloading':
      return { title: `Downloading build ${status.latest.versionCode}…`, subtitle: `${Math.round(status.percent)}%` }
    case 'ready':
      return { title: `Build ${status.latest.versionCode} is ready`, subtitle: 'It goes in the next time you open the app.' }
    case 'apk':
      return {
        title: `Build ${status.latest.versionCode} needs a fresh install`,
        subtitle: 'The app itself changed, so this one is a new APK. It installs over the top and keeps everything.',
      }
    case 'error':
      return { title: "Couldn't check for updates", subtitle: `${status.message} · tried at ${at(status.checkedAt)}` }
  }
}
