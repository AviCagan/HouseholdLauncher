import { useEffect, useState } from 'react'
import { AnimatePresence, motion } from 'motion/react'
import { Icon, type IconName } from '@/components/primitives/Icon'
import { useUI } from '@/store/useUI'
import { useData } from '@/store/useData'
import { useCurrentProfile } from '@/store/useProfile'
import { fire, hasRealHaptics } from '@/lib/haptics'
import type { TabKey } from '@/data/types'

/**
 * The walkthrough shown once after you pick who you are.
 *
 * It deliberately does *not* draw a fake app. Each step switches the real tab
 * underneath and dims it, so what you read about is the screen you're looking
 * at — which matters here, because most of what makes this app quick is
 * gestures that aren't visible in the UI at all. Someone who never learns the
 * swipes ends up using a slower version of the same app forever.
 *
 * Seen-state is per person, per device, in localStorage rather than the shared
 * database: two phones are two installs, and Jackie shouldn't skip her tour
 * because Avi already took his.
 */

export interface Step {
  tab: TabKey
  icon: IconName
  title: string
  body: string
  /** Extra lines rendered as a compact list — used for the gesture step. */
  points?: { icon: IconName; text: string }[]
}

const STEP_KEY = 'things.tour.v1'

export function tourSeen(profileId: string): boolean {
  try {
    return localStorage.getItem(`${STEP_KEY}.${profileId}`) === 'yes'
  } catch {
    // Private mode or a locked-down webview — better to show the tour again
    // than to crash on boot.
    return false
  }
}

function markSeen(profileId: string): void {
  try {
    localStorage.setItem(`${STEP_KEY}.${profileId}`, 'yes')
  } catch {
    /* nothing to do — the tour is replayable from Settings either way */
  }
}

/**
 * The script, as data.
 *
 * Exported so the copy can be tested without a DOM — every step is addressed
 * to a specific person, and getting the wrong name in front of Jackie is the
 * failure worth guarding against.
 */
export function buildSteps(name: string, partner: string, buzzes: boolean): Step[] {
  return [
    {
      tab: 'todos',
      icon: 'sparkle',
      title: `Hi ${name}`,
      body: `Everything in here is shared with ${partner}. Add something on your phone and it shows up on theirs a moment later — there's nothing to send, sync or refresh.`,
    },
    {
      tab: 'todos',
      icon: 'plus',
      title: 'Adding is the fast part',
      body: 'The bar above the tabs stays put. Type, hit enter, type the next one — it keeps the keyboard up so you can empty your head in one go.',
    },
    {
      tab: 'todos',
      icon: 'nav',
      title: 'Everything else is a swipe',
      body: 'There are no menus on a row. Try these on any item, in any list:',
      points: [
        { icon: 'check', text: 'Swipe right to finish it' },
        { icon: 'star', text: `Swipe left to claim it, so ${partner} knows it's yours` },
        { icon: 'clock', text: 'Hold your finger down for the urgency wheel' },
      ],
    },
    {
      tab: 'todos',
      icon: 'check',
      title: 'Green, yellow, red',
      body: 'The bar down the left of each row is urgency. Red items breathe slightly — the only thing in the app that moves on its own, so it catches your eye without shouting.',
    },
    {
      tab: 'chores',
      icon: 'repeat',
      title: 'Chores come back on their own',
      body: "Tap the repeat button when adding one and pick how often. Finish it and it drops into Resting with a ring counting down, then flies back up to the top when it's due again.",
    },
    {
      tab: 'chores',
      icon: 'calendar',
      title: 'On your calendar too',
      body: 'The calendar button on a repeating chore drops it straight into Google Calendar. In Settings you can subscribe once and have all of them appear there automatically, with reminders.',
    },
    {
      tab: 'shopping',
      icon: 'cart',
      title: 'Shopping knows the way',
      body: 'Items group by store. Tap Plan a trip and it works out the fastest order to hit every shop and get home, then hands the route to your maps app. Online-only shops sit out of the route.',
    },
    {
      tab: 'wishlist',
      icon: 'star',
      title: 'Wishlist, for the fun stuff',
      body: 'Hold the little bars and slide up or down to say how badly you want something. Paste a link and it fills in the name, photo and price by itself.',
    },
    {
      tab: 'wishlist',
      icon: 'settings',
      title: 'Make it yours',
      body: buzzes
        ? 'The gear in the corner has your colours, theme, how hard the phone buzzes, notifications and the calendar link. Your settings are yours — changing them does nothing to theirs.'
        : 'The gear in the corner has your colours, theme, notifications and the calendar link. Your settings are yours — changing them does nothing to theirs.',
    },
  ]
}

export function Tour() {
  const open = useUI((s) => s.tour)
  const endTour = useUI((s) => s.endTour)
  const setTab = useUI((s) => s.setTab)
  const profile = useCurrentProfile()
  const profiles = useData((s) => s.profiles)
  const [i, setI] = useState(0)

  const name = profile?.display_name ?? 'there'
  // Two people, so "the other one" is unambiguous — but never assume there is
  // one, or the tour reads oddly against a half-seeded database.
  const partner = profiles.find((p) => p.id !== profile?.id)?.display_name ?? 'them'
  const steps = buildSteps(name, partner, hasRealHaptics())
  const step = steps[Math.min(i, steps.length - 1)]

  // Rewind first, then follow the step. Ordered this way round because
  // replaying from Settings would otherwise flash the tab of whichever step
  // the last run ended on before snapping back to the beginning.
  useEffect(() => {
    if (open) setI(0)
  }, [open])

  // Drive the real screen underneath, so the tour is always describing what
  // you can actually see.
  useEffect(() => {
    if (open) setTab(step.tab)
  }, [open, step.tab, setTab])

  const showing = open && profile != null
  const last = i === steps.length - 1

  function finish() {
    fire('success')
    if (profile) markSeen(profile.id)
    endTour()
  }

  return (
    // The conditional lives inside AnimatePresence, not around it — returning
    // null early would unmount the overlay instantly and skip the fade out.
    <AnimatePresence>
      {showing && (
        <motion.div
          key="tour"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="fixed inset-0 z-[70] flex flex-col justify-end"
          style={{ background: 'color-mix(in oklab, #000 62%, transparent)' }}
        >
          {/* Tapping the dimmed area does nothing on purpose: a stray tap while
            reading shouldn't silently end the walkthrough. */}
          <motion.div
            layout
            className="m-3 flex flex-col gap-4 rounded-[26px] p-5 safe-bottom"
            style={{
              background: 'var(--bg-elevated)',
              border: '1px solid var(--border-strong)',
              boxShadow: 'var(--shadow-lg)',
            }}
          >
            <div className="flex items-start gap-3">
              <span
                className="grid h-11 w-11 shrink-0 place-items-center rounded-2xl"
                style={{
                  background: 'color-mix(in oklab, var(--accent) 18%, transparent)',
                  color: 'var(--accent)',
                }}
              >
                <Icon name={step.icon} size={21} strokeWidth={2.2} />
              </span>

              <AnimatePresence mode="wait" initial={false}>
                <motion.div
                  key={i}
                  initial={{ opacity: 0, y: 8 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -8 }}
                  transition={{ duration: 0.18 }}
                  className="min-w-0 flex-1"
                >
                  <h2 className="text-[19px] font-bold leading-tight">{step.title}</h2>
                  <p
                    className="pt-1.5 text-[14px] leading-relaxed"
                    style={{ color: 'var(--text-dim)' }}
                  >
                    {step.body}
                  </p>

                  {step.points && (
                    <ul className="flex flex-col gap-2 pt-3">
                      {step.points.map((p) => (
                        <li key={p.text} className="flex items-center gap-2.5">
                          <span
                            className="grid h-7 w-7 shrink-0 place-items-center rounded-full"
                            style={{
                              background: 'var(--surface-3)',
                              color: 'var(--text-dim)',
                            }}
                          >
                            <Icon name={p.icon} size={14} strokeWidth={2.4} />
                          </span>
                          <span className="text-[13.5px]">{p.text}</span>
                        </li>
                      ))}
                    </ul>
                  )}
                </motion.div>
              </AnimatePresence>
            </div>

            <div className="flex items-center gap-3">
              <div className="flex flex-1 items-center gap-1.5">
                {steps.map((s, n) => (
                  <span
                    key={s.title}
                    className="h-1.5 rounded-full transition-all"
                    style={{
                      width: n === i ? 18 : 6,
                      background: n === i ? 'var(--accent)' : 'var(--surface-3)',
                    }}
                  />
                ))}
              </div>

              {i > 0 && (
                <button
                  onClick={() => {
                    fire('tap')
                    setI((n) => n - 1)
                  }}
                  className="rounded-full px-3 py-2 text-[13px]"
                  style={{ color: 'var(--text-dim)' }}
                >
                  Back
                </button>
              )}

              <button
                onClick={() => {
                  if (last) return finish()
                  fire('snap')
                  setI((n) => n + 1)
                }}
                className="rounded-full px-5 py-2.5 text-[14px] font-semibold text-white"
                style={{ background: 'var(--accent)' }}
              >
                {last ? 'Start using it' : 'Next'}
              </button>
            </div>

            {!last && (
              <button
                onClick={finish}
                className="text-[12px]"
                style={{ color: 'var(--text-faint)' }}
              >
                Skip — I'll work it out
              </button>
            )}
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  )
}
