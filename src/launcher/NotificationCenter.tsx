import { useMemo } from 'react'
import { AnimatePresence, motion } from 'motion/react'
import { Sheet } from '@/components/primitives/Sheet'
import { Icon } from '@/components/primitives/Icon'
import { appById } from './registry'
import {
  clearNotifications,
  markRead,
  useCurrentMember,
  useInbox,
} from '@/store/useMember'
import { useLauncher } from '@/store/useLauncher'
import { useData } from '@/store/useData'
import { fire } from '@/lib/haptics'
import type { AppNotification } from '@/data/types'

/**
 * The launcher's own notification centre.
 *
 * Separate from the OS shade on purpose: a phone notification can be swiped
 * away, arrive while the app is uninstalled from the background, or never be
 * granted permission at all — and then the fact that a chore came due is
 * simply lost. This list is the record, and the badges on the home grid are
 * counted from the same rows, so what the tile says and what the centre shows
 * can never disagree.
 */
export function NotificationCenter() {
  const open = useLauncher((s) => s.inboxOpen)
  const setInbox = useLauncher((s) => s.setInbox)
  const openApp = useLauncher((s) => s.openApp)
  const items = useInbox()
  const member = useCurrentMember()

  const unreadIds = useMemo(() => items.filter((n) => !n.read_at).map((n) => n.id), [items])

  /** Grouped by day, so a week of history reads as a timeline. */
  const groups = useMemo(() => {
    const out: { label: string; items: AppNotification[] }[] = []
    for (const item of items) {
      const label = dayLabel(item.created_at)
      const last = out[out.length - 1]
      if (last?.label === label) last.items.push(item)
      else out.push({ label, items: [item] })
    }
    return out
  }, [items])

  return (
    <Sheet
      open={open}
      onClose={() => setInbox(false)}
      height="78vh"
      title={
        <div className="flex w-full items-center justify-between gap-3">
          <span className="text-[17px] font-bold">Notifications</span>
          <div className="flex items-center gap-1.5">
            {unreadIds.length > 0 && (
              <SheetAction
                label="Mark all read"
                onClick={() => {
                  fire('toggleOn')
                  void markRead(unreadIds)
                }}
              />
            )}
            {items.length > 0 && (
              <SheetAction
                label="Clear"
                danger
                onClick={() => {
                  fire('delete')
                  void clearNotifications(items.map((n) => n.id))
                }}
              />
            )}
          </div>
        </div>
      }
    >
      {items.length === 0 ? (
        <div className="grid place-items-center gap-3 px-8 py-16 text-center">
          <span style={{ color: 'var(--text-faint)', opacity: 0.45 }}>
            <Icon name="bell" size={32} />
          </span>
          <span className="text-[15px] font-semibold">Nothing new</span>
          <span className="max-w-[250px] text-[13px]" style={{ color: 'var(--text-faint)' }}>
            {member
              ? 'Anything your apps want to tell you shows up here.'
              : 'Sign in to see your notifications.'}
          </span>
        </div>
      ) : (
        <div className="flex flex-col gap-1 pb-4">
          <AnimatePresence initial={false}>
            {groups.map((group) => (
              <div key={group.label}>
                <p
                  className="px-1 pb-1 pt-3 text-[11px] font-semibold uppercase tracking-wide"
                  style={{ color: 'var(--text-faint)' }}
                >
                  {group.label}
                </p>
                {group.items.map((item) => (
                  <NotificationRow
                    key={item.id}
                    item={item}
                    onOpen={() => {
                      fire('tap')
                      if (!item.read_at) void markRead([item.id])
                      // Only navigate for an app that still exists — an entry
                      // left behind by a removed app should stay readable
                      // rather than opening a blank screen.
                      if (appById(item.app_id)) openApp(item.app_id, item.deep_link)
                      else setInbox(false)
                    }}
                    onDismiss={() => {
                      fire('toggleOff')
                      void clearNotifications([item.id])
                    }}
                  />
                ))}
              </div>
            ))}
          </AnimatePresence>
        </div>
      )}
    </Sheet>
  )
}

function NotificationRow({
  item,
  onOpen,
  onDismiss,
}: {
  item: AppNotification
  onOpen: () => void
  onDismiss: () => void
}) {
  const app = appById(item.app_id)
  const actor = useData((s) => s.profiles).find((p) => p.id === item.actor_id)
  const unread = !item.read_at

  return (
    <motion.div
      layout
      initial={{ opacity: 0, y: -6 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, height: 0, marginBottom: 0 }}
      className="mb-1.5 flex items-start gap-3 rounded-2xl p-3"
      style={{
        background: unread ? 'var(--surface-2)' : 'transparent',
        border: `1px solid ${unread ? 'var(--border)' : 'transparent'}`,
      }}
    >
      <button onClick={onOpen} className="flex min-w-0 flex-1 items-start gap-3 text-left">
        <span
          className="mt-0.5 grid h-9 w-9 shrink-0 place-items-center rounded-xl"
          style={{
            background: `color-mix(in oklab, ${app?.color ?? 'var(--accent)'} 18%, transparent)`,
            color: app?.color ?? 'var(--accent)',
          }}
        >
          <Icon name={app?.icon ?? 'bell'} size={17} />
        </span>

        <span className="min-w-0 flex-1">
          <span className="flex items-center gap-1.5">
            <span
              className="truncate text-[11px] font-semibold uppercase tracking-wide"
              style={{ color: app?.color ?? 'var(--text-faint)' }}
            >
              {app?.name ?? item.app_id}
            </span>
            <span className="text-[11px]" style={{ color: 'var(--text-faint)' }}>
              {timeLabel(item.created_at)}
            </span>
            {unread && (
              <span
                className="h-1.5 w-1.5 shrink-0 rounded-full"
                style={{ background: 'var(--danger)' }}
              />
            )}
          </span>

          <span className="mt-0.5 block text-[14px] font-medium leading-snug">{item.title}</span>

          {item.body && (
            <span
              className="mt-0.5 block text-[12.5px] leading-snug"
              style={{ color: 'var(--text-dim)' }}
            >
              {item.body}
            </span>
          )}

          {actor && (
            <span className="mt-1 block text-[11px]" style={{ color: 'var(--text-faint)' }}>
              {actor.avatar_emoji} {actor.display_name}
            </span>
          )}
        </span>
      </button>

      <button
        onClick={onDismiss}
        aria-label="Dismiss"
        className="mt-1 shrink-0 p-1"
        style={{ color: 'var(--text-faint)' }}
      >
        <Icon name="close" size={14} />
      </button>
    </motion.div>
  )
}

function SheetAction({
  label,
  onClick,
  danger = false,
}: {
  label: string
  onClick: () => void
  danger?: boolean
}) {
  return (
    <button
      onClick={onClick}
      className="rounded-full px-3 py-1.5 text-[12px] font-semibold"
      style={{
        background: 'var(--surface-3)',
        color: danger ? 'var(--danger)' : 'var(--text-dim)',
      }}
    >
      {label}
    </button>
  )
}

/**
 * Calendar-day buckets, not elapsed time.
 *
 * "Yesterday" has to mean the previous calendar date rather than 24-plus hours
 * ago, or something from 11pm last night sits under Today until lunchtime.
 */
function dayLabel(iso: string): string {
  const then = new Date(iso)
  const now = new Date()
  const midnight = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime()
  const days = Math.round((midnight(now) - midnight(then)) / 86_400_000)

  if (days <= 0) return 'Today'
  if (days === 1) return 'Yesterday'
  if (days < 7) return then.toLocaleDateString(undefined, { weekday: 'long' })
  return then.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
}

function timeLabel(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime()
  const mins = Math.floor(diff / 60_000)
  if (mins < 1) return 'now'
  if (mins < 60) return `${mins}m`
  const hours = Math.floor(mins / 60)
  if (hours < 24) return `${hours}h`
  return `${Math.floor(hours / 24)}d`
}
