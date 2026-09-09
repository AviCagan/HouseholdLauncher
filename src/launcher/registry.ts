import type { IconName } from '@/components/primitives/Icon'

/**
 * Every app the launcher knows about.
 *
 * The registry is the single place an app is declared, and everything else
 * derives from it: the home grid, the visibility list in settings, the per-app
 * notification preferences, the access checkboxes when adding a person, and
 * the badge counts. Adding an app is one entry here plus a screen component —
 * nothing else needs to learn its name.
 *
 * `id` is written into `app_access.app_id`, `notifications.app_id` and the
 * preference tables, so it is a permanent key: renaming one orphans every
 * grant and every stored preference for that app. Change the `name` instead,
 * which is only ever displayed.
 */
export interface AppDef {
  id: string
  name: string
  /** One line under the name on the home tile and in settings. */
  blurb: string
  icon: IconName
  /** Tile colour. Also tints that app's rows in the notification centre. */
  color: string
  /**
   * Where this app can actually run.
   *
   * Bluetooth control is the reason this exists: iOS gives a web app no way to
   * see or change the phone's pairings, so on iPhone the app is not "broken",
   * it is genuinely impossible. Listing the platforms lets the launcher say
   * that plainly on the tile rather than opening a screen that cannot work.
   */
  platforms: ('android' | 'web')[]
  /**
   * Apps every member gets without an explicit grant.
   *
   * Only for things with nothing private in them. Anything holding money or
   * personal history stays opt-in, so a guest added in a hurry doesn't land on
   * the Owe list by default.
   */
  defaultForEveryone?: boolean
}

export const APPS: AppDef[] = [
  {
    id: 'things',
    name: 'Things',
    blurb: 'To-dos, chores, shopping and wishlist',
    icon: 'check',
    color: '#7c5cff',
    platforms: ['android', 'web'],
    defaultForEveryone: true,
  },
  {
    id: 'owe',
    name: 'Owe & Owed',
    blurb: "Who owes you, and who you owe",
    icon: 'wallet',
    color: '#3fa96b',
    platforms: ['android', 'web'],
  },
  {
    id: 'meals',
    name: 'Meals',
    blurb: 'Dishes, dinners, and what they cost',
    icon: 'chef',
    color: '#ff7a59',
    platforms: ['android', 'web'],
    defaultForEveryone: true,
  },
  {
    id: 'encyclopedia',
    name: 'A&J Encyclopedia',
    blurb: 'The words only the two of you use',
    icon: 'book',
    color: '#7c2f3a',
    platforms: ['android', 'web'],
    // Not for everyone by default: a private vocabulary is exactly the kind
    // of personal history the comment on `defaultForEveryone` is about.
  },
  {
    id: 'bluetooth',
    name: 'Bluetooth',
    blurb: 'Drop the car without digging through settings',
    icon: 'bluetooth',
    color: '#2f7fe0',
    // Android only, and not by choice — see the platforms comment above.
    platforms: ['android'],
  },
]

export const APP_IDS = APPS.map((a) => a.id)

export const appById = (id: string): AppDef | undefined =>
  APPS.find((a) => a.id === id)

/** Display name for an app id, falling back to the raw id for stale rows. */
export const appName = (id: string): string => appById(id)?.name ?? id
