import { useEffect, useState } from 'react'
import { AnimatePresence, motion } from 'motion/react'
import { Icon } from '@/components/primitives/Icon'
import { Avatar } from '@/components/primitives/ClaimChip'
import { NotificationCenter } from '@/launcher/NotificationCenter'
import { SettingsSheet } from '@/launcher/settings/SettingsSheet'
import { useCurrentMember, useTiles, useUnreadCount, type LauncherTile } from '@/store/useMember'
import { useLauncher } from '@/store/useLauncher'
import { useData } from '@/store/useData'
import { greeting } from '@/lib/time'
import { isConfigured } from '@/lib/env'
import { phonePageUrl, rememberLayout } from '@/lib/layoutChoice'
import { LAYER, useKeys, type Binding } from './keys'
import { APP_KEYS } from './appKeys'
import { Kbd } from './ui'
import { usePersisted } from './persisted'
import { CommandPalette } from './CommandPalette'
import { ShortcutHelp } from './ShortcutHelp'
import { DeskAppHost } from './DeskAppHost'

/**
 * The laptop page's frame: a sidebar of apps down the left, the open app
 * filling the rest.
 *
 * The phone launcher is a home grid you leave to enter an app and return to
 * on the way to the next. On a laptop that round trip is pure friction — the
 * screen has room to keep every app one click away at all times, so the grid
 * becomes the sidebar and "home" becomes an overview of what's going on
 * across all of them.
 *
 * Everything that overlays the page — notifications, settings, the command
 * palette, the shortcut sheet — is mounted here once, for every app.
 */
export function Shell() {
  const screen = useLauncher((s) => s.screen)
  const { openApp, goHome, setInbox, openSettings } = useLauncher()
  const tiles = useTiles()
  const visible = tiles.filter((t) => !t.hidden)
  const [narrow, setNarrow] = usePersisted('desk:sidebar-narrow', false)
  const [palette, setPalette] = useState(false)
  const [help, setHelp] = useState(false)

  const bindings: Binding[] = [
    {
      keys: 'mod+k',
      run: () => setPalette((o) => !o),
      label: 'Search everything, or add something',
      group: 'Anywhere',
      inInputs: true,
    },
    { keys: '?', run: () => setHelp(true), label: 'Show keyboard shortcuts', group: 'Anywhere' },
    { keys: '\\', run: () => setNarrow((n) => !n), label: 'Narrow or widen the sidebar', group: 'Anywhere' },
    { keys: 'g h', run: goHome, label: 'Overview', group: 'Go to' },
    ...visible
      .filter((t) => APP_KEYS[t.app.id])
      .map<Binding>((t) => ({
        keys: `g ${APP_KEYS[t.app.id]}`,
        run: () => openApp(t.app.id),
        label: t.app.name,
        group: 'Go to',
      })),
    { keys: 'g i', run: () => setInbox(true), label: 'Notifications', group: 'Go to' },
    { keys: 'g s', run: () => openSettings('general'), label: 'Settings', group: 'Go to' },
  ]
  useKeys(bindings, LAYER.shell)

  const activeId = screen.kind === 'app' ? screen.appId : null

  return (
    <div className="flex h-full overflow-hidden" style={{ background: 'var(--bg)' }}>
      <Sidebar
        narrow={narrow}
        tiles={visible}
        activeId={activeId}
        onHome={goHome}
        onOpen={(id) => openApp(id)}
        onSearch={() => setPalette(true)}
        onHelp={() => setHelp(true)}
        onToggleNarrow={() => setNarrow((n) => !n)}
      />

      <main className="relative min-w-0 flex-1 overflow-hidden">
        <NarrowWindowNotice />
        <AnimatePresence mode="wait" initial={false}>
          <motion.div
            key={activeId ?? 'home'}
            className="h-full"
            // Opacity only. A transform on this wrapper would become the
            // containing block for every position:fixed dialog inside the app,
            // pinning them to the main pane instead of the window.
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.12 }}
          >
            <DeskAppHost screen={screen} onOpenPalette={() => setPalette(true)} />
          </motion.div>
        </AnimatePresence>
      </main>

      <NotificationCenter />
      <SettingsSheet />
      <CommandPalette open={palette} onClose={() => setPalette(false)} />
      <ShortcutHelp open={help} onClose={() => setHelp(false)} />
    </div>
  )
}

function Sidebar({
  narrow,
  tiles,
  activeId,
  onHome,
  onOpen,
  onSearch,
  onHelp,
  onToggleNarrow,
}: {
  narrow: boolean
  tiles: LauncherTile[]
  activeId: string | null
  onHome: () => void
  onOpen: (id: string) => void
  onSearch: () => void
  onHelp: () => void
  onToggleNarrow: () => void
}) {
  const member = useCurrentMember()
  const unread = useUnreadCount()
  const setInbox = useLauncher((s) => s.setInbox)
  const openSettings = useLauncher((s) => s.openSettings)

  return (
    <aside
      className="desk-sidebar flex shrink-0 flex-col"
      style={{ width: narrow ? 68 : 248, transition: 'width 160ms ease' }}
      aria-label="Apps"
    >
      <div className={`flex items-center gap-2.5 pb-3 pt-4 ${narrow ? 'justify-center px-2' : 'px-4'}`}>
        <img src={`${import.meta.env.BASE_URL}icons/icon-192.png`} alt="" className="h-9 w-9 shrink-0 rounded-[10px]" />
        {!narrow && (
          <div className="min-w-0 flex-1">
            <p className="text-[11.5px] leading-tight" style={{ color: 'var(--text-faint)' }}>
              {greeting()}
            </p>
            <p className="truncate text-[15px] font-bold leading-tight">{member?.display_name ?? 'Household'}</p>
          </div>
        )}
      </div>

      <div className={narrow ? 'px-2' : 'px-3'}>
        <button
          onClick={onSearch}
          className="desk-hover flex h-9 w-full items-center gap-2 rounded-xl px-2.5 text-[13px]"
          style={{ background: 'var(--surface-2)', border: '1px solid var(--border)', color: 'var(--text-faint)' }}
          title="Search everything (⌘K)"
          aria-label="Search everything"
        >
          <Icon name="search" size={15} />
          {!narrow && (
            <>
              <span className="flex-1 text-left">Search or add…</span>
              <Kbd combo="mod+k" />
            </>
          )}
        </button>
      </div>

      <nav className={`desk-scroll mt-3 flex min-h-0 flex-1 flex-col gap-0.5 overflow-y-auto ${narrow ? 'px-2' : 'px-3'}`}>
        <NavItem
          narrow={narrow}
          active={activeId === null}
          onClick={onHome}
          label="Overview"
          combo="g h"
          glyph={
            <span className="grid h-7 w-7 place-items-center rounded-lg" style={{ background: 'var(--surface-3)', color: 'var(--text-dim)' }}>
              <Icon name="home" size={15} />
            </span>
          }
        />
        {!narrow && (
          <p className="px-2.5 pb-1 pt-4 text-[11px] font-semibold uppercase tracking-wide" style={{ color: 'var(--text-faint)' }}>
            Apps
          </p>
        )}
        {narrow && <div className="my-2 h-px" style={{ background: 'var(--border)' }} />}
        {tiles.map((t) => (
          <NavItem
            key={t.app.id}
            narrow={narrow}
            active={activeId === t.app.id}
            onClick={() => onOpen(t.app.id)}
            label={t.app.name}
            sub={t.supported ? undefined : 'Android only'}
            combo={APP_KEYS[t.app.id] ? `g ${APP_KEYS[t.app.id]}` : undefined}
            badge={t.badge}
            dim={!t.supported}
            glyph={
              <span
                className="grid h-7 w-7 place-items-center rounded-lg"
                style={{ background: `color-mix(in oklab, ${t.app.color} 20%, transparent)`, color: t.app.color }}
              >
                {t.app.logo ? <t.app.logo size={20} /> : <Icon name={t.app.icon} size={15} strokeWidth={2.2} />}
              </span>
            }
          />
        ))}
        {tiles.length === 0 && !narrow && (
          <p className="px-2.5 py-2 text-[12.5px]" style={{ color: 'var(--text-faint)' }}>
            No apps yet. Ask Avi or Jackie to give you access to one.
          </p>
        )}
      </nav>

      <div className={`flex flex-col gap-0.5 pb-3 pt-2 ${narrow ? 'px-2' : 'px-3'}`} style={{ borderTop: '1px solid var(--border)' }}>
        <NavItem
          narrow={narrow}
          onClick={() => setInbox(true)}
          label="Notifications"
          combo="g i"
          badge={unread}
          glyph={<Glyph icon="bell" />}
        />
        <NavItem narrow={narrow} onClick={() => openSettings('general')} label="Settings" combo="g s" glyph={<Glyph icon="settings" />} />
        <NavItem narrow={narrow} onClick={onHelp} label="Keyboard shortcuts" combo="?" glyph={<Glyph icon="keyboard" />} />
        <NavItem
          narrow={narrow}
          onClick={() => {
            rememberLayout('phone')
            window.location.href = phonePageUrl()
          }}
          label="Phone layout"
          glyph={<Glyph icon="phone" />}
        />
        <div className={`mt-2 flex items-center gap-2 ${narrow ? 'flex-col' : 'px-1'}`}>
          {member && (
            <span className="shrink-0" title={member.display_name}>
              <Avatar profile={member} size={26} />
            </span>
          )}
          {!narrow && <Connection />}
          <button
            onClick={onToggleNarrow}
            aria-label={narrow ? 'Widen the sidebar' : 'Narrow the sidebar'}
            title={`${narrow ? 'Widen' : 'Narrow'} the sidebar (\\)`}
            className="desk-hover grid h-7 w-7 shrink-0 place-items-center rounded-lg"
            style={{ color: 'var(--text-faint)' }}
          >
            <Icon name="sidebar" size={15} />
          </button>
        </div>
      </div>
    </aside>
  )
}

function Glyph({ icon }: { icon: Parameters<typeof Icon>[0]['name'] }) {
  return (
    <span className="grid h-7 w-7 place-items-center rounded-lg" style={{ color: 'var(--text-dim)' }}>
      <Icon name={icon} size={16} />
    </span>
  )
}

function NavItem({
  narrow,
  active = false,
  onClick,
  label,
  sub,
  combo,
  badge,
  dim = false,
  glyph,
}: {
  narrow: boolean
  active?: boolean
  onClick: () => void
  label: string
  sub?: string
  combo?: string
  badge?: number
  dim?: boolean
  glyph: React.ReactNode
}) {
  return (
    <button
      onClick={onClick}
      className={`desk-nav-item ${narrow ? 'justify-center !px-0' : ''}`}
      data-active={active || undefined}
      aria-current={active ? 'page' : undefined}
      aria-label={badge ? `${label}, ${badge} unread` : label}
      title={narrow ? label : undefined}
      style={{ opacity: dim ? 0.6 : 1 }}
    >
      <span className="relative shrink-0">
        {glyph}
        {narrow && badge !== undefined && badge > 0 && (
          <span
            className="absolute -right-1.5 -top-1.5 grid h-[17px] min-w-[17px] place-items-center rounded-full px-1 text-[9.5px] font-bold text-white"
            style={{ background: 'var(--danger)', border: '2px solid var(--surface)' }}
          >
            {badge > 99 ? '99+' : badge}
          </span>
        )}
      </span>
      {!narrow && (
        <>
          <span className="min-w-0 flex-1">
            <span className="block truncate leading-tight">{label}</span>
            {sub && (
              <span className="block truncate text-[11px] font-medium leading-tight" style={{ color: 'var(--text-faint)' }}>
                {sub}
              </span>
            )}
          </span>
          {badge !== undefined && badge > 0 ? (
            <span
              className="grid h-[20px] min-w-[20px] place-items-center rounded-full px-1.5 text-[10.5px] font-bold text-white"
              style={{ background: 'var(--danger)' }}
            >
              {badge > 99 ? '99+' : badge}
            </span>
          ) : (
            combo && <Kbd combo={combo} className="desk-nav-hint" />
          )}
        </>
      )}
    </button>
  )
}

/** Live, offline, or never connected — and how much is waiting to go up. */
function Connection() {
  const connection = useData((s) => s.connection)
  const pending = useData((s) => s.pendingCount)
  const [online, setOnline] = useState(() => (typeof navigator === 'undefined' ? true : navigator.onLine))

  useEffect(() => {
    const up = () => setOnline(true)
    const down = () => setOnline(false)
    window.addEventListener('online', up)
    window.addEventListener('offline', down)
    return () => {
      window.removeEventListener('online', up)
      window.removeEventListener('offline', down)
    }
  }, [])

  const state = !isConfigured() || connection === 'local' ? 'local' : !online || connection === 'offline' ? 'offline' : 'live'
  const meta = {
    live: { color: 'var(--ok)', label: 'Live' },
    offline: { color: 'var(--warn)', label: pending > 0 ? `Offline · ${pending} to sync` : 'Offline' },
    local: { color: 'var(--text-faint)', label: 'This browser only' },
  }[state]

  return (
    <span className="flex min-w-0 flex-1 items-center gap-1.5 text-[11.5px] font-medium" style={{ color: 'var(--text-faint)' }}>
      <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: meta.color }} />
      <span className="truncate">{meta.label}</span>
    </span>
  )
}

/**
 * The laptop layout squeezed into a phone-width window doesn't work, and
 * pretending otherwise helps nobody. Say so, and offer the layout that does.
 */
function NarrowWindowNotice() {
  const [width, setWidth] = useState(() => window.innerWidth)
  const [dismissed, setDismissed] = useState(false)

  useEffect(() => {
    const onResize = () => setWidth(window.innerWidth)
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [])

  if (width >= 760 || dismissed) return null
  return (
    <div
      className="absolute inset-x-3 top-3 z-[60] flex items-center gap-2 rounded-2xl px-3.5 py-2.5 text-[13px]"
      style={{ background: 'var(--surface-3)', border: '1px solid var(--border)', boxShadow: 'var(--shadow-lg)' }}
    >
      <Icon name="phone" size={16} />
      <span className="min-w-0 flex-1">This is the laptop layout, and the window is narrow.</span>
      <a
        href={phonePageUrl()}
        onClick={() => rememberLayout('phone')}
        className="shrink-0 rounded-full px-3 py-1.5 text-[12.5px] font-semibold text-white"
        style={{ background: 'var(--accent)' }}
      >
        Phone layout
      </a>
      <button
        onClick={() => setDismissed(true)}
        aria-label="Dismiss"
        className="grid h-7 w-7 place-items-center rounded-full"
        style={{ color: 'var(--text-faint)' }}
      >
        <Icon name="close" size={14} />
      </button>
    </div>
  )
}
