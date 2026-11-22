import type { Settings } from './engine'

/**
 * How each engine setting is offered on screen: its words, its rule, and its
 * choices. The rule (and its sources) is what explains a choice; these labels
 * only name the options the registry describes.
 */

export interface SettingUi {
  key: keyof Settings
  ruleId: string
  label: string
  options: { value: string; label: string }[]
  /** Numbers are edited as numbers. */
  numeric?: boolean
}

export const SETTINGS_UI: SettingUi[] = [
  {
    key: 'chodeshInPeriod',
    ruleId: 'V2',
    label: 'Veset hachodesh inside a period',
    options: [
      { value: 'carry', label: 'Carry it to the next month (Opinion 1)' },
      { value: 'drop', label: 'Drop it (Opinion 2)' },
    ],
  },
  {
    key: 'sunset',
    ruleId: 'Z1',
    label: 'Which shkiah',
    options: [
      { value: 'published', label: 'Published shkiah (0.833°)' },
      { value: 'amitis', label: 'Shkiah amitis (1.583°)' },
    ],
  },
  { key: 'marginMinutes', ruleId: 'ZM', label: 'Margin, minutes', options: [], numeric: true },
  {
    key: 'binFiveDays',
    ruleId: 'F2',
    label: 'Bein hashmashot: where the five days start',
    options: [
      { value: 'night', label: 'From the night' },
      { value: 'prev_day_9min', label: 'From the previous day, if within 9 minutes of shkiah' },
    ],
  },
  {
    key: 'binVestot',
    ruleId: 'F2',
    label: 'Bein hashmashot: which onah the vestot use',
    options: [
      { value: 'night', label: 'The night onah' },
      { value: 'both', label: 'Both onot' },
    ],
  },
  {
    key: 'orZarua',
    ruleId: 'V9',
    label: 'Or Zarua',
    options: [
      { value: 'false', label: 'Off' },
      { value: 'true', label: 'On' },
    ],
  },
  {
    key: 'haflagahMethod',
    ruleId: 'V7',
    label: 'Haflagah count',
    options: [
      { value: 'chabad', label: 'The Chabad count' },
      { value: 'start_to_start', label: 'Start-to-start instead' },
      { value: 'both', label: 'Both' },
    ],
  },
  {
    key: 'beinonitScope',
    ruleId: 'V8',
    label: 'Onah beinonit',
    options: [
      { value: 'both_onot', label: 'Both onot of day 30' },
      { value: 'one_onah', label: 'One onah only' },
    ],
  },
  {
    key: 'beinonitDay31',
    ruleId: 'V8',
    label: 'Beinonit on day 31 too',
    options: [
      { value: 'false', label: 'No' },
      { value: 'true', label: 'Yes' },
    ],
  },
  {
    key: 'beinonitTzeitBedikah',
    ruleId: 'V10',
    label: 'A second beinonit bedikah after tzeit',
    options: [
      { value: 'false', label: 'No' },
      { value: 'true', label: 'Yes' },
    ],
  },
  {
    key: 'mikvahOnOnah',
    ruleId: 'M5',
    label: 'Mikvah night on an onat perishah',
    options: [
      { value: 'postpone', label: 'Postpone to the next permitted night' },
      { value: 'immerse_no_relations', label: 'Immerse, without relations' },
      { value: 'ask', label: 'Ask each time' },
    ],
  },
  {
    key: 'minDays',
    ruleId: 'D1',
    label: 'Days before the hefsek',
    options: [
      { value: '5', label: '5 days' },
      { value: '4', label: '4 days' },
    ],
  },
  { key: 'tzeitAngle', ruleId: 'M1', label: 'Tzeit angle for immersion, degrees', options: [], numeric: true },
  { key: 'morningMinutesAfterNetz', ruleId: 'N1', label: 'Morning bedikah reminder, minutes after netz', options: [], numeric: true },
]

/** The registry's setting key → the engine settings it covers. */
const RULE_KEYS: Record<string, (keyof Settings)[]> = {
  binHashmashot: ['binFiveDays', 'binVestot'],
  tzeit: ['tzeitAngle'],
  beinonit: ['beinonitScope', 'beinonitDay31'],
}

export const keysFor = (ruleKey: string): (keyof Settings)[] => RULE_KEYS[ruleKey] ?? [ruleKey as keyof Settings]

/** The current value, in words. */
export function describe(key: keyof Settings, s: Settings): string {
  const ui = SETTINGS_UI.find((u) => u.key === key)
  const v = s[key]
  if (v === null || v === undefined) return 'Not chosen yet'
  const hit = ui?.options.find((o) => o.value === String(v))
  return hit ? hit.label : String(v)
}

/** Read a choice back into the setting's type. */
export function parse(key: keyof Settings, raw: string): Settings[keyof Settings] {
  const ui = SETTINGS_UI.find((u) => u.key === key)
  if (ui?.numeric || key === 'minDays') return Number(raw) as never
  if (raw === 'true' || raw === 'false') return (raw === 'true') as never
  return raw as never
}
