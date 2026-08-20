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
import { dataActions } from '@/store/useData'
import { useProfile } from '@/store/useProfile'
import { useUI } from '@/store/useUI'
import { useLauncher } from '@/store/useLauncher'
import type { TabKey } from '@/data/types'

/**
 * Things, as a launcher app.
 *
 * This is the screen that used to be the whole of App.tsx. Everything it lost
 * belonged to the shell rather than to Things: booting, unlocking, choosing
 * who you are, and the settings sheet — all of which the launcher now owns and
 * every app shares. What is left is the four tabs and the things that hang off
 * them.
 */
export function ThingsApp() {
  const profileId = useProfile((s) => s.profileId)
  const tab = useUI((s) => s.tab)
  const setTab = useUI((s) => s.setTab)
  const consumeDeepLink = useLauncher((s) => s.consumeDeepLink)

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

  return (
    <div className="flex h-full flex-col overflow-hidden">
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

        {/* The activity bell keeps its place in the header rail. The settings
            button that used to sit beside it is the launcher's now — Things
            has no settings of its own that aren't household-wide. */}
        <div
          className="absolute right-4 z-40 flex items-center gap-2"
          style={{ top: 'calc(env(safe-area-inset-top, 0px) + 14px)' }}
        >
          <ActivityBell />
        </div>
      </div>

      {/* Sits clear of the dock: 6px padding + 54px slot + 6px + 10px margin. */}
      <div className="pointer-events-none fixed inset-x-0 z-50 safe-bottom" style={{ bottom: 86 }}>
        {tab === 'todos' && (
          <>
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
          </>
        )}
        {tab === 'chores' && <ChoreAddBar />}
        {tab === 'shopping' && <ShoppingAddBar />}
        {tab === 'wishlist' && <WishAddBar />}
      </div>

      <TabDock />
      <ItemEditSheet />
      {/* Mounted here, not inside the header rail: the rail is an absolutely
          positioned z-40 element, which establishes a stacking context that
          would pin this sheet below the quick-add bar and the dock. */}
      <ActivitySheet />
      <Tour />
    </div>
  )
}
