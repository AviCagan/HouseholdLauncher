import type { IconName } from '@/components/primitives/Icon'
import type { MkEventRow, MkPartner, MkReminder, MkSettingsRow, MkSourceNote, MkTrip } from '@/data/types'
import {
  CHABAD,
  reminders as scheduleReminders,
  withDefaults,
  type MkEvent,
  type PartnerInput,
  type Place,
  type Reminder,
  type Result,
  type Settings,
  type SourceNote,
  type Stay,
  type Zmanim,
} from './engine'

/**
 * Between the database rows and the engine: everything here is pure, so the
 * translation the whole calendar rests on is tested without a screen.
 */

// --- stored settings ------------------------------------------------------------

/** One reminder kind, on or off, for her. */
export type ReminderKind = 'hefsek' | 'moch' | 'bedikah' | 'mikvah' | 'vestot' | 'flags'
export const REMINDER_KINDS: ReminderKind[] = ['hefsek', 'moch', 'bedikah', 'mikvah', 'vestot', 'flags']

export interface PrepSection {
  title: string
  items: string[]
}

/** What one mk_settings row holds: the engine's settings and the app's own. */
export interface Stored extends Settings {
  /** Where she lives. Set at setup; never a default. */
  home: Place | null
  /** The tile's name and icon, discreet unless she changes them. */
  tile: { name: string; icon: IconName }
  /** Her own preparation list; null means the seeded one. */
  prep: PrepSection[] | null
  remind: Record<ReminderKind, boolean>
}

export const DEFAULT_TILE = { name: 'Calendar', icon: 'calendar' as IconName }

export const DEFAULT_STORED: Stored = {
  ...CHABAD,
  home: null,
  tile: DEFAULT_TILE,
  prep: null,
  remind: { hefsek: true, moch: true, bedikah: true, mikvah: true, vestot: true, flags: true },
}

export function readStored(raw: Record<string, unknown> | null | undefined): Stored {
  const r = (raw ?? {}) as Partial<Stored>
  return {
    ...DEFAULT_STORED,
    ...withDefaults(r),
    home: r.home ?? null,
    tile: { ...DEFAULT_TILE, ...(r.tile ?? {}) },
    prep: r.prep ?? null,
    remind: { ...DEFAULT_STORED.remind, ...(r.remind ?? {}) },
  }
}

/** Her settings rows, oldest first: the latest is in force, the rest are history. */
export function settingsHistory(rows: MkSettingsRow[], owner: string): MkSettingsRow[] {
  return rows
    .filter((r) => r.owner_id === owner)
    .sort((a, b) => a.effective_from.localeCompare(b.effective_from) || a.created_at.localeCompare(b.created_at))
}

/** The settings that were in force at a moment — for explaining a past date. */
export function settingsAt(rows: MkSettingsRow[], owner: string, t: number): Stored | null {
  let found: MkSettingsRow | null = null
  for (const r of settingsHistory(rows, owner)) if (Date.parse(r.effective_from) <= t) found = r
  return found ? readStored(found.settings) : null
}

// --- events, trips, partner -------------------------------------------------------------

export function toEvent(row: MkEventRow): MkEvent {
  return {
    id: row.id,
    kind: row.kind,
    at: Date.parse(row.at),
    result: row.result,
    data: row.data as MkEvent['data'],
    voided: row.voided_at !== null,
  }
}

export const validPlace = (p: Place | null): p is Place =>
  !!p && Number.isFinite(p.lat) && Number.isFinite(p.lng) && Math.abs(p.lat) <= 90 && Math.abs(p.lng) <= 180 && !!p.tz

export const tripPlace = (t: Pick<MkTrip, 'name' | 'lat' | 'lng' | 'tz'>): Place => ({ name: t.name, lat: t.lat, lng: t.lng, tz: t.tz })

export function toStays(trips: MkTrip[], owner: string): (Stay & { id: string })[] {
  return trips
    .filter((t) => t.owner_id === owner && t.voided_at === null)
    .sort((a, b) => a.from_day.localeCompare(b.from_day))
    .map((t) => ({ id: t.id, from: t.from_day, to: t.to_day, place: tripPlace(t) }))
}

export function toPartner(row: MkPartner | undefined): PartnerInput {
  return { away: row?.away ?? [], shiva: row?.shiva ?? [] }
}

/** His reminder choices. */
export interface HisPrefs {
  vestot: boolean
  mikvah: boolean
  tile?: { name: string; icon: IconName }
}

export function hisPrefs(row: MkPartner | undefined): HisPrefs {
  const p = (row?.prefs ?? {}) as Partial<HisPrefs>
  return { vestot: p.vestot ?? true, mikvah: p.mikvah ?? true, tile: p.tile }
}

export function toNotes(rows: MkSourceNote[], owner: string): SourceNote[] {
  return rows
    .filter((r) => r.owner_id === owner)
    .map((r) => ({ rule_id: r.rule_id, idx: r.idx, ref: r.ref, checked: r.checked }))
}

// --- the reminder queue -------------------------------------------------------------------

const KIND_OF: Record<string, ReminderKind> = {
  hefsek: 'hefsek',
  moch: 'moch',
  bedikah: 'bedikah',
  mikvah: 'mikvah',
  chafifah: 'mikvah',
  candles: 'mikvah',
  moved: 'mikvah',
  veset: 'vestot',
  flag: 'flags',
}

export const reminderKind = (key: string): ReminderKind => KIND_OF[key.split(':')[0]] ?? 'flags'

/** How far ahead the queue is kept: past the next beinonit (day 30) with room to spare. */
export const QUEUE_DAYS = 45

/**
 * The reminders the calendar wants, for both of them, as queue rows.
 *
 * One row per recipient, keyed on the reminder and the person, so a
 * recompute updates a row in place. Times are floored to the minute: the
 * sweep runs on the minute, and early is the stringent side of every one of
 * these. Worded neutrally unless she turned detail on.
 */
export function queueRows(input: {
  result: Result
  zmanim: Zmanim
  stored: Stored
  his: HisPrefs
  her: string
  partner: string | null
  now: number
}): Omit<MkReminder, 'created_at' | 'updated_at'>[] {
  const { result, zmanim, stored, his, her, partner, now } = input
  const list: Reminder[] = scheduleReminders(result, zmanim, stored, now, QUEUE_DAYS, { him: { vestot: his.vestot, mikvah: his.mikvah } })
  const rows: Omit<MkReminder, 'created_at' | 'updated_at'>[] = []
  for (const r of list) {
    const fire = new Date(Math.floor(r.at / 60_000) * 60_000).toISOString()
    const text = stored.detailInNotifications
      ? { title: stored.tile.name || DEFAULT_TILE.name, body: r.detail }
      : { title: 'Calendar reminder', body: '' }
    const targets: string[] = []
    if ((r.audience === 'her' || r.audience === 'both') && stored.remind[reminderKind(r.key)]) targets.push(her)
    if ((r.audience === 'him' || r.audience === 'both') && partner) targets.push(partner)
    for (const target of targets) {
      rows.push({
        id: `${r.key}@${target}`,
        owner_id: her,
        target_id: target,
        fire_at: fire,
        title: text.title,
        body: text.body,
        rule_id: r.ruleId,
        cancelled: false,
        sent_at: null,
      })
    }
  }
  return rows
}

export interface QueueDiff {
  insert: Omit<MkReminder, 'created_at' | 'updated_at'>[]
  update: { id: string; patch: Partial<MkReminder> }[]
}

/**
 * What to write so the stored queue matches what the calendar wants.
 *
 * A sent row is never touched. A row the calendar no longer wants is
 * cancelled, not deleted — and only while it is still in the future: one
 * that is due but not yet swept belongs to the sweep, or a publish landing in
 * the same minute would silently eat the reminder.
 */
export function diffQueue(wanted: QueueDiff['insert'], existing: MkReminder[], owner: string, now: number): QueueDiff {
  const have = new Map(existing.filter((r) => r.owner_id === owner).map((r) => [r.id, r]))
  const out: QueueDiff = { insert: [], update: [] }
  const keep = new Set<string>()
  for (const w of wanted) {
    keep.add(w.id)
    const e = have.get(w.id)
    if (!e) {
      out.insert.push(w)
      continue
    }
    if (e.sent_at) continue
    if (Date.parse(e.fire_at) !== Date.parse(w.fire_at) || e.title !== w.title || e.body !== w.body || e.cancelled || e.target_id !== w.target_id) {
      out.update.push({ id: w.id, patch: { fire_at: w.fire_at, title: w.title, body: w.body, rule_id: w.rule_id, cancelled: false } })
    }
  }
  for (const e of have.values()) {
    if (keep.has(e.id) || e.sent_at || e.cancelled) continue
    if (Date.parse(e.fire_at) <= now) continue
    out.update.push({ id: e.id, patch: { cancelled: true } })
  }
  return out
}

// --- the preparation checklist ------------------------------------------------------------------

/** Seeded from mikvah.org's tevilah page (M8); hers to edit. */
export const DEFAULT_PREP: PrepSection[] = [
  {
    title: 'Preparation',
    items: [
      'Remove jewellery, bandages, contact lenses, makeup, nail polish and lotions',
      'Bath in hot water with soap',
      'Shower and rinse off loose hair',
      'Wash hair and body, leaving no residue',
      'Shampoo without conditioner',
      'Clean nose, ears and earring holes',
      'Clean eyes',
      'Brush, floss and rinse teeth',
      'Take out removable dental appliances',
      'Clean and cut nails',
      'Soften calluses and trim loose skin',
      'Comb all hair while wet',
      'Check by sight and by touch',
      'After using the bathroom, rinse, comb and check again',
    ],
  },
  {
    title: 'Check for',
    items: [
      'Temporary dental work',
      'Dried blood or scabs',
      'Splinters sticking out',
      'Sticky substances such as dough, paint or glitter',
      'Waterproof makeup',
      'Knots in hair',
    ],
  },
  {
    title: 'Ask a rav if present',
    items: ['Stitches or a cast', 'Loose warts or corns', 'Hair dye that is growing out', 'Anything that cannot be removed'],
  },
  {
    title: 'Before Shabbat or Yom Tov',
    items: ['Finish all preparation before candle lighting', 'He lights the candles'],
  },
]
