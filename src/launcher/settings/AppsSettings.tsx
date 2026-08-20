import { SettingsGroup, SettingsRow, Toggle } from './SettingsSheet'
import { setAppHidden, useCurrentMember, useTiles } from '@/store/useMember'

/**
 * Which apps appear on your home screen.
 *
 * Only apps you have access to are listed — an app you were never granted is
 * not "hidden", it is not yours, and showing it here with a switch would
 * advertise something that turning the switch on cannot deliver.
 *
 * This is per-person. Jackie hiding Bluetooth on her phone does not take it
 * off Avi's.
 */
export function AppsSettings() {
  const member = useCurrentMember()
  const tiles = useTiles()

  if (!member) return null

  return (
    <>
      <SettingsGroup
        label="On your home screen"
        hint="Hiding an app only affects your phone. It stays available to everyone else who has access."
      >
        {tiles.map((tile) => (
          <SettingsRow
            key={tile.app.id}
            icon={tile.app.icon}
            tint={tile.app.color}
            title={tile.app.name}
            subtitle={tile.supported ? tile.app.blurb : 'Android only — hidden automatically on this device'}
            right={
              <Toggle
                on={!tile.hidden}
                label={`Show ${tile.app.name}`}
                // A switch that cannot change anything is worse than no switch:
                // the app is unusable here regardless of where it points.
                disabled={!tile.supported}
                onChange={(next) => void setAppHidden(member.id, tile.app.id, !next)}
              />
            }
          />
        ))}
      </SettingsGroup>

      {tiles.length === 0 && (
        <p className="px-1 text-[13px]" style={{ color: 'var(--text-faint)' }}>
          You don't have access to any apps yet. Ask Avi or Jackie.
        </p>
      )}
    </>
  )
}
