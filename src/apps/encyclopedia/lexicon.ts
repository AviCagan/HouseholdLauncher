import type { LexiconEntry, PartOfSpeech } from '@/data/types'

/**
 * The pure parts of the Encyclopedia — alphabetising, searching, and picking
 * the word of the day — kept away from React so they can be tested on their
 * own, and so the layout code stays about layout.
 */

/** How a dictionary abbreviates it. */
export const POS_ABBR: Record<PartOfSpeech, string> = {
  noun: 'n.',
  verb: 'v.',
  adjective: 'adj.',
  adverb: 'adv.',
  interjection: 'interj.',
  phrase: 'phr.',
  name: 'prop. n.',
  other: '',
}

export const POS_LABEL: Record<PartOfSpeech, string> = {
  noun: 'Noun',
  verb: 'Verb',
  adjective: 'Adjective',
  adverb: 'Adverb',
  interjection: 'Interjection',
  phrase: 'Phrase',
  name: 'Name',
  other: 'Other',
}

export const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('')

/**
 * The letter an entry files under: the first letter of the term, accents
 * stripped, uppercased. Anything that doesn't start with a letter — a number,
 * an emoji, "…" — goes under '#', which sorts to the end.
 */
export function initialOf(term: string): string {
  const stripped = term.normalize('NFD').replace(/[̀-ͯ]/g, '').trim()
  const first = stripped.match(/[A-Za-z]/)?.[0]
  const idx = stripped.search(/[A-Za-z]/)
  // Only a letter that comes before any other real character counts, so
  // "2-in-the-morning" files under '#', not 'I'.
  if (!first || (idx > 0 && /[0-9]/.test(stripped.slice(0, idx)))) return '#'
  return first.toUpperCase()
}

const collator = new Intl.Collator(undefined, { sensitivity: 'base', numeric: true })

/** Alphabetical, ignoring case and accents; ties broken by age so order is stable. */
export function sortEntries(entries: LexiconEntry[]): LexiconEntry[] {
  return [...entries].sort(
    (a, b) => collator.compare(a.term.trim(), b.term.trim()) || a.created_at.localeCompare(b.created_at),
  )
}

export interface LetterGroup {
  letter: string
  entries: LexiconEntry[]
}

/** The entries in dictionary order, sectioned by letter, '#' last. */
export function groupByLetter(entries: LexiconEntry[]): LetterGroup[] {
  const groups = new Map<string, LexiconEntry[]>()
  for (const e of sortEntries(entries)) {
    const letter = initialOf(e.term)
    const list = groups.get(letter) ?? []
    list.push(e)
    groups.set(letter, list)
  }
  return [...groups.entries()]
    .sort(([a], [b]) => (a === '#' ? 1 : b === '#' ? -1 : a.localeCompare(b)))
    .map(([letter, list]) => ({ letter, entries: list }))
}

const fold = (s: string) =>
  s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()

/**
 * Look a word up.
 *
 * Ranked rather than filtered: a term that starts with what was typed comes
 * before one that merely contains it, which comes before one whose
 * definition mentions it. Typing "sch" should put "schlumpy" at the top even
 * when six definitions happen to contain "schedule".
 */
export function searchEntries(entries: LexiconEntry[], query: string): LexiconEntry[] {
  const q = fold(query.trim())
  if (!q) return sortEntries(entries)
  const rank = (e: LexiconEntry): number => {
    const term = fold(e.term)
    if (term === q) return 0
    if (term.startsWith(q)) return 1
    if (term.includes(q)) return 2
    if (fold(e.definition).includes(q)) return 3
    if (fold(`${e.example ?? ''} ${e.origin ?? ''} ${e.pronunciation ?? ''} ${e.tags.join(' ')}`).includes(q)) return 4
    return -1
  }
  return sortEntries(entries)
    .map((e) => [rank(e), e] as const)
    .filter(([r]) => r >= 0)
    .sort(([a], [b]) => a - b)
    .map(([, e]) => e)
}

/**
 * Today's word, the same for both phones and for the whole day: the date
 * hashed into an index. A new entry shifts which word lands on which day,
 * which is fine — it is a page to open the book to, not a schedule.
 */
export function wordOfTheDay(entries: LexiconEntry[], date: Date): LexiconEntry | null {
  if (entries.length === 0) return null
  const key = `${date.getFullYear()}-${date.getMonth() + 1}-${date.getDate()}`
  let h = 5381
  for (const ch of key) h = (h * 33) ^ ch.charCodeAt(0)
  const sorted = sortEntries(entries)
  return sorted[Math.abs(h) % sorted.length]
}

/** "SHLUM-pee" → "/SHLUM-pee/"; something already bracketed is left alone. */
export function formatPronunciation(p: string | null): string | null {
  const t = p?.trim()
  if (!t) return null
  if (/^[/[(]/.test(t)) return t
  return `/${t}/`
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

/** "2026-09-12T…" → "12 Sep 2026". Day-month-year, the way a citation reads. */
export function longDate(iso: string): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  return `${d.getDate()} ${MONTHS[d.getMonth()]} ${d.getFullYear()}`
}

/** "Added by Jackie · 12 Sep 2026 · revised by Avi". */
export function citation(entry: LexiconEntry, nameOf: (id: string) => string): string {
  const parts = [
    entry.created_by ? `Added by ${nameOf(entry.created_by)}` : 'Added',
    longDate(entry.created_at),
  ]
  if (entry.updated_by && entry.updated_by !== entry.created_by) parts.push(`revised by ${nameOf(entry.updated_by)}`)
  return parts.filter(Boolean).join(' · ')
}

/** A word count that reads like a title page. */
export function volumeLine(count: number): string {
  if (count === 0) return 'Volume I · no entries yet'
  return `Volume I · ${count} ${count === 1 ? 'entry' : 'entries'}`
}
