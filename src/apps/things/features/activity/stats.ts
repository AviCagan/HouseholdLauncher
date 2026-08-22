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
  /**
   * Claims they took off somebody else AND then actually finished.
   *
   * Taking a claim is a promise, not an achievement — on its own it costs
   * nothing and moves no work. So a steal sits uncounted until the same person
   * completes the item, and a claim grabbed and left to rot scores zero.
   */
  stolen: number
  /**
   * Items taken off THEM and then finished by whoever took them.
   *
   * Counted separately rather than derived by subtraction, because with more
   * than two people in the household "thefts minus mine" is not the number of
   * times you were robbed — it is the number of times anyone else was.
   */
  robbed: number
}

/** Events that mean "this person finished something". */
const DONE_EVENTS = new Set<ActivityLog['event']>(['completed'])

/** A steal that was made good on, and when it was made good on. */
export interface SettledSteal {
  steal: ActivityLog
  completedAt: string
}

/**
 * Pair every steal with the completion that redeemed it, if there was one.
 *
 * Walked per item in time order rather than counted, because a recurring chore
 * produces many steals and many completions against one `row_id` over its
 * life, and the metric is about pairs: this steal, then this person finishing
 * that thing. Counting the two event types independently would let one
 * completion redeem every steal that ever happened to the chore.
 *
 * At most one steal is outstanding per item at a time — the item is only ever
 * on one person's plate — so a second steal supersedes the first rather than
 * queueing behind it, and the person who lost the claim before finishing it
 * gets no credit.
 */
export function settledSteals(entries: ActivityLog[]): SettledSteal[] {
  const byRow = new Map<string, ActivityLog[]>()
  for (const e of entries) {
    if (e.event !== 'stolen' && e.event !== 'completed') continue
    const list = byRow.get(e.row_id)
    if (list) list.push(e)
    else byRow.set(e.row_id, [e])
  }

  const settled: SettledSteal[] = []
  for (const list of byRow.values()) {
    const ordered = [...list].sort((a, b) => a.created_at.localeCompare(b.created_at))
    let pending: ActivityLog | null = null
    for (const e of ordered) {
      if (e.event === 'stolen') {
        pending = e
      } else if (pending && e.actor_id === pending.actor_id) {
        settled.push({ steal: pending, completedAt: e.created_at })
        pending = null
      }
    }
  }
  return settled
}

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

  /*
    Windowed on the completion, not on the steal.

    A steal scores when it is made good on, so that is the moment it belongs
    to. Windowing on the theft instead would drop a Sunday grab finished on
    Monday out of the Monday week, and — worse — briefly show a steal in the
    scoreboard before it had earned anything.

    Searched across every entry rather than only the recent ones, because the
    steal that a completion redeems can easily predate the window.
  */
  const settled = settledSteals(entries).filter((s) => s.completedAt >= sinceIso)

  return profileIds.map((profileId) => ({
    profileId,
    done: recent.filter((e) => e.actor_id === profileId && DONE_EVENTS.has(e.event)).length,
    added: recent.filter((e) => e.actor_id === profileId && e.event === 'added').length,
    claimed: claimedBy.filter((id) => id === profileId).length,
    stolen: settled.filter((s) => s.steal.actor_id === profileId).length,
    // subject_id is absent on rows written before 016, so those simply don't
    // count rather than counting against whoever happens to be first.
    robbed: settled.filter((s) => s.steal.subject_id === profileId).length,
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
