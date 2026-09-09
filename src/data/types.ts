// Single source of truth for every shape that crosses the wire.
// `urgency` and `desire` are smallints with CHECK constraints in Postgres
// rather than enums, so widening them later doesn't need a migration.

/**
 * A member's stable handle. Was a union of exactly ('avi' | 'jackie') back when
 * the household was two people and the database agreed via a CHECK constraint.
 * Both are gone: the launcher adds guests, and a slug is now generated from the
 * person's name when an owner creates them (see the household Edge Function).
 */
export type ProfileSlug = string

/**
 * Three levels, read as a traffic light. The database still allows 0–3 from
 * when there were four, so anything stored as 3 is clamped on the way in
 * rather than migrated — old rows keep working and nothing needs backfilling.
 */
export const URGENCY = { LOW: 0, MEDIUM: 1, URGENT: 2 } as const
export type Urgency = 0 | 1 | 2

export const URGENCY_LEVELS: Urgency[] = [0, 1, 2]

export const URGENCY_META: Record<Urgency, { label: string; short: string }> = {
  0: { label: 'Low', short: 'Low' },
  1: { label: 'Medium', short: 'Med' },
  2: { label: 'Urgent', short: 'Urgent' },
}

/** Fold legacy 3s down to the new top level. */
export const normalizeUrgency = (value: number): Urgency =>
  (value >= 2 ? 2 : value <= 0 ? 0 : 1) as Urgency

export type Desire = 1 | 2 | 3 | 4 | 5

export const DESIRE_META: Record<Desire, { label: string }> = {
  1: { label: 'Someday' },
  2: { label: 'Would be nice' },
  3: { label: 'Want it' },
  4: { label: 'Really want it' },
  5: { label: 'Must have' },
}

export type RecurrenceUnit = 'hours' | 'days' | 'weeks' | 'months' | 'years' | 'weekdays'

/**
 * 0 (Sunday) .. 6 (Saturday) — matching both JS `Date.getDay()` and Postgres
 * `extract(dow from ...)`, so no conversion table has to be kept in step on
 * either side of the wire.
 */
export type Weekday = 0 | 1 | 2 | 3 | 4 | 5 | 6

export const WEEKDAY_LABELS: Record<Weekday, { short: string; letter: string }> = {
  0: { short: 'Sun', letter: 'S' },
  1: { short: 'Mon', letter: 'M' },
  2: { short: 'Tue', letter: 'T' },
  3: { short: 'Wed', letter: 'W' },
  4: { short: 'Thu', letter: 'T' },
  5: { short: 'Fri', letter: 'F' },
  6: { short: 'Sat', letter: 'S' },
}
export type ThemeMode = 'system' | 'light' | 'dark' | 'oled'
export type HapticIntensity = 'off' | 'subtle' | 'normal' | 'heavy'
export type NavApp = 'google' | 'waze' | 'apple'

export interface Profile {
  id: string
  slug: ProfileSlug
  display_name: string
  avatar_emoji: string
  /**
   * Optional photo, held as a data URI. Two people do not justify configuring
   * a storage bucket, and the image is downscaled hard before it is saved.
   */
  avatar_url: string | null
  color_hex: string
  created_at: string
}

export type NotifyEvent =
  | 'claim_complete'
  | 'cooldown_ready'
  | 'urgent_added'
  | 'any_added'
  | 'item_edited'

export interface ProfileSettings {
  profile_id: string
  theme_mode: ThemeMode
  accent_hex: string
  font_scale: number
  haptic_intensity: HapticIntensity
  /** Per-event opt-outs. Absent key = enabled. */
  haptic_events: Partial<Record<HapticEventName, boolean>>
  sound_enabled: boolean
  reduce_motion: boolean
  /** iOS 17.4+ `<input type="checkbox" switch>` haptic hack. Off by default. */
  ios_native_switch: boolean
  nav_app: NavApp
  notify_events: Partial<Record<NotifyEvent, boolean>>
  /**
   * Which recurrence presets show as quick picks, by label. Empty means the
   * built-in default set.
   */
  recurrence_presets: string[]
  /** Reserved so SMS can be added later without a migration. */
  phone_e164: string | null
  updated_at: string
}

export type HapticEventName =
  | 'tap'
  | 'toggleOn'
  | 'toggleOff'
  | 'claim'
  | 'complete'
  | 'delete'
  | 'swipeThreshold'
  | 'longPress'
  | 'dragStart'
  | 'snap'
  | 'success'
  | 'warning'
  | 'error'
  // The Owe list's swipe-to-pay. `zipperTick` fires once per detent crossed
  // rather than once per gesture, which is what makes the drag feel like a
  // zipper being pulled instead of a slider being moved.
  | 'zipperTick'
  | 'zipperDone'

export interface HouseholdSettings {
  singleton: true
  /**
   * Whether the pre-launcher shared PIN is still accepted.
   *
   * Optional because rows written before 015_launcher.sql have no such column,
   * and an older client reading a newer row must not treat "absent" as "off" —
   * that would be the one value it can never recover from on its own.
   */
  legacy_auth_enabled?: boolean
  home_label: string | null
  home_address: string | null
  home_lat: number | null
  home_lng: number | null
  /**
   * Days to keep finished to-dos and bought shopping items before they are
   * removed. 0 disables clearing entirely. Shared, because it changes the
   * data both of you see rather than just how it looks.
   */
  auto_clear_days: number
  /**
   * Secret in the calendar feed URL. null means calendar sync is off — the
   * Edge Function refuses every request in that state. Regenerating it revokes
   * any URL already handed out.
   */
  calendar_token: string | null
  /** Minutes before a chore is due that the calendar should remind you. 0 = never. */
  calendar_alarm_minutes: number
  /**
   * Secret in the voice-add URL (Siri / Google). null means voice adding is
   * off and the Edge Function refuses every request. Separate from
   * calendar_token so revoking one doesn't revoke the other.
   */
  voice_token: string | null
  updated_at: string
}

/** Fields shared by todos, chores and shopping items. */
interface ListItemBase {
  id: string
  title: string
  urgency: Urgency
  claimed_by: string | null
  created_by: string | null
  /** Who last edited the row — distinct from created_by/claimed_by, set on every edit-sheet save. */
  updated_by: string | null
  sort_order: number
  created_at: string
  updated_at: string
}

export interface Todo extends ListItemBase {
  notes: string | null
  is_done: boolean
  completed_by: string | null
  completed_at: string | null
  /**
   * When this is due. Null means no deadline, which is the normal case.
   * Distinct from a chore's next_due_at: nothing derives this, someone chose it.
   */
  due_at: string | null
}

export interface Chore extends ListItemBase {
  notes: string | null
  is_recurring: boolean
  /** Null when recurrence_unit is 'weekdays' — that mode is driven by recurrence_days instead. */
  recurrence_count: number | null
  recurrence_unit: RecurrenceUnit | null
  /** Set only when recurrence_unit is 'weekdays'. e.g. [2, 3] for "Tuesdays and Wednesdays". */
  recurrence_days: Weekday[] | null
  last_completed_at: string | null
  last_completed_by: string | null
  /** Maintained by a DB trigger — generated columns can't do this (see plan). */
  next_due_at: string | null
  cooldown_notified_at: string | null
  is_done: boolean
}

export interface Store {
  id: string
  name: string
  /** Online stores are excluded from trip planning and carry no coordinates. */
  is_online: boolean
  url: string | null
  address: string | null
  lat: number | null
  lng: number | null
  geocoded_at: string | null
  geocode_source: 'photon' | 'nominatim' | 'manual' | null
  color_hex: string
  emoji: string | null
  sort_order: number
  created_at: string
  updated_at: string
}

export interface ShoppingItem extends ListItemBase {
  store_id: string | null
  quantity: string | null
  is_done: boolean
  completed_at: string | null
  /** A product link for an online-store item, the same way wishlist items carry one. */
  url: string | null
  image_url: string | null
  price_cents: number | null
}

export interface WishlistItem {
  id: string
  title: string
  notes: string | null
  url: string | null
  price_cents: number | null
  image_url: string | null
  desire_level: Desire
  owner_id: string | null
  is_purchased: boolean
  purchased_at: string | null
  created_by: string | null
  updated_by: string | null
  sort_order: number
  created_at: string
  updated_at: string
}

/**
 * A plain-language feed of what changed, independent of push delivery — see
 * supabase/011_activity_and_edits.sql's log_activity() trigger, which writes
 * these rows.
 */
export interface ActivityLog {
  id: string
  table_name: 'todos' | 'chores' | 'shopping_items' | 'wishlist_items'
  row_id: string
  title: string
  event:
    | 'added'
    | 'edited'
    | 'completed'
    | 'uncompleted'
    | 'claimed'
    | 'unclaimed'
    | 'deleted'
    // Someone took a claim off someone else. The only event with two people in
    // it, which is why `subject_id` exists.
    | 'stolen'
  actor_id: string | null
  /**
   * Who the event happened TO. Only ever set for 'stolen' — the person the
   * claim was taken from. Optional because rows written before 016 have no
   * such column.
   */
  subject_id?: string | null
  created_at: string
}

export interface TripStop {
  store_id: string
  name: string
  lat: number
  lng: number
  address: string | null
  overridden: boolean
}

export interface ShoppingTrip {
  id: string
  created_by: string | null
  stops: TripStop[]
  ordered_index: number[]
  total_distance_m: number | null
  total_duration_s: number | null
  routed_with: 'osrm' | 'haversine'
  created_at: string
}

export type TabKey = 'todos' | 'chores' | 'shopping' | 'wishlist'

// ---------------------------------------------------------------------------
// Launcher
// ---------------------------------------------------------------------------

/**
 * What a member may do beyond using the apps they've been granted.
 *
 * Only `owner` is load-bearing — it gates people management and access grants,
 * and the Edge Function checks it server-side rather than trusting this. The
 * split between `member` and `guest` is presentational today: both need an
 * explicit grant per app, and the label just says which of the two kinds of
 * person you are looking at in the people list.
 */
export type MemberRole = 'owner' | 'member' | 'guest'

/** Permission. Absent row means "no", except for owners. */
export interface AppAccess {
  profile_id: string
  app_id: string
  granted: boolean
  granted_by: string | null
  updated_at: string
}

/** Taste — hiding an app you are allowed to use, and ordering the grid. */
export interface AppPref {
  profile_id: string
  app_id: string
  hidden: boolean
  sort_order: number
  updated_at: string
}

/**
 * How one app is allowed to interrupt you.
 *
 * `enabled` and `push` are deliberately separate: turning an app down to
 * "badge me, don't buzz me" is the common ask and one boolean can't say it.
 */
export interface AppNotifyPref {
  profile_id: string
  app_id: string
  enabled: boolean
  push: boolean
  sound: string | null
  haptic: 'off' | 'subtle' | 'normal' | 'heavy'
  events: Record<string, boolean>
  updated_at: string
}

/**
 * One row per recipient. Read state is per person and it is the whole basis of
 * the badge counts, so a shared row would need a side table to record it.
 */
export interface AppNotification {
  id: string
  profile_id: string
  app_id: string
  event: string
  title: string
  body: string | null
  /** Opaque to the launcher; the owning app decides what it means. */
  deep_link: Record<string, unknown> | null
  actor_id: string | null
  read_at: string | null
  created_at: string
}

export type DebtDirection = 'owed_to_us' | 'we_owe'

/**
 * One entry on either Owe list.
 *
 * `counterparty` is free text because these people mostly aren't launcher
 * members — the cousin, the landlord, whoever covered dinner. `counterparty_key`
 * is the normalised form a Postgres trigger maintains, and it is what the
 * summary groups on so "Sam", "sam" and " Sam " total as one person.
 */
export interface Debt {
  id: string
  direction: DebtDirection
  counterparty: string
  counterparty_key: string
  /** Integer cents. Money in floats is how you end up owing $19.999999999998. */
  amount_cents: number
  reason: string | null
  notes: string | null
  is_paid: boolean
  paid_at: string | null
  paid_by: string | null
  created_by: string | null
  updated_by: string | null
  sort_order: number
  created_at: string
  updated_at: string
}

// --- Meals -------------------------------------------------------------------

/** What role a dish plays on the table. Also what a template slots by. */
export type DishKind =
  | 'main'
  | 'side'
  | 'soup'
  | 'salad'
  | 'bread'
  | 'dessert'
  | 'drink'
  | 'snack'
  | 'other'

export const DISH_KINDS: DishKind[] = [
  'main', 'side', 'soup', 'salad', 'bread', 'dessert', 'drink', 'snack', 'other',
]

export interface Ingredient {
  name: string
  /** Free text — "2 cups", "a pinch". Never normalised, never summed. */
  amount: string | null
  /** What this one ingredient cost, in cents, if you happen to know. */
  cost_cents: number | null
}

/**
 * Per serving. Every key optional: a dish typed in by hand usually has none
 * of these, one imported from a recipe site usually has all of them, and the
 * totals treat a missing value as unknown rather than as zero.
 */
export interface Nutrition {
  calories?: number | null
  protein_g?: number | null
  carbs_g?: number | null
  fat_g?: number | null
  fiber_g?: number | null
  sodium_mg?: number | null
}

export const NUTRITION_KEYS: (keyof Nutrition)[] = [
  'calories', 'protein_g', 'carbs_g', 'fat_g', 'fiber_g', 'sodium_mg',
]

export type DishSource = 'manual' | 'web' | 'instagram'

export interface Dish {
  id: string
  name: string
  emoji: string
  kind: DishKind
  ingredients: Ingredient[]
  steps: string[]
  servings: number
  /** The whole dish, in cents. Null is "not entered", shown blank, not $0. */
  cost_cents: number | null
  nutrition: Nutrition
  source_url: string | null
  source_kind: DishSource
  image_url: string | null
  notes: string | null
  tags: string[]
  created_by: string | null
  updated_by: string | null
  created_at: string
  updated_at: string
}

export interface TemplateSlot {
  role: DishKind
  /** What the slot is called on this occasion: "Round challah", not "bread". */
  label: string
}

export interface MealTemplate {
  id: string
  name: string
  emoji: string
  /** 'weeknight' | 'special' | 'shabbat' | 'holiday' | anything else typed in. */
  occasion: string
  slots: TemplateSlot[]
  /** How many this occasion is usually for; a meal planned from it starts here. */
  people: number
  is_builtin: boolean
  sort_order: number
  created_by: string | null
  updated_by: string | null
  created_at: string
  updated_at: string
}

/** A template slot with a dish in it — or not yet. */
export interface MealCourse extends TemplateSlot {
  dish_id: string | null
}

export interface Meal {
  id: string
  name: string
  emoji: string
  occasion: string
  template_id: string | null
  /** ISO date (YYYY-MM-DD) or null for a saved combination with no date. */
  planned_for: string | null
  /** Headcount. Batches, scaled amounts and cost are all derived from this. */
  people: number
  courses: MealCourse[]
  notes: string | null
  created_by: string | null
  updated_by: string | null
  created_at: string
  updated_at: string
}

// ---------------------------------------------------------------------------
// A&J Encyclopedia
// ---------------------------------------------------------------------------

export const PARTS_OF_SPEECH = [
  'noun', 'verb', 'adjective', 'adverb', 'interjection', 'phrase', 'name', 'other',
] as const
export type PartOfSpeech = (typeof PARTS_OF_SPEECH)[number]

/**
 * One word in the household's own dictionary.
 *
 * Laid out like a real entry — headword, pronunciation, part of speech,
 * definition, an example, and an origin — because the form is half the joke:
 * a made-up word treated with full lexicographic seriousness. Everything but
 * the term and the definition is optional, since most entries will be typed
 * on a phone in the middle of the conversation that produced them.
 */
export interface LexiconEntry {
  id: string
  term: string
  pronunciation: string | null
  part_of_speech: PartOfSpeech
  definition: string
  example: string | null
  /** Where it came from — for a private word, usually a story, not a language. */
  origin: string | null
  tags: string[]
  created_by: string | null
  updated_by: string | null
  created_at: string
  updated_at: string
}
