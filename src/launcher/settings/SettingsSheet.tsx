import { AnimatePresence, motion } from 'motion/react'
import { Sheet } from '@/components/primitives/Sheet'
import { Icon, type IconName } from '@/components/primitives/Icon'
import { useLauncher, type SettingsSection } from '@/store/useLauncher'
import { useIsOwner } from '@/store/useMember'
import { GeneralSettings } from './GeneralSettings'
import { AppsSettings } from './AppsSettings'
import { PeopleSettings } from './PeopleSettings'
import { NotificationSettings } from './NotificationSettings'
import { AboutSettings } from './AboutSettings'
import { fire } from '@/lib/haptics'

/**
 * The launcher's settings.
 *
 * One sheet with a tab rail rather than a stack of nested screens: there are
 * five sections and they are jumped between constantly while setting someone
 * up — hand out a code in People, tick the apps they get, check how it looks
 * in Apps — and a push/pop hierarchy turns each of those into three taps.
 *
 * What is in here is only what the launcher owns: who you are, the code you
 * sign in with, how everything looks and feels, who else is in the household
 * and what they can open, and whether your phone gets notified. Anything that
 * changes one app and one app only — Things' home address, its calendar feed,
 * its voice links — lives behind that app's own gear, because a setting you
 * reach by opening Things should not silently be a setting for Owe as well.
 */

const SECTIONS: { id: SettingsSection; label: string; icon: IconName; ownerOnly?: boolean }[] = [
  { id: 'general', label: 'General', icon: 'settings' },
  { id: 'apps', label: 'Apps', icon: 'grid' },
  { id: 'people', label: 'People', icon: 'people', ownerOnly: true },
  { id: 'notifications', label: 'Alerts', icon: 'bell' },
  { id: 'about', label: 'About', icon: 'sparkle' },
]

export function SettingsSheet() {
  const section = useLauncher((s) => s.settings)
  const openSettings = useLauncher((s) => s.openSettings)
  const closeSettings = useLauncher((s) => s.closeSettings)
  const isOwner = useIsOwner()

  const visible = SECTIONS.filter((s) => !s.ownerOnly || isOwner)

  return (
    <>
      <Sheet
        open={section !== null}
        onClose={closeSettings}
        height="88vh"
        title={<span className="text-[17px] font-bold">Settings</span>}
      >
        <div
          className="scroll-x sticky top-0 z-10 -mx-4 mb-3 flex gap-1.5 px-4 pb-2"
          style={{ background: 'var(--bg-elevated)' }}
        >
          {visible.map((tab) => {
            const active = tab.id === section
            return (
              <button
                key={tab.id}
                onClick={() => {
                  if (active) return
                  fire('snap')
                  openSettings(tab.id)
                }}
                className="flex shrink-0 items-center gap-1.5 rounded-full px-3.5 py-2 text-[13px] font-semibold"
                style={{
                  background: active ? 'var(--accent)' : 'var(--surface-2)',
                  color: active ? '#fff' : 'var(--text-dim)',
                  border: '1px solid var(--border)',
                }}
              >
                <Icon name={tab.icon} size={14} />
                {tab.label}
              </button>
            )
          })}
        </div>

        <AnimatePresence mode="wait" initial={false}>
          <motion.div
            key={section ?? 'none'}
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -6 }}
            transition={{ duration: 0.15 }}
            className="pb-6"
          >
            {section === 'general' && <GeneralSettings />}
            {section === 'apps' && <AppsSettings />}
            {section === 'people' && isOwner && <PeopleSettings />}
            {section === 'notifications' && <NotificationSettings />}
            {section === 'about' && <AboutSettings />}
          </motion.div>
        </AnimatePresence>
      </Sheet>
    </>
  )
}

// --- shared building blocks -------------------------------------------------

export function SettingsGroup({
  label,
  hint,
  children,
}: {
  label?: string
  hint?: string
  children: React.ReactNode
}) {
  return (
    <div className="mb-4">
      {label && (
        <p
          className="px-1 pb-1.5 text-[11px] font-semibold uppercase tracking-wide"
          style={{ color: 'var(--text-faint)' }}
        >
          {label}
        </p>
      )}
      <div
        className="overflow-hidden rounded-2xl"
        style={{ background: 'var(--surface-2)', border: '1px solid var(--border)' }}
      >
        {children}
      </div>
      {hint && (
        <p className="px-1 pt-1.5 text-[11.5px] leading-snug" style={{ color: 'var(--text-faint)' }}>
          {hint}
        </p>
      )}
    </div>
  )
}

export function SettingsRow({
  icon,
  title,
  subtitle,
  right,
  onClick,
  tint,
}: {
  icon?: IconName
  title: React.ReactNode
  subtitle?: React.ReactNode
  right?: React.ReactNode
  onClick?: () => void
  tint?: string
}) {
  const Element = onClick ? 'button' : 'div'
  return (
    <Element
      onClick={onClick}
      className="flex w-full items-center gap-3 px-3.5 py-3 text-left"
      style={{ borderBottom: '1px solid var(--border)' }}
    >
      {icon && (
        <span
          className="grid h-8 w-8 shrink-0 place-items-center rounded-lg"
          style={{
            background: `color-mix(in oklab, ${tint ?? 'var(--accent)'} 18%, transparent)`,
            color: tint ?? 'var(--accent)',
          }}
        >
          <Icon name={icon} size={16} />
        </span>
      )}
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[14.5px] font-medium">{title}</span>
        {subtitle && (
          <span
            className="mt-0.5 block text-[12px] leading-snug"
            style={{ color: 'var(--text-faint)' }}
          >
            {subtitle}
          </span>
        )}
      </span>
      {right && <span className="shrink-0">{right}</span>}
    </Element>
  )
}

/** iOS-style switch. The whole row is usually the tap target, not just this. */
export function Toggle({
  on,
  onChange,
  label,
  disabled = false,
}: {
  on: boolean
  onChange: (next: boolean) => void
  label: string
  disabled?: boolean
}) {
  return (
    <button
      role="switch"
      aria-checked={on}
      aria-label={label}
      disabled={disabled}
      onClick={() => {
        fire(on ? 'toggleOff' : 'toggleOn')
        onChange(!on)
      }}
      className="relative h-[30px] w-[50px] shrink-0 rounded-full transition-colors disabled:opacity-40"
      style={{ background: on ? 'var(--accent)' : 'var(--surface-3)' }}
    >
      <motion.span
        className="absolute top-[3px] h-6 w-6 rounded-full bg-white"
        animate={{ left: on ? 23 : 3 }}
        transition={{ type: 'spring', stiffness: 620, damping: 38 }}
        style={{ boxShadow: '0 1px 3px rgb(0 0 0 / 0.3)' }}
      />
    </button>
  )
}

/** Pill-shaped exclusive choice, for a handful of short options. */
export function Segmented<T extends string>({
  options,
  value,
  onChange,
}: {
  options: { key: T; label: string }[]
  value: T
  onChange: (next: T) => void
}) {
  return (
    <div className="flex gap-1 rounded-full p-1.5" style={{ background: 'var(--surface-3)' }}>
      {options.map((o) => {
        const on = o.key === value
        return (
          <button
            key={o.key}
            onClick={() => {
              fire('snap')
              onChange(o.key)
            }}
            className="flex-1 whitespace-nowrap rounded-full px-3 py-2.5 text-[13px] font-medium transition-colors"
            style={{
              background: on ? 'var(--accent)' : 'transparent',
              color: on ? '#fff' : 'var(--text-dim)',
            }}
          >
            {o.label}
          </button>
        )
      })}
    </div>
  )
}

export function PrimaryButton({
  children,
  onClick,
  disabled,
  busy,
  danger,
}: {
  children: React.ReactNode
  onClick: () => void
  disabled?: boolean
  busy?: boolean
  danger?: boolean
}) {
  return (
    <motion.button
      whileTap={{ scale: 0.97 }}
      onClick={onClick}
      disabled={disabled || busy}
      className="w-full rounded-2xl py-3 text-[14.5px] font-semibold text-white disabled:opacity-40"
      style={{ background: danger ? 'var(--danger)' : 'var(--accent)' }}
    >
      {busy ? 'Working…' : children}
    </motion.button>
  )
}

/** Local error/success line under a form. */
export function Notice({ text, tone }: { text: string; tone: 'ok' | 'error' }) {
  return (
    <motion.p
      initial={{ opacity: 0, y: -4 }}
      animate={{ opacity: 1, y: 0 }}
      className="px-1 pt-2 text-[12.5px]"
      style={{ color: tone === 'ok' ? 'var(--ok)' : 'var(--danger)' }}
    >
      {text}
    </motion.p>
  )
}
