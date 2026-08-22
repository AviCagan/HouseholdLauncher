import { motion } from 'motion/react'
import { Icon } from '@/components/primitives/Icon'
import { useCurrentMember, useTiles, useUnreadCount, type LauncherTile } from '@/store/useMember'
import { useLauncher } from '@/store/useLauncher'
import { fire } from '@/lib/haptics'
import { greeting } from '@/lib/time'

/**
 * The launcher home screen.
 *
 * Grid of the apps this member is allowed to see and hasn't hidden, each with
 * its unread badge. Hidden apps are filtered here rather than upstream so the
 * settings list can still show them with their switch off.
 */
export function Home() {
  const member = useCurrentMember()
  const tiles = useTiles()
  const unread = useUnreadCount()
  const { openApp, setInbox, openSettings } = useLauncher()

  const visible = tiles.filter((t) => !t.hidden)

  return (
    <div className="flex h-full flex-col">
      <header className="shrink-0 px-5 pb-4 pt-[max(var(--safe-top),1rem)]">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="text-[13px]" style={{ color: 'var(--text-faint)' }}>
              {greeting()}
            </p>
            <h1 className="truncate text-[27px] font-bold tracking-tight">
              {member?.display_name ?? 'Household'}
            </h1>
          </div>

          <div className="flex shrink-0 items-center gap-2 pt-1">
            <button
              onClick={() => {
                fire('tap')
                setInbox(true)
              }}
              aria-label={unread > 0 ? `Notifications, ${unread} unread` : 'Notifications'}
              className="relative grid h-10 w-10 place-items-center rounded-full"
              style={{
                background: 'var(--surface-2)',
                border: '1px solid var(--border)',
                color: 'var(--text-dim)',
              }}
            >
              <Icon name="bell" size={18} />
              {unread > 0 && (
                <span
                  className="absolute -right-0.5 -top-0.5 grid h-[19px] min-w-[19px] place-items-center rounded-full px-1 text-[10px] font-bold text-white"
                  style={{ background: 'var(--danger)', border: '2px solid var(--bg)' }}
                >
                  {unread > 99 ? '99+' : unread}
                </span>
              )}
            </button>

            <button
              onClick={() => {
                fire('tap')
                openSettings('general')
              }}
              aria-label="Settings"
              className="grid h-10 w-10 place-items-center rounded-full"
              style={{
                background: 'var(--surface-2)',
                border: '1px solid var(--border)',
                color: 'var(--text-dim)',
              }}
            >
              <Icon name="settings" size={18} />
            </button>
          </div>
        </div>
      </header>

      <div className="scroll-y min-h-0 flex-1 px-4 pb-10">
        {visible.length === 0 ? (
          <div className="grid place-items-center gap-3 px-8 py-20 text-center">
            <span style={{ color: 'var(--text-faint)', opacity: 0.5 }}>
              <Icon name="grid" size={34} />
            </span>
            <span className="text-[16px] font-semibold">No apps yet</span>
            <span className="max-w-[260px] text-[13px]" style={{ color: 'var(--text-faint)' }}>
              {tiles.length > 0
                ? 'Every app is hidden. Turn one back on in Settings → Apps.'
                : 'Ask Avi or Jackie to give you access to an app.'}
            </span>
          </div>
        ) : (
          <div className="grid grid-cols-2 gap-3">
            {visible.map((tile, i) => (
              <AppTile
                key={tile.app.id}
                tile={tile}
                index={i}
                onOpen={() => {
                  fire('tap')
                  openApp(tile.app.id)
                }}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

function AppTile({
  tile,
  index,
  onOpen,
}: {
  tile: LauncherTile
  index: number
  onOpen: () => void
}) {
  const { app, badge, supported } = tile

  return (
    <motion.button
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      // Staggered by position so the grid resolves as a wave rather than all
      // at once. Capped, or a long list makes the last tile arrive late enough
      // to look like a loading bug.
      transition={{ delay: Math.min(index * 0.04, 0.24), duration: 0.22 }}
      whileTap={{ scale: 0.96 }}
      onClick={onOpen}
      className="relative flex aspect-[1.15] flex-col justify-between overflow-hidden rounded-3xl p-4 text-left"
      style={{
        background: 'var(--surface)',
        border: '1px solid var(--border)',
        // Unsupported apps stay tappable: the screen inside explains why it
        // can't work here, which is more use than a tile that ignores taps.
        opacity: supported ? 1 : 0.62,
      }}
    >
      {/* Colour wash, keyed to the app rather than the theme accent, so the
          grid stays recognisable at a glance. */}
      <span
        aria-hidden
        className="pointer-events-none absolute -right-8 -top-10 h-28 w-28 rounded-full"
        style={{ background: app.color, opacity: 0.16, filter: 'blur(14px)' }}
      />

      <span
        className="grid h-11 w-11 place-items-center rounded-2xl"
        style={{
          background: `color-mix(in oklab, ${app.color} 20%, transparent)`,
          color: app.color,
        }}
      >
        <Icon name={app.icon} size={22} />
      </span>

      <span className="relative">
        <span className="block text-[15px] font-semibold leading-tight">{app.name}</span>
        <span
          className="mt-0.5 block text-[11.5px] leading-snug"
          style={{ color: 'var(--text-faint)' }}
        >
          {supported ? app.blurb : 'Android only'}
        </span>
      </span>

      {badge > 0 && (
        <span
          className="absolute right-3 top-3 grid h-[22px] min-w-[22px] place-items-center rounded-full px-1.5 text-[11px] font-bold text-white"
          style={{ background: 'var(--danger)' }}
        >
          {badge > 99 ? '99+' : badge}
        </span>
      )}
    </motion.button>
  )
}
