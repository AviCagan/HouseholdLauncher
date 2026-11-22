/**
 * Every rule the app can be told to apply differently, as a setting. The
 * defaults are the Chabad practice (mikvah.org / My Mikvah Calendar). The one
 * exception is V2, which has no default: Chabad authorities disagree, so she
 * has to choose at setup, and until she does the engine asks rather than
 * guesses.
 */
export interface Settings {
  /** Z1: which shkiah the onot and the hefsek deadline use. */
  sunset: 'published' | 'amitis'
  /** ZM: minutes added in the stringent direction to every deadline. */
  marginMinutes: number
  /** D1: the five days (or four). */
  minDays: 4 | 5
  /** F2: a bein-hashmashot flow — where the five days start. */
  binFiveDays: 'night' | 'prev_day_9min'
  /** F2: a bein-hashmashot flow — which onah the vestot use. */
  binVestot: 'night' | 'both'
  /** V2: a veset hachodesh inside the days she was bleeding. No default. */
  chodeshInPeriod: 'carry' | 'drop' | null
  /** V5/V7. */
  haflagahMethod: 'chabad' | 'start_to_start' | 'both'
  /** V8. */
  beinonitScope: 'both_onot' | 'one_onah'
  beinonitDay31: boolean
  /** V9. */
  orZarua: boolean
  /** V10: an optional second beinonit bedikah after tzeit. */
  beinonitTzeitBedikah: boolean
  /** M5. */
  mikvahOnOnah: 'postpone' | 'immerse_no_relations' | 'ask'
  /** M1: tzeit angle for immersion. */
  tzeitAngle: number
  /** The morning bedikah reminder, minutes after netz. */
  morningMinutesAfterNetz: number
  /** Notifications say what they're about instead of "Calendar reminder". */
  detailInNotifications: boolean
  /** Her: let him read the details too (checks, stains, notes, questions). */
  shareDetails: boolean
  /** Estimated ovulation on the calendar: off by default, never guidance. */
  showOvulation: boolean
  /** Setting key → the date she confirmed it with her rav. */
  confirmed: Record<string, string>
}

export const CHABAD: Settings = {
  sunset: 'published',
  marginMinutes: 2,
  minDays: 5,
  binFiveDays: 'night',
  binVestot: 'night',
  chodeshInPeriod: null,
  haflagahMethod: 'chabad',
  beinonitScope: 'both_onot',
  beinonitDay31: false,
  orZarua: false,
  beinonitTzeitBedikah: false,
  mikvahOnOnah: 'postpone',
  tzeitAngle: 6,
  morningMinutesAfterNetz: 30,
  detailInNotifications: false,
  shareDetails: false,
  showOvulation: false,
  confirmed: {},
}

/** The settings a first run walks through, in order, with the rule each one belongs to. */
export const SETUP_ORDER: { key: keyof Settings; ruleId: string }[] = [
  { key: 'chodeshInPeriod', ruleId: 'V2' },
  { key: 'sunset', ruleId: 'Z1' },
  { key: 'marginMinutes', ruleId: 'ZM' },
  { key: 'binFiveDays', ruleId: 'F2' },
  { key: 'binVestot', ruleId: 'F2' },
  { key: 'orZarua', ruleId: 'V9' },
  { key: 'haflagahMethod', ruleId: 'V7' },
  { key: 'beinonitScope', ruleId: 'V8' },
  { key: 'beinonitDay31', ruleId: 'V8' },
  { key: 'beinonitTzeitBedikah', ruleId: 'V10' },
  { key: 'mikvahOnOnah', ruleId: 'M5' },
]

export const withDefaults = (s: Partial<Settings> | null | undefined): Settings => ({ ...CHABAD, ...(s ?? {}), confirmed: { ...CHABAD.confirmed, ...(s?.confirmed ?? {}) } })
