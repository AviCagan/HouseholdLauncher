import type { IconName } from '@/components/primitives/Icon'
import type {
  Chore,
  Debt,
  Dish,
  LexiconEntry,
  Meal,
  ShoppingItem,
  Store,
  Todo,
  WatchShow,
  WishlistItem,
} from '@/data/types'
import { formatPrice } from '@/lib/money'

/**
 * One search box over every app.
 *
 * On a phone you go into the app and look. On a laptop the quickest path to
 * "where did we put the plumber's number" is to type it once and be shown the
 * to-do, the dish, or the dictionary entry it lives in — so the command
 * palette searches all of them at once, and picking a result opens it in its
 * own app through the same deep links a notification uses.
 *
 * Pure, so it can be tested without a store: hand it the rows, get hits.
 */

export interface SearchSource {
  todos: Todo[]
  chores: Chore[]
  shopping_items: ShoppingItem[]
  wishlist_items: WishlistItem[]
  stores: Store[]
  debts: Debt[]
  dishes: Dish[]
  meals: Meal[]
  lexicon_entries: LexiconEntry[]
  watch_shows: WatchShow[]
}

export interface SearchHit {
  key: string
  appId: string
  title: string
  subtitle: string
  icon: IconName
  /** Handed to openApp — each app already knows how to read its own. */
  deepLink: Record<string, unknown>
  score: number
  /** Finished, bought, paid: still findable, ranked below what's live. */
  done: boolean
}

/**
 * How well `text` matches. 0 is no match.
 *
 * The whole field starting with the query beats a word in it starting with
 * the query, which beats the query turning up mid-word — "mi" should find
 * "Milk" before "Hummus mix" before "Tzimmes".
 */
export function matchScore(text: string | null | undefined, query: string): number {
  if (!text) return 0
  const t = text.toLowerCase()
  const q = query.toLowerCase()
  if (!q) return 0
  if (t === q) return 4
  if (t.startsWith(q)) return 3
  if (new RegExp(`(^|[\\s\\-_/(])${escapeRegExp(q)}`).test(t)) return 2
  if (t.includes(q)) return 1
  return 0
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/** Best of a primary field and some secondary ones, the latter worth less. */
function scoreOf(query: string, primary: string | null | undefined, ...secondary: (string | null | undefined)[]): number {
  const main = matchScore(primary, query)
  const rest = Math.max(0, ...secondary.map((s) => matchScore(s, query)))
  return Math.max(main, rest * 0.4)
}

export function searchEverything(
  query: string,
  src: SearchSource,
  canOpen: (appId: string) => boolean,
  limit = 40,
): SearchHit[] {
  const q = query.trim()
  if (q.length === 0) return []
  const hits: SearchHit[] = []
  const add = (hit: Omit<SearchHit, 'score'>, score: number) => {
    if (score > 0) hits.push({ ...hit, score })
  }

  if (canOpen('things')) {
    for (const t of src.todos) {
      add(
        {
          key: `todo:${t.id}`,
          appId: 'things',
          title: t.title,
          subtitle: t.is_done ? 'To-do · done' : 'To-do',
          icon: 'check',
          deepLink: { tab: 'todos', table: 'todos', id: t.id },
          done: t.is_done,
        },
        scoreOf(q, t.title, t.notes),
      )
    }
    for (const c of src.chores) {
      add(
        {
          key: `chore:${c.id}`,
          appId: 'things',
          title: c.title,
          subtitle: c.is_recurring ? 'Chore · repeats' : c.is_done ? 'Chore · done' : 'Chore',
          icon: 'repeat',
          deepLink: { tab: 'chores', table: 'chores', id: c.id },
          done: c.is_done && !c.is_recurring,
        },
        scoreOf(q, c.title, c.notes),
      )
    }
    const storeName = (id: string | null) => src.stores.find((s) => s.id === id)?.name
    for (const i of src.shopping_items) {
      const where = storeName(i.store_id)
      add(
        {
          key: `shop:${i.id}`,
          appId: 'things',
          title: i.title,
          subtitle: ['Shopping', where, i.quantity, i.is_done ? 'bought' : null].filter(Boolean).join(' · '),
          icon: 'cart',
          deepLink: { tab: 'shopping', table: 'shopping_items', id: i.id },
          done: i.is_done,
        },
        scoreOf(q, i.title, where),
      )
    }
    for (const w of src.wishlist_items) {
      add(
        {
          key: `wish:${w.id}`,
          appId: 'things',
          title: w.title,
          subtitle: ['Wishlist', w.price_cents != null ? formatPrice(w.price_cents) : null, w.is_purchased ? 'bought' : null]
            .filter(Boolean)
            .join(' · '),
          icon: 'star',
          deepLink: { tab: 'wishlist', table: 'wishlist_items', id: w.id },
          done: w.is_purchased,
        },
        scoreOf(q, w.title, w.notes),
      )
    }
  }

  if (canOpen('owe')) {
    for (const d of src.debts) {
      add(
        {
          key: `debt:${d.id}`,
          appId: 'owe',
          title: `${d.counterparty} · ${formatPrice(d.amount_cents)}`,
          subtitle: [d.direction === 'owed_to_us' ? 'Owes us' : 'We owe', d.reason, d.is_paid ? 'paid' : null]
            .filter(Boolean)
            .join(' · '),
          icon: 'wallet',
          deepLink: { id: d.id },
          done: d.is_paid,
        },
        scoreOf(q, d.counterparty, d.reason),
      )
    }
  }

  if (canOpen('meals')) {
    for (const d of src.dishes) {
      add(
        {
          key: `dish:${d.id}`,
          appId: 'meals',
          title: `${d.emoji} ${d.name}`,
          subtitle: `Dish · ${d.kind}`,
          icon: 'chef',
          deepLink: { tab: 'dishes', id: d.id },
          done: false,
        },
        scoreOf(q, d.name, ...d.ingredients.map((i) => i.name), ...d.tags),
      )
    }
    for (const m of src.meals) {
      add(
        {
          key: `meal:${m.id}`,
          appId: 'meals',
          title: `${m.emoji} ${m.name}`,
          subtitle: m.planned_for ? `Meal · ${m.planned_for}` : 'Meal · saved',
          icon: 'chef',
          deepLink: { tab: 'meals', id: m.id },
          done: false,
        },
        scoreOf(q, m.name, m.notes),
      )
    }
  }

  if (canOpen('encyclopedia')) {
    for (const e of src.lexicon_entries) {
      add(
        {
          key: `lex:${e.id}`,
          appId: 'encyclopedia',
          title: e.term,
          subtitle: e.definition,
          icon: 'book',
          deepLink: { id: e.id },
          done: false,
        },
        scoreOf(q, e.term, e.definition, e.example),
      )
    }
  }

  if (canOpen('watched')) {
    for (const s of src.watch_shows) {
      add(
        {
          key: `show:${s.id}`,
          appId: 'watched',
          title: s.title,
          subtitle: `Show · ${STAGE_LABEL[s.stage]}`,
          icon: 'tv',
          deepLink: { tab: s.stage === 'shelf' ? 'shelf' : 'onair', id: s.id },
          done: s.stage === 'watched' || s.stage === 'dropped',
        },
        scoreOf(q, s.title, s.network),
      )
    }
  }

  // Something finished still turns up, but a live match a notch weaker
  // outranks it: the milk on today's list before the milk bought in March.
  const rank = (h: SearchHit) => h.score - (h.done ? 1.5 : 0)
  return hits.sort((a, b) => rank(b) - rank(a) || a.title.localeCompare(b.title)).slice(0, limit)
}

const STAGE_LABEL: Record<WatchShow['stage'], string> = {
  shelf: 'to be watched',
  lineup: 'in the lineup',
  watching: 'watching',
  watched: 'watched',
  dropped: 'dropped',
}
