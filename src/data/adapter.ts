import type {
  ActivityLog,
  AppAccess,
  AppNotification,
  AppNotifyPref,
  AppPref,
  Chore,
  Debt,
  Dish,
  HouseholdSettings,
  Meal,
  MealTemplate,
  Profile,
  ProfileSettings,
  ShoppingItem,
  ShoppingTrip,
  Store,
  Todo,
  WishlistItem,
} from './types'

/** Every synced collection. Realtime binds one handler per entry. */
export const TABLES = [
  'todos',
  'chores',
  'shopping_items',
  'stores',
  'wishlist_items',
  'profiles',
  'profile_settings',
  'household_settings',
  'shopping_trips',
  'activity_log',
  // Launcher. Adding a name here is all it takes for the store to load it, the
  // local adapter to persist it and realtime to bind a channel to it.
  'app_access',
  'app_prefs',
  'app_notify_prefs',
  'notifications',
  'debts',
  // Meals.
  'dishes',
  'meal_templates',
  'meals',
] as const

export type TableName = (typeof TABLES)[number]

export interface TableMap {
  todos: Todo
  chores: Chore
  shopping_items: ShoppingItem
  stores: Store
  wishlist_items: WishlistItem
  profiles: Profile
  profile_settings: ProfileSettings
  household_settings: HouseholdSettings
  shopping_trips: ShoppingTrip
  activity_log: ActivityLog
  app_access: AppAccess
  app_prefs: AppPref
  app_notify_prefs: AppNotifyPref
  notifications: AppNotification
  debts: Debt
  dishes: Dish
  meal_templates: MealTemplate
  meals: Meal
}

export type ChangeEvent<T extends TableName = TableName> =
  | { table: T; type: 'insert' | 'update'; row: TableMap[T] }
  | { table: T; type: 'delete'; id: string }

export type ChangeHandler = (event: ChangeEvent) => void

/**
 * Result of an atomic claim. Claiming is a genuine race between two phones, so
 * it is never read-then-write — the database arbitrates via a conditional
 * update and `won: false` means the other person got there first.
 */
export interface ClaimResult<T> {
  won: boolean
  row?: T
}

export interface DataAdapter {
  readonly kind: 'local' | 'supabase'

  list<T extends TableName>(table: T): Promise<TableMap[T][]>
  insert<T extends TableName>(table: T, row: TableMap[T]): Promise<TableMap[T]>
  update<T extends TableName>(
    table: T,
    id: string,
    patch: Partial<TableMap[T]>,
  ): Promise<TableMap[T] | null>
  remove(table: TableName, id: string): Promise<void>

  /** Conditional update: only succeeds while `claimed_by` is still null. */
  claim<T extends 'todos' | 'chores' | 'shopping_items'>(
    table: T,
    id: string,
    profileId: string,
  ): Promise<ClaimResult<TableMap[T]>>

  /** Release your own claim. No-op if someone else holds it. */
  unclaim<T extends 'todos' | 'chores' | 'shopping_items'>(
    table: T,
    id: string,
    profileId: string,
  ): Promise<TableMap[T] | null>

  /**
   * Take a claim off whoever currently holds it.
   *
   * Conditional on `seenHolder` rather than unconditional, which matters for
   * the same reason `claim` is conditional: between the row being drawn and
   * the tap landing, the holder may have released it or been robbed by the
   * third phone. Overwriting blindly would record a theft from someone who no
   * longer had it, and `won: false` lets the caller re-read and say so.
   */
  steal<T extends 'todos' | 'chores' | 'shopping_items'>(
    table: T,
    id: string,
    profileId: string,
    seenHolder: string,
  ): Promise<ClaimResult<TableMap[T]>>

  /**
   * Guarded completion for recurring chores — advances the cooldown only if
   * `last_completed_at` still matches what the caller last saw, so simultaneous
   * taps from both phones can't double-advance it.
   */
  completeRecurring(
    id: string,
    profileId: string,
    seenLastCompletedAt: string | null,
  ): Promise<ClaimResult<Chore>>

  subscribe(onChange: ChangeHandler, onResync: () => void): () => void
}

/**
 * The key a row is addressed by. Two tables are not keyed on `id`, and getting
 * this wrong is silent: a lookup that never matches just reports "no such row"
 * rather than throwing, so writes appear to succeed and vanish. Defined once
 * here so the store and every adapter agree.
 */
export function rowKey(table: TableName, row: unknown): string {
  if (table === 'household_settings') return 'singleton'
  if (table === 'profile_settings') return (row as { profile_id: string }).profile_id
  // The three app_* tables are keyed on (profile_id, app_id), so neither half
  // identifies a row on its own — one member has a preference row per app, and
  // one app has one per member. Keying on either alone silently collapses the
  // whole table to a single row in the store.
  if (table === 'app_access' || table === 'app_prefs' || table === 'app_notify_prefs') {
    const r = row as { profile_id: string; app_id: string }
    return `${r.profile_id}:${r.app_id}`
  }
  return (row as { id: string }).id
}

/** Tables whose primary key is (profile_id, app_id) rather than a single id. */
export const APP_KEYED_TABLES = ['app_access', 'app_prefs', 'app_notify_prefs'] as const

export const isAppKeyed = (table: TableName): boolean =>
  (APP_KEYED_TABLES as readonly string[]).includes(table)

export const appKey = (profileId: string, appId: string): string => `${profileId}:${appId}`

/**
 * Split a composite key back into its halves.
 *
 * Splits on the FIRST colon only: profile_id is a UUID and can't contain one,
 * but an app id is a slug the registry chooses, and splitting on the last (or
 * on every) colon would break the first time an app is called something like
 * `notes:v2`.
 */
export function splitAppKey(key: string): [profileId: string, appId: string] {
  const at = key.indexOf(':')
  return at < 0 ? [key, ''] : [key.slice(0, at), key.slice(at + 1)]
}

/** Client-side IDs so an optimistic row and its realtime echo share identity. */
export const newId = (): string => crypto.randomUUID()

export const nowIso = (): string => new Date().toISOString()
