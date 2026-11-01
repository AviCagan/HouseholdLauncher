import { useEffect, useMemo } from 'react'
import { AnimatePresence, motion } from 'motion/react'
import { Icon, type IconName } from '@/components/primitives/Icon'
import { Avatar } from '@/components/primitives/ClaimChip'
import { useCurrentMember, useTiles, useUnreadCount, type LauncherTile } from '@/store/useMember'
import { useLauncher, type Screen } from '@/store/useLauncher'
import { fire } from '@/lib/haptics'
import { greeting } from '@/lib/time'
import { AppHost } from './AppHost'
import { Dashboard } from './Dashboard'

/**
 * The launcher on a laptop.
 *
 * A phone has one screen at a time, so the home grid and the app you opened
 * from it take turns. A laptop has room for both: the apps live in a sidebar
 * that never goes away, the open one fills the rest, and "home" is a
 * dashboard of what each app would tell you if you opened it. Every app's
 * own back button is hidden at this width because the sidebar is the way
 * between them.
 *
 * ⌥1–⌥9 jump to the apps in sidebar order and ⌥0 to the dashboard. Alt
 * rather than Ctrl/Cmd because those combinations already belong to the
 * browser — Cmd-1 is "first tab" in every one of them.
 */
export function DesktopShell({ screen }: { screen: Screen }) {
  const member = useCurrentMember()
  const tiles = useTiles()
  const unread = useUnreadCount()
  const inboxOpen = useLauncher((s) => s.inboxOpen)
  const settings = useLauncher((s) => s.settings)
  const openApp = useLauncher((s) => s.openApp)
  const goHome = useLauncher((s) => s.goHome)
  const setInbox = useLauncher((s) => s.setInbox)
  const openSettings = useLauncher((s) => s.openSettings)

  const visible = useMemo(() => tiles.filter((t) => !t.hidden), [tiles])
  const current = screen.kind === 'app' ? screen.appId : null

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!e.altKey || e.ctrlKey || e.metaKey) return
      const m = /^Digit(\d)$/.exec(e.code)
      if (!m) return
      const n = Number(m[1])
      if (n === 0) {
        e.preventDefault()
        goHome()
        return
      }
      const tile = visible[n - 1]
      if (!tile) return
      e.preventDefault()
      fire('tap')
      openApp(tile.app.id)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [visible, goHome, openApp])

  return (
    <div className="flex min-h-0 flex-1">
      <aside
        className="flex w-[236px] shrink-0 flex-col xl:w-[256px]"
        style={{ background: 'var(--surface)', borderRight: '1px solid var(--border)' }}
      >
        <div className="flex items-center gap-3 px-4 pb-4 pt-5">
          {member && <Avatar profile={member} size={38} />}
          <div className="min-w-0">
            <p className="text-[11.5px]" style={{ color: 'var(--text-faint)' }}>
              {greeting()}
            </p>
            <p className="truncate text-[16px] font-bold leading-tight">{member?.display_name ?? 'Household'}</p>
          </div>
        </div>

        <nav className="scroll-y min-h-0 flex-1 px-3" aria-label="Apps">
          <NavItem
            icon="grid"
            label="Home"
            active={current === null}
            hint="⌥0"
            onClick={() => {
              fire('tap')
              goHome()
            }}
          />

          <p
            className="px-3 pb-1.5 pt-4 text-[10.5px] font-semibold uppercase tracking-wider"
            style={{ color: 'var(--text-faint)' }}
          >
            Apps
          </p>
          {visible.length === 0 && (
            <p className="px-3 text-[12.5px] leading-snug" style={{ color: 'var(--text-faint)' }}>
              {tiles.length > 0 ? 'Every app is hidden — turn one on in Settings → Apps.' : 'No apps yet.'}
            </p>
          )}
          {visible.map((tile, i) => (
            <AppNavItem
              key={tile.app.id}
              tile={tile}
              active={current === tile.app.id}
              hint={i < 9 ? `⌥${i + 1}` : undefined}
              onClick={() => {
                fire('tap')
                openApp(tile.app.id)
              }}
            />
          ))}
        </nav>

        <div className="px-3 pb-4 pt-2" style={{ borderTop: '1px solid var(--border)' }}>
          <NavItem
            icon="bell"
            label="Notifications"
            badge={unread}
            active={inboxOpen}
            onClick={() => {
              fire('tap')
              setInbox(true)
            }}
          />
          <NavItem
            icon="settings"
            label="Settings"
            active={settings !== null}
            onClick={() => {
              fire('tap')
              openSettings('general')
            }}
          />
        </div>
      </aside>

      <main className="relative min-h-0 min-w-0 flex-1" style={{ background: 'var(--bg)' }}>
        <AnimatePresence mode="wait" initial={false}>
          <motion.div
            key={current ?? 'home'}
            className="h-full"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.14 }}
          >
            {current ? <AppHost appId={current} /> : <Dashboard />}
          </motion.div>
        </AnimatePresence>
      </main>
    </div>
  )
}

function NavItem({
  icon,
  label,
  active,
  badge = 0,
  hint,
  onClick,
}: {
  icon: IconName
  label: string
  active: boolean
  badge?: number
  hint?: string
  onClick: () => void
}) {
  return (
    <button
      onClick={onClick}
      aria-current={active ? 'page' : undefined}
      title={hint}
      className="desk-nav flex w-full items-center gap-3 rounded-xl px-3 py-2 text-left text-[14px] font-semibold"
      style={{
        background: active ? 'var(--accent-soft)' : undefined,
        color: active ? 'var(--accent-text)' : 'var(--text-dim)',
      }}
    >
      <Icon name={icon} size={18} strokeWidth={2.2} />
      <span className="min-w-0 flex-1 truncate">{label}</span>
      {badge > 0 && <Badge n={badge} />}
    </button>
  )
}

function AppNavItem({
  tile,
  active,
  hint,
  onClick,
}: {
  tile: LauncherTile
  active: boolean
  hint?: string
  onClick: () => void
}) {
  const { app, badge, supported } = tile
  return (
    <button
      onClick={onClick}
      aria-current={active ? 'page' : undefined}
      title={supported ? hint : 'Android only'}
      className="desk-nav flex w-full items-center gap-3 rounded-xl px-2.5 py-2 text-left"
      style={{
        background: active ? 'var(--accent-soft)' : undefined,
        opacity: supported ? 1 : 0.55,
      }}
    >
      <span
        className="grid h-8 w-8 shrink-0 place-items-center rounded-[10px]"
        style={{ background: `color-mix(in oklab, ${app.color} 20%, transparent)`, color: app.color }}
      >
        {app.logo ? <app.logo size={24} /> : <Icon name={app.icon} size={17} />}
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[14px] font-semibold" style={{ color: active ? 'var(--text)' : 'var(--text-dim)' }}>
          {app.name}
        </span>
      </span>
      {badge > 0 && <Badge n={badge} />}
    </button>
  )
}

function Badge({ n }: { n: number }) {
  return (
    <span
      className="grid h-[19px] min-w-[19px] shrink-0 place-items-center rounded-full px-1.5 text-[10.5px] font-bold text-white"
      style={{ background: 'var(--danger)' }}
    >
      {n > 99 ? '99+' : n}
    </span>
  )
}
