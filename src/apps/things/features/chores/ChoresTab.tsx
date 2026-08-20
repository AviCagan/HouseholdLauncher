import { useMemo, useState } from 'react'
import { AnimatePresence, motion } from 'motion/react'
import { Screen, Section, EmptyState } from '@/components/shell/Screen'
import { ListRow } from '@/components/primitives/ListRow'
import { Icon } from '@/components/primitives/Icon'
import { CooldownRing } from '@/components/primitives/CooldownRing'
import { ClaimChip } from '@/components/primitives/ClaimChip'
import { useData, dataActions } from '@/store/useData'
import { useProfile } from '@/store/useProfile'
import { useUI } from '@/store/useUI'
import { SortBar, compareBy } from '@/components/shell/SortBar'
import { useNow } from '@/lib/ticker'
import { googleEventUrl } from '@/lib/calendar'
import { openExternal } from '@/apps/things/routing/deeplink'
import { fire } from '@/lib/haptics'
import {
  cooldownProgress,
  describeRecurrence,
  isResting,
  readyIn,
} from '@/lib/time'
import type { Chore } from '@/data/types'

export function ChoresTab() {
  const chores = useData((s) => s.chores)
  const profiles = useData((s) => s.profiles)
  const profileId = useProfile((s) => s.profileId)
  const now = useNow()

  const sortBy = useUI((s) => s.sortBy.chores)
  const desc = useUI((s) => s.sortDesc.chores)

  const { active, resting, done } = useMemo(() => {
    const sorted = [...chores].sort(compareBy(sortBy, desc))
    return {
      active: sorted.filter((c) => !c.is_done && !isResting(c, now)),
      // Soonest to return, first.
      resting: sorted
        .filter((c) => isResting(c, now))
        .sort((a, b) => (a.next_due_at ?? '').localeCompare(b.next_due_at ?? '')),
      // `!isResting` rather than `!is_recurring`: a chore that is both done and
      // recurring but has no cooldown running yet — which is exactly what
      // turning "Repeats" on for a finished chore produces — matched none of
      // the three buckets and vanished from the tab with no way to reopen,
      // un-complete or delete it.
      done: sorted.filter((c) => c.is_done && !isResting(c, now)),
    }
  }, [chores, now, sortBy, desc])

  const nameOf = (id: string) =>
    profiles.find((p) => p.id === id)?.display_name ?? 'Someone'

  return (
    <Screen title="Chores" count={active.length}>
      <SortBar
        tab="chores"
        options={[
          { key: 'urgency', label: 'Urgency' },
          { key: 'recurring', label: 'Repeats' },
          { key: 'added', label: 'Added' },
        ]}
      />
      {active.length === 0 && resting.length === 0 && done.length === 0 ? (
        <EmptyState
          icon={<Icon name="repeat" size={44} strokeWidth={1.5} />}
          title="Nothing to do"
          hint="Add a chore below. Tap the repeat button to make it recurring — it'll rest after each time and come back on its own."
        />
      ) : (
        <div className="flex flex-col gap-2">
          <AnimatePresence initial={false}>
            {active.map((chore) => (
              <motion.div
                key={chore.id}
                /* Shared layoutId with the resting card: when the cooldown
                   expires the card physically flies from the drawer up into
                   the active list rather than popping into existence. */
                layout
                layoutId={`chore-${chore.id}`}
                initial={{ opacity: 0, y: -8, scale: 0.98 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                exit={{ opacity: 0, scale: 0.96, transition: { duration: 0.15 } }}
                transition={{ type: 'spring', stiffness: 380, damping: 30 }}
              >
                <ListRow
                  table="chores"
                  id={chore.id}
                  title={chore.title}
                  urgency={chore.urgency}
                  claimedBy={chore.claimed_by}
                  profiles={profiles}
                  meta={
                    chore.is_recurring ? (
                      <span className="flex items-center gap-1">
                        <Icon name="repeat" size={11} strokeWidth={2.4} />
                        {describeRecurrence(
                          chore.recurrence_count,
                          chore.recurrence_unit,
                          chore.recurrence_days,
                        )}
                      </span>
                    ) : undefined
                  }
                  trailing={<AddToCalendar chore={chore} />}
                  onComplete={() => dataActions.completeChore(chore, profileId)}
                  onClaim={() =>
                    profileId &&
                    dataActions.toggleClaim(
                      'chores',
                      chore.id,
                      profileId,
                      chore.claimed_by,
                      nameOf,
                    )
                  }
                />
              </motion.div>
            ))}
          </AnimatePresence>
        </div>
      )}

      {/* Resting: the signature moment of this tab. */}
      {resting.length > 0 && (
        <div className="mt-6">
          <div className="flex items-center gap-2 px-2 pb-2">
            <Icon name="clock" size={14} strokeWidth={2.4} />
            <span
              className="text-[13px] font-semibold uppercase tracking-wide"
              style={{ color: 'var(--text-dim)' }}
            >
              Resting
            </span>
            <span className="text-[13px]" style={{ color: 'var(--text-faint)' }}>
              {resting.length}
            </span>
          </div>

          <div className="flex flex-col gap-2">
            <AnimatePresence initial={false}>
              {resting.map((chore) => (
                <RestingCard
                  key={chore.id}
                  chore={chore}
                  now={now}
                  profiles={profiles}
                  nameOf={nameOf}
                />
              ))}
            </AnimatePresence>
          </div>
        </div>
      )}

      <Section label="Done" count={done.length}>
        {done.map((chore) => (
          <ListRow
            key={chore.id}
            table="chores"
            id={chore.id}
            title={chore.title}
            urgency={chore.urgency}
            claimedBy={chore.claimed_by}
            profiles={profiles}
            done
            trailing={
              <button
                onClick={(e) => {
                  e.stopPropagation()
                  void dataActions.remove('chores', chore.id)
                }}
                aria-label="Delete"
                className="grid h-8 w-8 place-items-center rounded-full"
                style={{ color: 'var(--text-faint)' }}
              >
                <Icon name="trash" size={16} />
              </button>
            }
            onComplete={() => dataActions.completeChore(chore, profileId)}
            onClaim={() => {}}
          />
        ))}
      </Section>
    </Screen>
  )
}

/**
 * One chore onto Google Calendar, right now.
 *
 * The subscribed feed in Settings covers the steady state, but Google refreshes
 * it on its own slow schedule — so this exists for when you want something on
 * the calendar this minute. Only recurring chores have a date to land on.
 */
function AddToCalendar({ chore }: { chore: Chore }) {
  const url = googleEventUrl(chore)
  if (!url) return null

  return (
    <button
      onClick={(e) => {
        e.stopPropagation()
        fire('tap')
        openExternal(url)
      }}
      aria-label={`Add ${chore.title} to Google Calendar`}
      className="grid h-8 w-8 shrink-0 place-items-center rounded-full"
      style={{ color: 'var(--text-faint)' }}
    >
      <Icon name="calendar" size={15} />
    </button>
  )
}

function RestingCard({
  chore,
  now,
  profiles,
  nameOf,
}: {
  chore: Chore
  now: number
  profiles: import('@/data/types').Profile[]
  nameOf: (id: string) => string
}) {
  const [confirming, setConfirming] = useState(false)
  const progress = cooldownProgress(chore, now)

  return (
    <motion.div
      layout
      layoutId={`chore-${chore.id}`}
      initial={{ opacity: 0, scale: 0.97 }}
      animate={{ opacity: 1, scale: 1 }}
      exit={{ opacity: 0, scale: 0.97, transition: { duration: 0.15 } }}
      transition={{ type: 'spring', stiffness: 380, damping: 30 }}
      className="flex items-center gap-3 rounded-[var(--radius)] px-4 py-3"
      style={{
        background: 'var(--surface-2)',
        border: '1px solid var(--border)',
        opacity: 0.82,
      }}
    >
      <CooldownRing progress={progress} />

      {/* No swipe gesture competes for a tap here, unlike an active row —
          so a plain tap opens editing rather than needing a long-press. */}
      <button
        type="button"
        onClick={() => {
          fire('tap')
          useUI.getState().openSheet({ kind: 'item', table: 'chores', id: chore.id })
        }}
        className="min-w-0 flex-1 text-left"
      >
        <div className="truncate text-[14px] font-medium" style={{ color: 'var(--text-dim)' }}>
          {chore.title}
        </div>
        <div className="mt-0.5 text-[12px]" style={{ color: 'var(--text-faint)' }}>
          Ready in {readyIn(chore, now)}
          {chore.last_completed_by && ` · ${nameOf(chore.last_completed_by)} did it`}
        </div>
      </button>

      {confirming ? (
        <div className="flex items-center gap-1">
          <button
            onClick={() => void dataActions.remove('chores', chore.id)}
            className="rounded-full px-3 py-1.5 text-[12px] font-semibold text-white"
            style={{ background: 'var(--danger)' }}
          >
            Delete
          </button>
          <button
            onClick={() => setConfirming(false)}
            className="rounded-full px-3 py-1.5 text-[12px]"
            style={{ color: 'var(--text-dim)' }}
          >
            Keep
          </button>
        </div>
      ) : (
        <>
          <AddToCalendar chore={chore} />
          <ClaimChip claimedBy={chore.claimed_by} profiles={profiles} size={26} />
          <button
            onClick={() => setConfirming(true)}
            aria-label="Delete chore"
            className="grid h-8 w-8 place-items-center rounded-full"
            style={{ color: 'var(--text-faint)' }}
          >
            <Icon name="trash" size={15} />
          </button>
        </>
      )}
    </motion.div>
  )
}
