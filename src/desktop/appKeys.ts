/**
 * The second key of each app's "go to" shortcut: G then T for Things.
 *
 * Kept beside the registry rather than in it, because the registry is shared
 * with the phone, which has no keyboard to speak of. An app missing from here
 * still appears in the sidebar and the command palette — it just has no
 * two-key shortcut until someone picks a letter that isn't taken.
 *
 * Taken by the shell itself: H (overview), I (inbox), S (settings).
 */
export const APP_KEYS: Record<string, string> = {
  things: 't',
  owe: 'o',
  meals: 'm',
  encyclopedia: 'e',
  watched: 'w',
  bluetooth: 'b',
}
