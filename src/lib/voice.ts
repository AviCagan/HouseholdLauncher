import { SUPABASE_URL } from './env'
import type { TabKey } from '@/data/types'

/**
 * URLs for the voice-add endpoint.
 *
 * Neither assistant has a real third-party integration for something like
 * this — Apple's App Intents need a native App Store app and Google Home
 * routines can't make arbitrary HTTP calls — so both are driven by hitting a
 * plain authenticated URL: Siri through the Shortcuts app, Google through an
 * IFTTT applet or an Android shortcut.
 */

/** A fresh, unguessable token. Regenerating one revokes every old shortcut. */
export function newVoiceToken(): string {
  return crypto.randomUUID().replace(/-/g, '')
}

export const VOICE_LISTS: { key: TabKey; list: string; label: string }[] = [
  { key: 'todos', list: 'todos', label: 'To-do' },
  { key: 'chores', list: 'chores', label: 'Chores' },
  { key: 'shopping', list: 'shopping_items', label: 'Shopping' },
  { key: 'wishlist', list: 'wishlist_items', label: 'Wishlist' },
]

/**
 * The URL a shortcut calls. `list` pins it to one list so the spoken phrase
 * only has to carry the item; leaving it off lets the endpoint work the list
 * out of the sentence instead.
 *
 * `TEXT` is left as a literal placeholder rather than encoded, because both
 * Shortcuts and IFTTT ask you to drop their own variable in by hand and an
 * escaped one wouldn't be substituted.
 */
export function voiceUrl(
  token: string | null,
  list?: string,
  who?: string | null,
  store?: string | null,
): string {
  if (!token || !SUPABASE_URL) return ''
  const params = new URLSearchParams({ token })
  if (list) params.set('list', list)
  if (who) params.set('who', who)
  // Pins a shortcut to one shop, so the phrase only has to carry the item.
  // Saying "at Costco" out loud works too — the endpoint matches spoken store
  // names against the real ones — but a per-store shortcut is fewer words.
  if (store) params.set('store', store)
  return `${SUPABASE_URL}/functions/v1/add?${params.toString()}&text=TEXT`
}
