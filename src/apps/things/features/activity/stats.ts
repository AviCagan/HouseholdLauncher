import { isResting } from '@/lib/time'
import { URGENCY } from '@/data/types'
import type { ActivityLog, Chore, ShoppingItem, Todo, WishlistItem } from '@/data/types'

/**
 * Pure derivations behind the summary view — no store imports, so the counting
 * rules can be unit tested without a database or a rendered tree.
 */

export interface Outstanding {
  todos: number
  /** Chores that are actually actionable now — resting ones aren't. */
  chores: number
  /** On cooldown, shown separately so "nothing to do" stays truthful. */
  resting: number
  shopping: number
  wishlist: number
  /** Everything actionable, which is the number the summary leads with. */
  total: number
  /** Top-urgency items across to-dos, chores and shopping. */
  urgent: number
  /** Actionable items nobody has put their name to yet. */
  unclaimed: number
}

export function outstanding(
  todos: Todo[],
  chores: Chore[],
  shopping: ShoppingItem[],
  wishlist: WishlistItem[],
  now: number,
): Outstanding {
  const openTodos = todos.filter((t) => !t.is_done)
  const openShopping = shopping.filter((s) => !s.is_done)
  const liveChores = chores.filter((c) => !c.is_done)
  const activeChores = liveChores.filter((c) => !isResting(c, now))
  const resting = liveChores.length - activeChores.length
  const openWishes = wishlist.filter((w) => !w.is_purchased)

  const actionable = [...openTodos, ...activeChores, ...openShopping]

  return {
    todos: openTodos.length,
    chores: activeChores.length,
    resting,
    shopping: openShopping.length,
    wishlist: openWishes.length,
    total: actionable.length,
    urgent: actionable.filter((i) => i.urgency >= URGENCY.URGENT).length,
    unclaimed: actionable.filter((i) => i.claimed_by === null).length,
  }
}

export interface Score {
  profileId: string
  /** Items finished in the window. */
  done: number
  /** Items added in the window — noticing what needs doing is work too. */
  added: number
  /** Currently on their plate. */
  claimed: number
}

/** Events that mean "this person finished something". */
const DONE_EVENTS = new Set<ActivityLog['event']>(['completed'])

/**
 * Head-to-head counts over a time window.
 *
 * Reads from activity_log rather than from the rows themselves because a
 * completed to-do is eventually swept away by auto-clear, and a recurring
 * chore overwrites its own last completion every cycle — neither leaves a
 * countable trace behind. The log is the only place the history survives.
 *
 * Caveat worth knowing: the client holds the most recent 200 entries, so a
 * window longer than that many events undercounts. For two people that is
 * comfortably more than a month.
 */
export function scoreboard(
  entries: ActivityLog[],
  profileIds: string[],
  sinceIso: string,
  claimedBy: (string | null)[],
): Score[] {
  const recent = entries.filter((e) => e.created_at >= sinceIso)

  return profileIds.map((profileId) => ({
    profileId,
    done: recent.filter((e) => e.actor_id === profileId && DONE_EVENTS.has(e.event)).length,
    added: recent.filter((e) => e.actor_id === profileId && e.event === 'added').length,
    claimed: claimedBy.filter((id) => id === profileId).length,
  }))
}

export const daysAgoIso = (days: number, now: number = Date.now()): string =>
  new Date(now - days * 86_400_000).toISOString()

/**
 * Share of the window's completions, for the comparison bar. Returns 0.5 for
 * both when nobody has done anything, so an empty week renders as level rather
 * than as one person winning by default.
 */
export function shareOfDone(scores: Score[]): number[] {
  const total = scores.reduce((sum, s) => sum + s.done, 0)
  if (total === 0) return scores.map(() => 1 / Math.max(1, scores.length))
  return scores.map((s) => s.done / total)
}
