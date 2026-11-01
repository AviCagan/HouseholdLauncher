import { useEffect, useState } from 'react'
import { AnimatePresence, motion } from 'motion/react'
import { TabDock } from '@/components/shell/TabDock'
import { QuickAdd } from '@/components/shell/QuickAdd'
import { TodosTab } from './features/todos/TodosTab'
import { ChoresTab } from './features/chores/ChoresTab'
import { ChoreAddBar } from './features/chores/ChoreAddBar'
import { ShoppingTab } from './features/shopping/ShoppingTab'
import { ShoppingAddBar } from './features/shopping/ShoppingAddBar'
import { WishlistTab } from './features/wishlist/WishlistTab'
import { WishAddBar } from './features/wishlist/WishAddBar'
import { ItemEditSheet } from './features/items/ItemEditSheet'
import { ActivityBell, ActivitySheet } from './features/activity/ActivityBell'
import { DeadlinePromptHost } from './features/todos/DeadlinePrompt'
import { Tour, tourSeen } from '@/components/shell/Tour'
import { SettingsSheet } from './features/settings/SettingsSheet'
import { Icon, type IconName } from '@/components/primitives/Icon'
import { fire } from '@/lib/haptics'
import { dataActions } from '@/store/useData'
import { useProfile } from '@/store/useProfile'
import { TABS, useUI } from '@/store/useUI'
import { useLauncher } from '@/store/useLauncher'
import { useDesktop } from '@/lib/useDesktop'
import type { TabKey } from '@/data/types'
import './things.css'

/**
 * Things, as a launcher app.
 *
 * This is the screen that used to be the whole of App.tsx. Everything it lost
 * belonged to the shell rather than to Things: booting, unlocking, choosing
 * who you are, how the whole thing looks and feels, and whether this phone
 * gets notified — all of which the launcher owns and every app shares. What is
 * left is the four tabs, the things that hang off them, and the settings that
 * only mean anything inside Things.
 *
 * The look — graph paper, ink outlines, label tape — is scoped by the
 * `things` class on the root; see things.css for how it is done.
 */
export function ThingsApp() {
  const profileId = useProfile((s) => s.profileId)
  const tab = useUI((s) => s.tab)
  const setTab = useUI((s) => s.setTab)
  const consumeDeepLink = useLauncher((s) => s.consumeDeepLink)
  const desktop = useDesktop()

  // The to-do just added, awaiting an optional deadline. Ignoring the prompt is
  // a valid answer, so this clears itself rather than blocking anything.
  const [pendingDeadline, setPendingDeadline] = useState<{ id: string; title: string } | null>(null)

  /*
    Honour a notification tap.

    The launcher hands over whatever `deep_link` the notification carried and
    takes no view on its contents — the shape is this app's business, so the
    interpretation lives here. Anything unrecognised is dropped rather than
    guessed at, so an entry written by an older build can't land the app on a
    tab that no longer exists.
  */
  useEffect(() => {
    const link = consumeDeepLink()
    const wanted = link?.tab
    const valid: TabKey[] = ['todos', 'chores', 'shopping', 'wishlist']
    if (typeof wanted === 'string' && valid.includes(wanted as TabKey)) {
      setTab(wanted as TabKey)
    }
  }, [consumeDeepLink, setTab])

  // The walkthrough, once per person per device.
  useEffect(() => {
    if (!profileId || tourSeen(profileId)) return
    // One frame of the app first — opening straight onto a dimmed overlay
    // reads as a loading screen rather than a welcome.
    const timer = setTimeout(() => useUI.getState().startTour(), 450)
    return () => clearTimeout(timer)
  }, [profileId])

  /*
    The add bar for the tab you're on.

    On a phone it floats above the dock, in thumb reach. On a laptop it sits
    under the tab strip at the top, where "type, Enter, type, Enter" belongs,
    and the panels that hang off it — store, recurrence, price — open
    downwards instead of up (the `lg:flex-col-reverse` on each bar).
  */
  const addBar = (
    <>
      {tab === 'todos' && (
        <div className="flex flex-col gap-2 lg:flex-col-reverse">
          <DeadlinePromptHost
            pending={pendingDeadline}
            onDone={() => setPendingDeadline(null)}
          />
          <QuickAdd
            placeholder="Add a to-do…"
            onSubmit={async (title, urgency) => {
              const id = await dataActions.addTodo(title, urgency, profileId)
              if (id) setPendingDeadline({ id, title })
            }}
          />
        </div>
      )}
      {tab === 'chores' && <ChoreAddBar />}
      {tab === 'shopping' && <ShoppingAddBar />}
      {tab === 'wishlist' && <WishAddBar />}
    </>
  )

  /* Two buttons, which is exactly what Screen's `pr-[104px]` reserves on a
     phone. The gear is back after a spell in launcher settings: what it
     opens is now genuinely Things' own — home address, calendar sync, voice
     links, which lists get cleared — while everything that was shared
     (theme, accent, vibration) moved out to the launcher, where changing it
     visibly affects every app. Settings you reach by opening one app should
     only change that app. */
  const rail = (
    <>
      <button
        onClick={() => {
          fire('tap')
          useUI.getState().openSheet({ kind: 'settings' })
        }}
        aria-label="Things settings"
        className="rail-btn grid h-9 w-9 place-items-center rounded-full"
        style={{
          background: 'var(--surface)',
          border: 'var(--card-border)',
          color: 'var(--text-dim)',
        }}
      >
        <Icon name="settings" size={17} />
      </button>
      <ActivityBell />
    </>
  )

  return (
    <div className="things flex h-full flex-col overflow-hidden">
      {/* Laptop: the dock's four tabs become a strip along the top, with
          the rail beside them and the add bar underneath — one place to
          look, nothing floating over the list. */}
      {desktop && (
        <div className="shrink-0 px-6 pt-4">
          <div className="flex items-center gap-3">
            <nav
              aria-label="Sections"
              className="flex gap-1 rounded-full p-1"
              style={{ background: 'var(--surface)', border: 'var(--card-border)', boxShadow: 'var(--card-shadow)' }}
            >
              {TABS.map((t) => {
                const active = t.key === tab
                return (
                  <button
                    key={t.key}
                    type="button"
                    aria-current={active ? 'page' : undefined}
                    onClick={() => {
                      if (active) return
                      fire('snap')
                      setTab(t.key)
                    }}
                    className="relative flex items-center gap-2 rounded-full px-4 py-2 text-[13.5px] font-bold"
                    style={{ color: active ? '#fff' : 'var(--text-dim)' }}
                  >
                    {active && (
                      <motion.span
                        layoutId="things-strip"
                        transition={{ type: 'spring', stiffness: 480, damping: 38 }}
                        className="dock-pill absolute inset-0 rounded-full"
                        style={{ background: 'var(--accent)' }}
                      />
                    )}
                    <span className="relative">
                      <Icon name={t.icon as IconName} size={16} strokeWidth={active ? 2.6 : 2.2} />
                    </span>
                    <span className="relative">{t.label}</span>
                  </button>
                )
              })}
            </nav>
            <div className="ml-auto flex items-center gap-2">{rail}</div>
          </div>
          <div className="max-w-[760px] pt-3">{addBar}</div>
        </div>
      )}

      <div className="relative min-h-0 flex-1">
        <AnimatePresence mode="wait" initial={false}>
          <motion.div
            key={tab}
            className="h-full"
            initial={{ opacity: 0, x: 12 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: -12 }}
            transition={{ duration: 0.18, ease: [0.22, 1, 0.36, 1] }}
          >
            {tab === 'todos' && <TodosTab />}
            {tab === 'chores' && <ChoresTab />}
            {tab === 'shopping' && <ShoppingTab />}
            {tab === 'wishlist' && <WishlistTab />}
          </motion.div>
        </AnimatePresence>

        {!desktop && (
          <div
            className="absolute right-4 z-40 flex items-center gap-2"
            style={{ top: 'max(var(--safe-top), 14px)' }}
          >
            {rail}
          </div>
        )}
      </div>

      {/* Sits clear of the dock: 6px padding + 54px slot + 6px + 10px margin. */}
      {!desktop && (
        <div className="pointer-events-none fixed inset-x-0 z-50 safe-bottom" style={{ bottom: 86 }}>
          {addBar}
        </div>
      )}

      {!desktop && <TabDock />}
      <ItemEditSheet />
      {/* Mounted here, not inside the header rail: the rail is an absolutely
          positioned z-40 element, which establishes a stacking context that
          would pin this sheet below the quick-add bar and the dock. */}
      <ActivitySheet />
      {/* Mounted alongside the app's other sheets rather than in the launcher's
          settings sheet, where it used to live: it belongs to Things now, and
          nesting it inside another sheet is what pinned it below the dock. */}
      <SettingsSheet />
      <Tour />
    </div>
  )
}
