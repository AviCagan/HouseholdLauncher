import { useEffect, useMemo, useState } from 'react'
import { motion } from 'motion/react'
import { Sheet } from '@/components/primitives/Sheet'
import { Icon, type IconName } from '@/components/primitives/Icon'
import { Avatar } from '@/components/primitives/ClaimChip'
import { useData } from '@/store/useData'
import { useProfile } from '@/store/useProfile'
import { useUI } from '@/store/useUI'
import { useNow } from '@/lib/ticker'
import { fire } from '@/lib/haptics'
import { formatDuration } from '@/lib/time'
import { outstanding, scoreboard, shareOfDone, daysAgoIso } from './stats'
import type { ActivityLog, Profile } from '@/data/types'

/**
 * A plain-language feed of what changed — independent of push delivery, so it
 * still tells the story even on a device where notifications never arrived
 * (see supabase/011_activity_and_edits.sql). Unread state is per person, per
 * device, in localStorage, same as the tour: two phones are two installs.
 *
 * The button and the sheet are deliberately two exports mounted in two
 * different places. The bell lives in the header rail, which is an absolutely
 * positioned `z-40` element — and that establishes a stacking context, so a
 * sheet rendered inside it can never paint above anything outside it no matter
 * how high its own z-index goes. Rendering the sheet there put it underneath
 * the quick-add bar and the tab dock. It has to be a sibling of the app's
 * other sheets to sit above them, which means the seen-state has to live in
 * the store rather than in shared component state.
 */

const LAST_SEEN_KEY = 'things.activity.lastSeen.v1'

function readLastSeen(profileId: string): string | null {
  try {
    return localStorage.getItem(`${LAST_SEEN_KEY}.${profileId}`)
  } catch {
    return null
  }
}

function writeLastSeen(profileId: string, iso: string): void {
  try {
    localStorage.setItem(`${LAST_SEEN_KEY}.${profileId}`, iso)
  } catch {
    /* best-effort — worst case the badge over-counts next launch */
  }
}

/**
 * Newest-first, sorted here rather than trusted from the adapter: the local
 * adapter returns insertion order and the Supabase one returns server order,
 * and the bell shouldn't depend on either staying true.
 */
function useSortedActivity(): ActivityLog[] {
  const entries = useData((s) => s.activity_log)
  return useMemo(
    () => [...entries].sort((a, b) => b.created_at.localeCompare(a.created_at)),
    [entries],
  )
}

export function ActivityBell() {
  const profileId = useProfile((s) => s.profileId)
  const openSheet = useUI((s) => s.openSheet)
  const seenAt = useUI((s) => s.activitySeenAt)
  const setSeenAt = useUI((s) => s.setActivitySeenAt)
  const sorted = useSortedActivity()

  // Hydrate from this person's own localStorage whenever the profile changes.
  useEffect(() => {
    setSeenAt(profileId ? readLastSeen(profileId) : null)
  }, [profileId, setSeenAt])

  const unread = useMemo(() => {
    if (!seenAt) return sorted.length
    return sorted.filter((e) => e.created_at > seenAt).length
  }, [sorted, seenAt])

  return (
    <button
      onClick={() => {
        fire('tap')
        openSheet({ kind: 'activity' })
      }}
      aria-label={unread > 0 ? `Activity — ${unread} unread` : 'Activity'}
      className="relative grid h-9 w-9 place-items-center rounded-full"
      style={{
        background: 'var(--surface-2)',
        border: '1px solid var(--border)',
        color: 'var(--text-dim)',
      }}
    >
      <Icon name="bell" size={17} />
      {unread > 0 && (
        <span
          className="absolute -right-1 -top-1 grid h-4 min-w-4 place-items-center rounded-full px-1 text-[10px] font-bold text-white"
          style={{ background: 'var(--danger)' }}
        >
          {unread > 9 ? '9+' : unread}
        </span>
      )}
    </button>
  )
}

/** Mounted alongside the app's other sheets, never inside the header rail. */
export function ActivitySheet() {
  const profileId = useProfile((s) => s.profileId)
  const profiles = useData((s) => s.profiles)
  const sheet = useUI((s) => s.sheet)
  const closeSheet = useUI((s) => s.closeSheet)
  const setSeenAt = useUI((s) => s.setActivitySeenAt)
  const sorted = useSortedActivity()
  const open = sheet.kind === 'activity'
  const [view, setView] = useState<'summary' | 'history'>('summary')

  // Marking as seen on open, not per row — this is a feed to scan, not an
  // inbox to triage.
  useEffect(() => {
    if (!open || !profileId) return
    const newest = sorted[0]?.created_at
    if (!newest) return
    writeLastSeen(profileId, newest)
    setSeenAt(newest)
  }, [open, profileId, sorted, setSeenAt])

  const nameOf = (id: string | null) =>
    profiles.find((p) => p.id === id)?.display_name ?? 'Someone'

  // Fixed height: Summary and History are different lengths, so a
  // content-sized sheet lurched up and down every time you switched tabs.
  return (
    <Sheet open={open} onClose={closeSheet} title="Home" height="80vh">
      <div
        className="mb-4 flex gap-0.5 rounded-full p-0.5"
        style={{ background: 'var(--surface-3)' }}
      >
        {(['summary', 'history'] as const).map((v) => (
          <button
            key={v}
            onClick={() => {
              fire('snap')
              setView(v)
            }}
            aria-pressed={view === v}
            className="flex-1 rounded-full py-2 text-[13px] font-semibold capitalize"
            style={{
              background: view === v ? 'var(--accent)' : 'transparent',
              color: view === v ? '#fff' : 'var(--text-dim)',
            }}
          >
            {v}
          </button>
        ))}
      </div>

      {view === 'summary' ? (
        <SummaryView profiles={profiles} entries={sorted} />
      ) : sorted.length === 0 ? (
        <p className="py-8 text-center text-[14px]" style={{ color: 'var(--text-faint)' }}>
          Nothing yet
        </p>
      ) : (
        <div className="flex flex-col pb-4">
          {sorted.map((entry) => (
            <ActivityRow key={entry.id} entry={entry} actorName={nameOf(entry.actor_id)} />
          ))}
        </div>
      )}
    </Sheet>
  )
}

const WINDOWS = [
  { key: 7, label: 'This week' },
  { key: 30, label: 'This month' },
] as const

/** Everything outstanding at a glance, plus who's been doing it. */
function SummaryView({ profiles, entries }: { profiles: Profile[]; entries: ActivityLog[] }) {
  const todos = useData((s) => s.todos)
  const chores = useData((s) => s.chores)
  const shopping = useData((s) => s.shopping_items)
  const wishlist = useData((s) => s.wishlist_items)
  const now = useNow()
  const [days, setDays] = useState<number>(7)

  const totals = useMemo(
    () => outstanding(todos, chores, shopping, wishlist, now),
    [todos, chores, shopping, wishlist, now],
  )

  const scores = useMemo(() => {
    const claimed = [
      ...todos.filter((t) => !t.is_done),
      ...chores.filter((c) => !c.is_done),
      ...shopping.filter((s) => !s.is_done),
    ].map((i) => i.claimed_by)
    return scoreboard(entries, profiles.map((p) => p.id), daysAgoIso(days, now), claimed)
  }, [entries, profiles, days, now, todos, chores, shopping])

  const shares = shareOfDone(scores)
  const leader = scores.reduce((a, b) => (b.done > a.done ? b : a), scores[0])
  const tied = scores.every((s) => s.done === scores[0]?.done)

  return (
    <div className="flex flex-col gap-5 pb-4">
      <div
        className="flex flex-col gap-3 rounded-2xl p-4"
        style={{ background: 'var(--surface-2)', border: '1px solid var(--border)' }}
      >
        <div className="flex items-baseline gap-2">
          <span className="text-[34px] font-bold leading-none">{totals.total}</span>
          <span className="text-[14px]" style={{ color: 'var(--text-dim)' }}>
            {totals.total === 1 ? 'thing to do' : 'things to do'}
          </span>
        </div>

        {(totals.urgent > 0 || totals.unclaimed > 0) && (
          <div className="flex flex-wrap gap-1.5">
            {totals.urgent > 0 && (
              <Pill color="var(--u-urgent)" text={`${totals.urgent} urgent`} />
            )}
            {totals.unclaimed > 0 && (
              <Pill color="var(--text-faint)" text={`${totals.unclaimed} unclaimed`} />
            )}
          </div>
        )}

        <div className="grid grid-cols-4 gap-2 pt-0.5">
          <Stat icon="check" label="To-do" value={totals.todos} />
          <Stat icon="repeat" label="Chores" value={totals.chores} sub={totals.resting > 0 ? `${totals.resting} resting` : undefined} />
          <Stat icon="cart" label="Shopping" value={totals.shopping} />
          <Stat icon="star" label="Wishlist" value={totals.wishlist} />
        </div>
      </div>

      <div className="flex flex-col gap-3">
        <div className="flex items-center justify-between">
          <span
            className="text-[12px] font-semibold uppercase tracking-wide"
            style={{ color: 'var(--text-faint)' }}
          >
            Between you
          </span>
          <div className="flex gap-0.5 rounded-full p-0.5" style={{ background: 'var(--surface-3)' }}>
            {WINDOWS.map((w) => (
              <button
                key={w.key}
                onClick={() => {
                  fire('snap')
                  setDays(w.key)
                }}
                aria-pressed={days === w.key}
                className="rounded-full px-2.5 py-1 text-[11px] font-semibold"
                style={{
                  background: days === w.key ? 'var(--surface)' : 'transparent',
                  color: days === w.key ? 'var(--text)' : 'var(--text-faint)',
                }}
              >
                {w.label}
              </button>
            ))}
          </div>
        </div>

        {/* One bar split by share of completions — the comparison reads
            instantly without turning the house into a leaderboard. */}
        <div className="flex h-2.5 overflow-hidden rounded-full" style={{ background: 'var(--surface-3)' }}>
          {profiles.map((p, i) => (
            <motion.span
              key={p.id}
              animate={{ flexGrow: Math.max(0.001, shares[i] ?? 0) }}
              transition={{ type: 'spring', stiffness: 260, damping: 30 }}
              style={{ background: p.color_hex, flexBasis: 0 }}
            />
          ))}
        </div>

        <div className="flex flex-col gap-2">
          {profiles.map((p, i) => (
            <ScoreRow key={p.id} profile={p} score={scores[i]} share={shares[i] ?? 0} />
          ))}
        </div>

        <p className="px-1 text-[12px]" style={{ color: 'var(--text-faint)' }}>
          {scores.every((s) => s.done === 0)
            ? 'Nothing finished yet in this stretch.'
            : tied
              ? "Dead even — nobody's getting away with anything."
              : `${profiles.find((p) => p.id === leader?.profileId)?.display_name ?? 'Someone'} is ahead by ${
                  leader.done - Math.min(...scores.map((s) => s.done))
                }.`}
        </p>
      </div>
    </div>
  )
}

function Pill({ color, text }: { color: string; text: string }) {
  return (
    <span
      className="rounded-full px-2.5 py-1 text-[12px] font-semibold"
      style={{
        background: `color-mix(in oklab, ${color} 20%, transparent)`,
        color,
      }}
    >
      {text}
    </span>
  )
}

function Stat({
  icon,
  label,
  value,
  sub,
}: {
  icon: IconName
  label: string
  value: number
  sub?: string
}) {
  return (
    <div className="flex flex-col items-center gap-1 rounded-xl py-2" style={{ background: 'var(--surface)' }}>
      <span style={{ color: 'var(--text-faint)' }}>
        <Icon name={icon} size={14} strokeWidth={2.2} />
      </span>
      <span className="text-[17px] font-bold leading-none">{value}</span>
      <span className="text-[10px]" style={{ color: 'var(--text-faint)' }}>
        {sub ?? label}
      </span>
    </div>
  )
}

function ScoreRow({
  profile,
  score,
  share,
}: {
  profile: Profile
  score: { done: number; added: number; claimed: number } | undefined
  share: number
}) {
  return (
    <div
      className="flex items-center gap-3 rounded-2xl px-3 py-2.5"
      style={{ background: 'var(--surface-2)', border: '1px solid var(--border)' }}
    >
      <span
        className="grid h-8 w-8 shrink-0 place-items-center overflow-hidden rounded-full text-[15px]"
        style={{
          background: `color-mix(in oklab, ${profile.color_hex} 26%, transparent)`,
          border: `1.5px solid ${profile.color_hex}`,
        }}
      >
        <Avatar profile={profile} size={30} />
      </span>
      <span className="min-w-0 flex-1 truncate text-[14px] font-semibold">
        {profile.display_name}
      </span>
      <div className="flex items-center gap-3 text-[12px]" style={{ color: 'var(--text-dim)' }}>
        <span title="On their plate now">{score?.claimed ?? 0} claimed</span>
        <span title="Added in this window">{score?.added ?? 0} added</span>
      </div>
      <div className="flex w-14 shrink-0 flex-col items-end">
        <span className="text-[19px] font-bold leading-none">{score?.done ?? 0}</span>
        <span className="text-[10px]" style={{ color: 'var(--text-faint)' }}>
          {Math.round(share * 100)}% done
        </span>
      </div>
    </div>
  )
}

const EVENT_META: Record<ActivityLog['event'], { icon: IconName; verb: string; color: string }> = {
  added: { icon: 'plus', verb: 'added', color: 'var(--ok)' },
  edited: { icon: 'pencil', verb: 'edited', color: 'var(--text-dim)' },
  completed: { icon: 'check', verb: 'completed', color: 'var(--ok)' },
  uncompleted: { icon: 'clock', verb: 'un-completed', color: 'var(--warn)' },
  claimed: { icon: 'pin', verb: 'claimed', color: 'var(--accent)' },
  unclaimed: { icon: 'close', verb: 'unclaimed', color: 'var(--text-faint)' },
  deleted: { icon: 'trash', verb: 'deleted', color: 'var(--danger)' },
}

const TABLE_LABEL: Record<ActivityLog['table_name'], string> = {
  todos: 'To-do',
  chores: 'Chore',
  shopping_items: 'Shopping',
  wishlist_items: 'Wishlist',
}

function ActivityRow({ entry, actorName }: { entry: ActivityLog; actorName: string }) {
  const meta = EVENT_META[entry.event]
  const ms = Date.now() - new Date(entry.created_at).getTime()
  const ago = ms < 60_000 ? 'just now' : `${formatDuration(ms)} ago`

  return (
    <div className="flex items-start gap-3 py-2.5">
      <span
        className="mt-0.5 grid h-8 w-8 shrink-0 place-items-center rounded-full"
        style={{
          background: `color-mix(in oklab, ${meta.color} 20%, transparent)`,
          color: meta.color,
        }}
      >
        <Icon name={meta.icon} size={15} strokeWidth={2.4} />
      </span>
      <div className="min-w-0 flex-1">
        <div className="text-[14px] leading-snug">
          <span className="font-semibold">{actorName}</span> {meta.verb}{' '}
          <span className="font-medium">"{entry.title}"</span>
        </div>
        <div
          className="mt-0.5 flex items-center gap-1.5 text-[12px]"
          style={{ color: 'var(--text-faint)' }}
        >
          <span>{TABLE_LABEL[entry.table_name]}</span>
          <span>·</span>
          <span>{ago}</span>
        </div>
      </div>
    </div>
  )
}
