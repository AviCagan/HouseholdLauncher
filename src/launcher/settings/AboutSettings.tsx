import { SettingsGroup, SettingsRow } from './SettingsSheet'
import { APPS } from '@/launcher/registry'
import { useData } from '@/store/useData'
import { isConfigured } from '@/lib/env'
import { hapticBackend, HAPTIC_BACKEND_LABEL } from '@/lib/haptics'
import { isNative } from '@/lib/platform'

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

      <SettingsGroup label="This build">
        <SettingsRow
          title="Version"
          subtitle={
            __BUILD_RUN__ ? `Build ${__BUILD_RUN__} · ${__BUILD_SHA__}` : `Local build · ${__BUILD_SHA__}`
          }
        />
        <SettingsRow title="Built" subtitle={new Date(__BUILD_TIME__).toLocaleString()} />
        <SettingsRow title="Running as" subtitle={isNative() ? 'Android app' : 'Web app'} />
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
