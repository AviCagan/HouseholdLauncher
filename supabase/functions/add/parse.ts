// Pure command parsing — no Deno, no network, no secrets.
//
// Split out of index.ts so the app's own Vitest suite can import and test it
// directly, the same way notify/classify.ts and calendar/ics.ts are.

export type ListName = 'todos' | 'chores' | 'shopping_items' | 'wishlist_items'

export interface ParsedCommand {
  list: ListName
  title: string
  urgency: number
  /** Canonical store name, matched against the household's real stores. */
  store: string | null
  /**
   * A store name that was clearly meant but matched nothing we have — so the
   * caller can ask which one instead of filing the item under nothing. Only
   * ever set for the shopping list, where a trailing "at ..." is a shop rather
   * than part of what was said.
   */
  storeSpoken: string | null
  /**
   * Whoever said "...this is Avi" / "...it's Jackie" at the end of the phrase,
   * resolved to a real profile slug. Lets one shared voice link or device be
   * used by both people with correct attribution — see resolveWho.
   */
  who: string | null
}

/** Must track `URGENCY.URGENT` in src/data/types.ts. */
export const URGENT_LEVEL = 2
const DEFAULT_URGENCY = 1

/**
 * What someone might plausibly call each list out loud. Ordered longest-first
 * at match time so "shopping list" wins over "list".
 */
const LIST_ALIASES: Record<string, ListName> = {
  todo: 'todos',
  todos: 'todos',
  'to do': 'todos',
  'to-do': 'todos',
  task: 'todos',
  tasks: 'todos',
  chore: 'chores',
  chores: 'chores',
  // The raw table names, so a shortcut configured with the literal value this
  // API returns keeps working. Underscores are normalised to spaces first.
  'shopping items': 'shopping_items',
  'wishlist items': 'wishlist_items',
  shopping: 'shopping_items',
  shop: 'shopping_items',
  store: 'shopping_items',
  grocery: 'shopping_items',
  groceries: 'shopping_items',
  wishlist: 'wishlist_items',
  wish: 'wishlist_items',
  wishes: 'wishlist_items',
  want: 'wishlist_items',
  wants: 'wishlist_items',
}

export function resolveList(raw: string | null | undefined): ListName | null {
  if (!raw) return null
  const key = raw.trim().toLowerCase().replace(/_/g, ' ')
  return LIST_ALIASES[key] ?? LIST_ALIASES[key.replace(/\s+list$/, '')] ?? null
}

/** Assistants love to prepend filler; none of it belongs in the item title. */
// The trailing (?:\s+|$) matters: without it a bare "add" fails to match and
// survives as the item's title.
const LEAD_NOISE =
  /^(?:hey\s+|ok\s+|okay\s+)?(?:google|siri|gemini|assistant)?[,\s]*(?:please\s+)?(?:can you\s+)?(?:go ahead and\s+)?(?:add|put|append|remember|note)(?:\s+|$)/i

const URGENT_WORDS = /\b(?:urgent|urgently|asap|right away|important)\b/gi

const norm = (s: string) => s.trim().toLowerCase().replace(/[.,!?;]+$/, '')

/** Case-insensitive match of a spoken phrase against the real store names. */
export function resolveStore(
  phrase: string | null | undefined,
  storeNames: string[],
): string | null {
  if (!phrase) return null
  const want = norm(phrase)
  if (!want) return null
  return (
    storeNames.find((n) => norm(n) === want) ??
    // "trader joes" for "Trader Joe's" — speech-to-text drops apostrophes.
    storeNames.find((n) => norm(n).replace(/[^a-z0-9]/g, '') === want.replace(/[^a-z0-9]/g, '')) ??
    null
  )
}

/** Case-insensitive match of a spoken name against the household's real people. */
export function resolveWho(
  phrase: string | null | undefined,
  people: { slug: string; name: string }[],
): string | null {
  if (!phrase) return null
  const want = norm(phrase)
  if (!want) return null
  const hit = people.find((p) => norm(p.slug) === want || norm(p.name) === want)
  return hit ? hit.slug : null
}

/**
 * The spoken sign-off a shared device or shared IFTTT applet relies on:
 * "...this is Avi", "...it's Jackie", "...I'm Avi". Always the very last
 * thing said, so it's stripped before any other clause extraction runs —
 * otherwise "milk at Costco, this is Avi" leaves "this is Avi" dangling off
 * the store name and neither resolves.
 */
const WHO_TRAILING = /\s*,?\s*(?:this is|it'?s|i'?m|i am)\s+([a-z]+)\s*$/i

const CONNECTOR = /\s+(?:to|at|in|on|from)\s+(?:the\s+|my\s+|our\s+)?/gi

/**
 * Every way the sentence could be split at a trailing "to/at/in ..." clause,
 * rightmost first.
 *
 * A single regex anchored to the end can't do this: the phrase it captures is
 * allowed to contain spaces, so in "milk to shopping at Costco" it swallows
 * "shopping at Costco" as one lump, which matches neither a list nor a store
 * and leaves the whole thing in the title. Trying the rightmost split first
 * peels off one clause at a time.
 */
function trailingSplits(body: string): { head: string; phrase: string }[] {
  const out: { head: string; phrase: string }[] = []
  CONNECTOR.lastIndex = 0
  let m: RegExpExecArray | null
  while ((m = CONNECTOR.exec(body)) !== null) {
    out.push({
      head: body.slice(0, m.index),
      phrase: body.slice(m.index + m[0].length).replace(/\s+list\s*$/i, '').trim(),
    })
  }
  CONNECTOR.lastIndex = 0
  return out.reverse()
}

/**
 * "add milk to the shopping list" → { list: shopping_items, title: "Milk" }
 * "add milk at Costco"            → { list: shopping_items, store: "Costco" }
 *
 * `listHint` and `storeHint` win when supplied, which is the normal case: a
 * Shortcut or an IFTTT applet is set up once per list (or once per store), so
 * the phrase itself only has to carry the item. Reading them out of the
 * sentence is the fallback for a single catch-all shortcut.
 *
 * Store names have to be passed in rather than guessed: a trailing clause is
 * only stripped when it genuinely names one of your lists or one of your
 * stores, so "add a note to the fridge" and "meet Sam at noon" keep every
 * word they were spoken with.
 */
export function parseCommand(
  text: string,
  listHint?: string | null,
  storeHint?: string | null,
  storeNames: string[] = [],
  people: { slug: string; name: string }[] = [],
): ParsedCommand | null {
  let body = (text ?? '').trim()
  if (!body) return null

  body = body.replace(LEAD_NOISE, '').trim()

  let list = resolveList(listHint)
  let store = resolveStore(storeHint, storeNames)

  let who: string | null = null
  const whoMatch = body.match(WHO_TRAILING)
  if (whoMatch) {
    const resolved = resolveWho(whoMatch[1], people)
    if (resolved) {
      who = resolved
      body = body.slice(0, whoMatch.index).trim()
    }
  }

  /*
    Strip up to two trailing clauses, so "milk at Costco to shopping" and
    "milk to shopping at Costco" both work. Each pass takes the clause only if
    it resolves to a real list or a real store; the moment one doesn't, the
    remaining words belong to the title and we stop.
  */
  for (let pass = 0; pass < 2; pass++) {
    const taken = trailingSplits(body).find(({ phrase }) => {
      const asList = resolveList(phrase)
      const asStore = resolveStore(phrase, storeNames)
      return (asList && !list) || (asStore && !store)
    })
    if (!taken) break

    const asList = resolveList(taken.phrase)
    if (asList && !list) list = asList
    else store = resolveStore(taken.phrase, storeNames)

    body = taken.head.trim()
  }

  // Naming a store only makes sense for the shopping list, and saying one is a
  // clear enough signal to pick that list when nothing else did.
  if (store && !list) list = 'shopping_items'

  /*
    On the shopping list only, a trailing "at ..." that matched nothing is
    still almost certainly a shop — someone saying "milk at Costco" before
    Costco exists, or speech-to-text mangling the name. Strip it and report it
    so the caller can ask which store was meant. Leaving it in would file the
    item as "Milk at Costco" with no store, which is the worst of both.
  */
  let storeSpoken: string | null = null
  if (list === 'shopping_items' && !store) {
    const candidate = body.match(/\s+(?:at|from|to)\s+(?:the\s+)?([\w' -]+?)\s*$/i)
    if (candidate) {
      storeSpoken = candidate[1].trim()
      body = body.slice(0, candidate.index).trim()
    }
  }

  let urgency = DEFAULT_URGENCY
  if (URGENT_WORDS.test(body)) {
    urgency = URGENT_LEVEL
    // Reset lastIndex — the regex is global, so a stale index would make the
    // very next call skip the start of its own string.
    URGENT_WORDS.lastIndex = 0
    body = body.replace(URGENT_WORDS, ' ')
  }
  URGENT_WORDS.lastIndex = 0

  // Strip articles left dangling by the removals above, then tidy whitespace.
  const title = body
    .replace(/^(?:an?|the|some)\s+/i, '')
    .replace(/\s+/g, ' ')
    .replace(/[.,!?;]+$/, '')
    .trim()

  if (!title) return null

  return {
    list: list ?? 'todos',
    title: title.charAt(0).toUpperCase() + title.slice(1),
    urgency,
    // A store on any list but shopping would be silently dropped on insert,
    // so don't claim one was understood.
    store: list === 'shopping_items' ? store : null,
    storeSpoken,
    who,
  }
}
