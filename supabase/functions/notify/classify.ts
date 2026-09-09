// Pure event classification — no Deno, no network, no secrets.
//
// Split out of index.ts specifically so it can be unit tested from the app's
// own suite. The urgency threshold here regressed silently once before: when
// urgency was cut from a four-level scale (0-3) to three levels (0-2), this
// file's `>= 3` check was left behind. It could never be true again, so
// `urgent_added` stopped firing — masked because `any_added` still covered
// every insert, so nothing looked broken in casual testing.

export type NotifyEvent =
  | 'claim_complete'
  | 'cooldown_ready'
  | 'urgent_added'
  | 'any_added'
  | 'item_edited'
  | 'claim_stolen'
  // Owe & Owed
  | 'debt_added'
  | 'debt_paid'
  // Meals
  | 'dish_added'
  | 'meal_planned'
  // A&J Encyclopedia
  | 'entry_added'

export interface Push {
  title: string
  body: string
  tab?: string
  itemId?: string
  tag?: string
}

export const TAB_FOR: Record<string, string> = {
  todos: 'todos',
  chores: 'chores',
  shopping_items: 'shopping',
  wishlist_items: 'wishlist',
}

const NOUN: Record<string, string> = {
  todos: 'to-do',
  chores: 'chore',
  shopping_items: 'shopping item',
  wishlist_items: 'wish',
}

/**
 * Which launcher app a table belongs to.
 *
 * The launcher routes by app, not by table: badges are per app, the
 * notification centre groups by app, and `app_notify_prefs` is keyed on app.
 * A table missing from here has no owning app, so nothing is announced for it
 * at all — which is the right default for a new table nobody has decided how
 * to surface yet.
 */
export const APP_FOR: Record<string, string> = {
  todos: 'things',
  chores: 'things',
  shopping_items: 'things',
  wishlist_items: 'things',
  debts: 'owe',
  dishes: 'meals',
  meals: 'meals',
  lexicon_entries: 'encyclopedia',
}

export interface Row {
  id: string
  title?: string
  urgency?: number
  claimed_by?: string | null
  created_by?: string | null
  updated_by?: string | null
  completed_by?: string | null
  is_done?: boolean
  last_completed_by?: string | null

  // dishes, meals
  name?: string
  emoji?: string
  occasion?: string
  planned_for?: string | null
  people?: number

  // lexicon_entries
  term?: string
  part_of_speech?: string
  definition?: string

  // debts
  counterparty?: string
  amount_cents?: number
  direction?: 'owed_to_us' | 'we_owe'
  is_paid?: boolean
  paid_by?: string | null
  reason?: string | null
}

export interface WebhookBody {
  type: 'INSERT' | 'UPDATE' | 'DELETE'
  table: string
  record: Row | null
  old_record: Row | null
}

export interface Classified {
  event: NotifyEvent
  /** The launcher app this belongs to — see APP_FOR. */
  appId: string
  actorId: string | null
  targetId: string | null
  push: Push
}

/**
 * The top urgency level. Must track `URGENCY.URGENT` in `src/data/types.ts` —
 * there is no automated link between the two, which is exactly how this broke
 * last time.
 */
export const URGENT_LEVEL = 2

/**
 * Decide what (if anything) this change should announce, and to whom.
 *
 * `any_added` fully subsumes `urgent_added`, so an insert resolves to exactly
 * one event and the recipient never gets two notifications for one action.
 */
export function classify(body: WebhookBody): Classified | null {
  const { type, table, record, old_record } = body
  if (!record) return null

  const appId = APP_FOR[table]
  // No owning app means nothing knows how to display it, so nothing is sent.
  if (!appId) return null

  if (table === 'debts') return classifyDebt(type, record, old_record)
  if (table === 'dishes' || table === 'meals') return classifyMeal(table, type, record)
  if (table === 'lexicon_entries') return classifyEntry(type, record)

  const tab = TAB_FOR[table]
  const noun = NOUN[table] ?? 'item'
  const title = record.title ?? 'Something'

  if (type === 'INSERT') {
    const urgent = (record.urgency ?? 0) >= URGENT_LEVEL
    return {
      event: urgent ? 'urgent_added' : 'any_added',
      appId,
      actorId: record.created_by ?? null,
      targetId: null, // the other person, resolved later
      push: {
        title: urgent ? `Urgent ${noun}` : `New ${noun}`,
        body: title,
        tab,
        itemId: record.id,
        tag: `add-${record.id}`,
      },
    }
  }

  if (type === 'UPDATE' && old_record) {
    /*
      Taken off someone.

      Checked before the newly-claimed branch below, which only tests that the
      new value is set and the old one wasn't — a steal satisfies neither half,
      so it would otherwise fall through to 'edited' or to nothing.

      `targetId` is the victim rather than "everyone but the actor". This is
      the one event whose entire audience is a single specific person: being
      told a claim you never had was reassigned is noise, and being told yours
      was is the point.
    */
    if (
      old_record.claimed_by &&
      record.claimed_by &&
      old_record.claimed_by !== record.claimed_by
    ) {
      return {
        event: 'claim_stolen',
        appId,
        actorId: record.claimed_by,
        targetId: old_record.claimed_by,
        push: {
          title: 'Taken off you',
          body: title,
          tab,
          itemId: record.id,
          tag: `steal-${record.id}`,
        },
      }
    }

    // Newly claimed
    if (!old_record.claimed_by && record.claimed_by) {
      return {
        event: 'claim_complete',
        appId,
        actorId: record.claimed_by,
        targetId: record.created_by ?? null,
        push: {
          title: 'Claimed',
          body: title,
          tab,
          itemId: record.id,
          tag: `claim-${record.id}`,
        },
      }
    }
    // Newly completed (one-off)
    if (!old_record.is_done && record.is_done) {
      return {
        event: 'claim_complete',
        appId,
        // `completed_by` is written by toggleTodo/toggleShoppingItem and is the
        // only thing that identifies who actually ticked it. This used to be a
        // hardcoded null, which made `recipients()` skip its own
        // exclude-the-actor rule — so finishing your own to-do pushed a "Done"
        // notification straight back to your own phone.
        actorId: record.completed_by ?? record.claimed_by ?? null,
        targetId: record.created_by ?? null,
        push: {
          title: 'Done',
          body: title,
          tab,
          itemId: record.id,
          tag: `done-${record.id}`,
        },
      }
    }
    // Recurring chore completed — starts a cooldown rather than finishing.
    if (
      table === 'chores' &&
      record.last_completed_by &&
      old_record.last_completed_by !== record.last_completed_by
    ) {
      return {
        event: 'claim_complete',
        appId,
        actorId: record.last_completed_by,
        targetId: null,
        push: {
          title: 'Chore done',
          body: `${title} — resting now`,
          tab: 'chores',
          itemId: record.id,
          tag: `chore-${record.id}`,
        },
      }
    }
    // Fallback: anything else that counts as an edit — title, notes, price,
    // recurrence, and so on. Checked last, same as log_activity()'s trigger,
    // so a change that's already claim/complete/cooldown doesn't also fire
    // this one.
    if (record.updated_by && old_record.updated_by !== record.updated_by) {
      return {
        event: 'item_edited',
        appId,
        actorId: record.updated_by,
        targetId: null,
        push: {
          title: 'Edited',
          body: title,
          tab,
          itemId: record.id,
          tag: `edit-${record.id}`,
        },
      }
    }
  }

  return null
}

/**
 * Owe & Owed.
 *
 * Only two events are worth a phone buzz: an entry appearing, and one being
 * settled. Edits are not announced — correcting a typo in "what for" is not
 * news, and the list is short enough that a change is seen next time it is
 * opened.
 *
 * Amounts are formatted here rather than in the app because the notification
 * has to read correctly on a lock screen, with no styling and no context: the
 * whole message is the title and one line.
 */
function classifyDebt(
  type: WebhookBody['type'],
  record: Row,
  old: Row | null,
): Classified | null {
  const who = record.counterparty ?? 'Someone'
  const amount = formatCents(record.amount_cents ?? 0)
  const inbound = record.direction === 'owed_to_us'

  if (type === 'INSERT') {
    return {
      event: 'debt_added',
      appId: 'owe',
      actorId: record.created_by ?? null,
      targetId: null,
      push: {
        title: inbound ? `${who} owes ${amount}` : `We owe ${who} ${amount}`,
        body: record.reason ?? 'Added to the list',
        tab: inbound ? 'owed_to_us' : 'we_owe',
        itemId: record.id,
        tag: `debt-${record.id}`,
      },
    }
  }

  // Settled. Guarded on the transition rather than on is_paid alone, so an
  // edit to an already-paid row doesn't re-announce it.
  if (type === 'UPDATE' && old && !old.is_paid && record.is_paid) {
    return {
      event: 'debt_paid',
      appId: 'owe',
      actorId: record.paid_by ?? record.updated_by ?? null,
      targetId: null,
      push: {
        title: 'Marked paid',
        body: `${who} · ${amount}`,
        tab: inbound ? 'owed_to_us' : 'we_owe',
        itemId: record.id,
        tag: `debt-paid-${record.id}`,
      },
    }
  }

  return null
}

/**
 * Meals announces two things and nothing else: a dish joining the library,
 * and a meal being planned. Edits are silent — the trigger only fires on
 * INSERT — so correcting a typo in a recipe never buzzes the other phone.
 */
function classifyMeal(
  table: 'dishes' | 'meals',
  type: WebhookBody['type'],
  record: Row,
): Classified | null {
  if (type !== 'INSERT') return null
  const name = record.name ?? 'Something'
  const emoji = record.emoji ?? '🍽️'

  if (table === 'dishes') {
    return {
      event: 'dish_added',
      appId: 'meals',
      actorId: record.created_by ?? null,
      targetId: null,
      push: {
        title: 'New dish',
        body: `${emoji} ${name}`,
        tab: 'dishes',
        itemId: record.id,
        tag: `dish-${record.id}`,
      },
    }
  }

  const when = record.planned_for ? ` for ${prettyDate(record.planned_for)}` : ''
  const heads = record.people && record.people > 0 ? ` · ${record.people} people` : ''
  return {
    event: 'meal_planned',
    appId: 'meals',
    actorId: record.created_by ?? null,
    targetId: null,
    push: {
      title: `${emoji} ${name}`,
      body: `Meal planned${when}${heads}`,
      tab: 'meals',
      itemId: record.id,
      tag: `meal-${record.id}`,
    },
  }
}

/** How a dictionary abbreviates the part of speech. Must track PARTS_OF_SPEECH in src/data/types.ts. */
const POS_ABBR: Record<string, string> = {
  noun: 'n.', verb: 'v.', adjective: 'adj.', adverb: 'adv.',
  interjection: 'interj.', phrase: 'phr.', name: 'prop. n.', other: '',
}

/**
 * The Encyclopedia announces one thing: a new word. The notification is laid
 * out like the entry itself — headword, part of speech, the first line of the
 * definition — because that is the whole pleasure of it arriving.
 */
function classifyEntry(type: WebhookBody['type'], record: Row): Classified | null {
  if (type !== 'INSERT') return null
  const term = record.term?.trim() || 'A new word'
  const abbr = record.part_of_speech ? POS_ABBR[record.part_of_speech] ?? '' : ''
  const definition = (record.definition ?? '').trim()
  return {
    event: 'entry_added',
    appId: 'encyclopedia',
    actorId: record.created_by ?? null,
    targetId: null,
    push: {
      title: `📖 ${term}${abbr ? ` (${abbr})` : ''}`,
      body: definition ? (definition.length > 120 ? `${definition.slice(0, 117)}…` : definition) : 'Added to the encyclopedia',
      tab: 'entries',
      itemId: record.id,
      tag: `entry-${record.id}`,
    },
  }
}

/** "2026-09-12" → "Fri 12 Sep". Not localised: the household is one place. */
function prettyDate(iso: string): string {
  const d = new Date(`${iso}T12:00:00Z`)
  if (Number.isNaN(d.getTime())) return iso
  return d.toLocaleDateString('en-US', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' })
}

/** 1250 -> "$12.50", 20000 -> "$200". Whole amounts drop the cents. */
function formatCents(cents: number): string {
  const dollars = cents / 100
  return cents % 100 === 0 ? `$${dollars.toLocaleString('en-US')}` : `$${dollars.toFixed(2)}`
}
