/**
 * The rule registry: every rule the calendar applies or refuses to apply,
 * in plain language, with where it comes from.
 *
 * The "Why?" sheet and the help glossary read from here, and nothing
 * halachic is written into a screen. Each source says whether its text was
 * actually read (`checked`). One that wasn't is shown as "as cited by <via>",
 * never as a bare reference: every se'if in Shulchan Aruch HaRav below came
 * from secondary Chabad sources and stays unchecked until someone checks it
 * against a printed edition. Corrections to `checked` and `ref` live in the
 * database (mk_source_notes) and are merged over these at runtime, so fixing
 * a citation never needs a code change.
 *
 * Confidence: H well established, several sources; S one source found;
 * U uncertain — confirm with her rav or kallah teacher.
 */

export interface Source {
  ref: string
  /** Where the citation was found. */
  via: string
  /** True only if the text itself was read. */
  checked: boolean
}

export type Confidence = 'H' | 'S' | 'U'
/** What the app does: decides it, asks a rav, leaves it to a setting, or only reminds. */
export type Handling = 'decides' | 'asks' | 'setting' | 'reminds' | 'feature'

export interface Rule {
  id: string
  title: string
  text: string
  /** When the app stops and asks instead of deciding, in a phrase. */
  asks?: string
  setting?: { key: string; chabadDefault: string; options: string }
  sources: Source[]
  confidence: Confidence
  handling: Handling
}

// The web sources the research read directly.
const MMC = (ref = "My Mikvah Calendar, Halachic Overview and instructions"): Source => ({ ref, via: 'mymikvahcalendar.org', checked: true })
const MO = (ref = 'mikvah.org, "Taharas Hamishpacha Simplified"'): Source => ({ ref, via: 'mikvah.org', checked: true })
const CHABAD = (ref = 'Chabad.org, "About Our Zmanim Calculations"'): Source => ({ ref, via: 'chabad.org', checked: true })
// Cited through others; not read directly.
const viaSAH = (ref: string): Source => ({ ref, via: 'shulchanaruchharav.com (R. Yaakov Goldstein)', checked: false })
const viaMMC = (ref: string): Source => ({ ref, via: 'My Mikvah Calendar', checked: false })
const research = (ref: string): Source => ({ ref, via: 'the Nov 2026 research notes', checked: false })

export const RULES: Rule[] = [
  // --- onah boundaries ---------------------------------------------------------
  {
    id: 'Z1',
    title: 'Day, night and the Hebrew date',
    text:
      'An onah is half a day: the day onah runs from netz (sunrise) to shkiah (sunset), the night onah from shkiah to netz. The Hebrew date changes at shkiah, so a night belongs to the Hebrew date of the morning after it. Separation near an expected period is for one onah, day or night.',
    setting: { key: 'sunset', chabadDefault: 'Published shkiah (0.833°), with a 2-minute margin', options: 'Shkiah amitis (1.583°); a different margin' },
    sources: [{ ref: 'Shulchan Aruch, Yoreh Deah 184:2', via: 'Sefaria', checked: true }, MMC()],
    confidence: 'H',
    handling: 'decides',
  },
  {
    id: 'ZM',
    title: 'How the times are worked out',
    text:
      "Times follow the Baal HaTanya as Chabad.org publishes them: netz and shkiah at 0.833°, mincha ketanah and plag by the Baal HaTanya's hours, nightfall (tzeit) at 6° — which Chabad.org applies to matters of family purity — and the end of Shabbat and Yom Tov at 8.5°. Chabad.org advises adding or subtracting at least two minutes from each published time, so every deadline here carries a safety margin in the stringent direction. Where the sun doesn't rise or set, nothing is calculated.",
    asks: 'a place with no netz, shkiah or tzeit that day',
    setting: { key: 'marginMinutes', chabadDefault: '2 minutes', options: 'More or fewer minutes' },
    sources: [CHABAD()],
    confidence: 'H',
    handling: 'decides',
  },
  // --- flow and the five days ---------------------------------------------------
  {
    id: 'F1',
    title: 'Recording the flow',
    text:
      'Record the flow at the time she saw or felt it. Seen on waking with no idea when it began: record the time it was seen.',
    asks: 'staining before the flow',
    sources: [MO('mikvah.org calendar notes'), viaSAH('Shulchan Aruch, Yoreh Deah 184:4')],
    confidence: 'H',
    handling: 'decides',
  },
  {
    id: 'F2',
    title: 'A flow between shkiah and tzeit',
    text:
      'A flow seen between shkiah and nightfall (bein hashmashot) is a question for a rav. Two separate settings decide what the calendar does meanwhile: which day starts the five days, and which onah the vestot are counted from.',
    asks: 'every time',
    setting: {
      key: 'binHashmashot',
      chabadDefault: 'Five days from the night; vestot on the night onah',
      options: 'Five days from the previous day if within 9 minutes of shkiah; vestot on both onot',
    },
    sources: [viaSAH('Shulchan Aruch HaRav, Yoreh Deah 184:19'), viaSAH('Shach 184:13')],
    confidence: 'S',
    handling: 'asks',
  },
  {
    id: 'F3',
    title: 'A flow lasting under 24 hours',
    text: 'A flow that stops within a day is a question for a rav.',
    asks: 'every time',
    sources: [research("Listed among the Chabad guides' consult-a-rav cases")],
    confidence: 'S',
    handling: 'asks',
  },
  {
    id: 'D1',
    title: 'The five days',
    text:
      'The day the flow begins is day 1, even if it began a moment before shkiah. The earliest hefsek taharah is before shkiah on day 5.',
    setting: { key: 'minDays', chabadDefault: '5 days', options: '4 days (Sephardi, per the Shulchan Aruch)' },
    sources: [research('Rema, Yoreh Deah 196:11'), MMC(), MO()],
    confidence: 'H',
    handling: 'decides',
  },
  {
    id: 'D2',
    title: 'No new five-day wait',
    text:
      'There is no new five-day wait when she is already niddah — new bleeding or a stain during the count — or after a birth.',
    asks: 'a kallah, or blood seen after immersion',
    sources: [MO()],
    confidence: 'H',
    handling: 'decides',
  },
  // --- hefsek and the seven clean days ---------------------------------------------
  {
    id: 'H1',
    title: 'The hefsek taharah',
    text:
      'The hefsek taharah must be finished before published shkiah, ideally about 18 to 20 minutes before. It can be repeated; the last one before shkiah counts. If none is clean, try again the next day.',
    asks: 'a hefsek done after shkiah, even by a minute',
    sources: [viaMMC('Shulchan Aruch, Yoreh Deah 196:1'), MMC(), MO()],
    confidence: 'H',
    handling: 'decides',
  },
  {
    id: 'H2',
    title: 'An earlier hefsek',
    text: 'If it has to be earlier: after plag is the first choice, after mincha ketanah the second.',
    asks: 'a hefsek before mincha ketanah',
    sources: [MO()],
    confidence: 'H',
    handling: 'decides',
  },
  {
    id: 'H3',
    title: 'Moch dachuk',
    text:
      'A cloth left in place from before shkiah until after nightfall on the hefsek day, then checked at once and again by daylight.',
    asks: 'a moch dachuk forgotten or too painful',
    sources: [MMC(), MO()],
    confidence: 'H',
    handling: 'decides',
  },
  {
    id: 'N1',
    title: 'The seven clean days',
    text:
      'Clean day 1 is the day after the hefsek. Two bedikot a day: one after netz, one before shkiah — 14 in all. A bedikah after shkiah does not count. White underwear and sheets from the hefsek on.',
    sources: [research('Vayikra 15:28'), viaMMC('Shulchan Aruch, Yoreh Deah 196:4'), MMC(), MO()],
    confidence: 'H',
    handling: 'decides',
  },
  {
    id: 'N2',
    title: 'The minimum that still counts',
    text:
      'At the least: the hefsek, one bedikah on day 1 and one on day 7. Any other missed bedikah is a warning. With day 1 or day 7 missing, no mikvah night is shown.',
    asks: 'a missed bedikah on day 1 or day 7',
    sources: [viaMMC('Shulchan Aruch, Yoreh Deah 196:4'), MMC(), MO()],
    confidence: 'H',
    handling: 'decides',
  },
  {
    id: 'N3',
    title: 'A bedikah that is not clean',
    text:
      'A bedikah that is not clean, or doubtful, during the seven days stops the count. Keep checking; a second count from a new hefsek can run alongside "just in case" until the rav answers.',
    asks: 'every time',
    sources: [MO()],
    confidence: 'H',
    handling: 'asks',
  },
  // --- mikvah night --------------------------------------------------------------
  {
    id: 'M1',
    title: 'Mikvah night',
    text:
      'Immersion is after nightfall (tzeit) at the end of clean day 7: the same weekday as the hefsek, one week later, at night.',
    setting: { key: 'tzeit', chabadDefault: 'Tzeit at 6°', options: 'Another tzeit angle' },
    sources: [MMC(), MO(), CHABAD()],
    confidence: 'H',
    handling: 'decides',
  },
  {
    id: 'M2',
    title: "Yom Kippur and Tisha B'Av",
    text: "No immersion on the night of Yom Kippur or Tisha B'Av. It moves to the next night.",
    sources: [MO("mikvah.org tevilah page and Tisha B'Av article"), viaSAH('Magen Avraham 554:10'), research('yoatzot.org')],
    confidence: 'H',
    handling: 'decides',
  },
  {
    id: 'M3',
    title: "Tisha B'Av on Shabbat",
    text:
      "When 9 Av falls on Shabbat and the fast is put off to Sunday, Friday night's immersion is not blocked. The motzaei Shabbat that begins the postponed fast is a question for a rav.",
    asks: 'motzaei Shabbat of a postponed fast',
    sources: [MO()],
    confidence: 'S',
    handling: 'asks',
  },
  {
    id: 'M4',
    title: 'Friday night and Yom Tov',
    text:
      'On Friday night or a Yom Tov night (including Seder night and a second night), immerse on time, with all preparation finished before candle lighting. On motzaei Shabbat or Yom Tov, immerse after Shabbat ends (8.5°).',
    sources: [MO(), viaSAH('shulchanaruchharav.com'), research('yoatzot.org')],
    confidence: 'H',
    handling: 'decides',
  },
  {
    id: 'M5',
    title: 'Mikvah night on an onat perishah',
    text:
      "If mikvah night falls on an onah of separation, the Chabad practice is to put the immersion off to the next permitted night. Mikvah.org's course page also says to consult a rav.",
    asks: 'whenever it happens',
    setting: {
      key: 'mikvahOnOnah',
      chabadDefault: 'Postpone to the next permitted night',
      options: 'Immerse without relations (Pischei Teshuvah 184:22); ask each time',
    },
    sources: [MMC(), MO('mikvah.org 2024 handout, "How to Keep Your Calendar"'), viaSAH('Taharah KeHalachah 24:109'), viaSAH('Pischei Teshuvah 184:22')],
    confidence: 'H',
    handling: 'asks',
  },
  {
    id: 'M6',
    title: 'Husband away, or shiva',
    text: 'The custom is not to immerse while the husband is away. During shiva there is no immersion.',
    asks: 'every time',
    sources: [viaSAH('shulchanaruchharav.com'), MO()],
    confidence: 'S',
    handling: 'asks',
  },
  {
    id: 'M7',
    title: 'A postponed immersion',
    text: 'Putting off the immersion changes no veset. Every calculation uses the actual hefsek date.',
    sources: [MO()],
    confidence: 'H',
    handling: 'decides',
  },
  {
    id: 'M8',
    title: 'Chafifah',
    text:
      "Start by day after the last bedikah and continue into the night: at least 30 minutes if begun by day, at least an hour if done entirely at night. After Yom Kippur or Tisha B'Av, some on the eve and the rest after the fast.",
    sources: [MO('mikvah.org tevilah page')],
    confidence: 'S',
    handling: 'reminds',
  },
  {
    id: 'M9',
    title: 'Immersion by day',
    text: 'Immersion by day is never offered here; it was not researched.',
    asks: 'always',
    sources: [],
    confidence: 'U',
    handling: 'asks',
  },
  // --- vestot without a pattern -------------------------------------------------------
  {
    id: 'V1',
    title: 'Veset hachodesh',
    text: 'The same Hebrew date next month, the same onah, for one onah.',
    sources: [research('Shulchan Aruch, Yoreh Deah 189:2 and 189:13'), MMC(), MO()],
    confidence: 'H',
    handling: 'decides',
  },
  {
    id: 'V2',
    title: 'Veset hachodesh inside a period',
    text:
      'A veset hachodesh that passes with no flow is dropped. One that fell inside days she was already bleeding: Chabad authorities differ. Opinion 1 carries it to the next month; Opinion 2 drops it. There is no default — she chooses at setup.',
    setting: {
      key: 'chodeshInPeriod',
      chabadDefault: 'None: she must choose',
      options: 'Carry to the next month (Kitzur Dinei Taharah 8:13); drop it (R. Y. Farkash, Taharah KeHalachah)',
    },
    sources: [MMC('My Mikvah Calendar, halachic settings'), viaMMC('Kitzur Dinei Taharah 8:13'), viaMMC('Taharah KeHalachah (R. Y. Farkash)')],
    confidence: 'H',
    handling: 'setting',
  },
  {
    id: 'V3',
    title: 'The 30th',
    text: 'A flow on the 30th when the next month has only 29 days makes no veset hachodesh that month.',
    sources: [MMC()],
    confidence: 'S',
    handling: 'decides',
  },
  {
    id: 'V4',
    title: 'Which month is "next"',
    text: '"Next month" follows the real order of months, including Adar I then Adar II in a leap year.',
    sources: [research('Inferred; no source found')],
    confidence: 'U',
    handling: 'decides',
  },
  {
    id: 'V5',
    title: 'Veset haflagah (Chabad count)',
    text:
      'Count onot starting with the night after the hefsek, up to and including the onah the new flow began in. After the next hefsek, separate on the onah with that same number. Odd numbers are night onot.',
    setting: { key: 'haflagahMethod', chabadDefault: 'The Chabad count', options: 'The start-to-start day count (V7), instead or as well' },
    sources: [viaSAH('Shulchan Aruch HaRav, Yoreh Deah 184, Kuntres Acharon 22'), viaSAH('Shulchan Aruch HaRav, Yoreh Deah 189:36'), MO(), MMC()],
    confidence: 'H',
    handling: 'decides',
  },
  {
    id: 'V6',
    title: 'The haflagah list',
    text:
      "Haflagah numbers are kept as a list. A new number deletes every smaller one; larger ones stay and are re-dated from the newest hefsek. A number is dropped when its onah passes with no flow. Haflagah onot are drawn only once the new hefsek is confirmed.",
    sources: [viaSAH('Shulchan Aruch HaRav, Yoreh Deah 189:43–44'), MMC(), MO()],
    confidence: 'H',
    handling: 'decides',
  },
  {
    id: 'V7',
    title: 'Start-to-start haflagah',
    text:
      'The days from the start of one flow to the start of the next, both counted; separate on that day counted from the new flow, in the same onah.',
    setting: { key: 'haflagahMethod', chabadDefault: 'Off', options: 'Use instead of the Chabad count, or keep both' },
    sources: [research('yoatzot.org'), research('Shulchan Aruch, Yoreh Deah 189')],
    confidence: 'H',
    handling: 'setting',
  },
  {
    id: 'V8',
    title: 'Onah beinonit',
    text: 'Day 30, counting the day of the flow as day 1: both onot of that Hebrew date, from shkiah to shkiah.',
    setting: { key: 'beinonit', chabadDefault: 'Both onot of day 30 only', options: 'One onah only; add day 31 (Shach 189:30, Chavos Daas)' },
    sources: [viaSAH('Shulchan Aruch HaRav, Yoreh Deah 189:1, 189:42 and Kuntres Acharon 1'), MMC(), MO()],
    confidence: 'H',
    handling: 'decides',
  },
  {
    id: 'V9',
    title: 'Or Zarua',
    text: 'Some also separate for the onah before each veset. Not found in any Chabad source reviewed.',
    setting: { key: 'orZarua', chabadDefault: 'Off', options: 'On' },
    sources: [research('yoatzot.org')],
    confidence: 'U',
    handling: 'setting',
  },
  {
    id: 'V10',
    title: 'On an onat perishah',
    text:
      'No relations for the onah, and a bedikah. For veset hachodesh and haflagah, the bedikah is after the clock time the original flow began, before the onah ends. For the beinonit, about 10 minutes before shkiah, after that clock time. For a night onah, a separate bedikah before netz. No bath or swim before the bedikah; a shower is fine. He must be told about the onah.',
    setting: { key: 'beinonitTzeitBedikah', chabadDefault: 'Off', options: 'A second beinonit bedikah after tzeit (Taharah KeHalachah)' },
    sources: [MMC(), MO(), research('MikvahCalendar.com glossary')],
    confidence: 'H',
    handling: 'decides',
  },
  {
    id: 'V11',
    title: 'A missed onah bedikah',
    text:
      'Do it as soon as remembered. If clean, the onah is done. For the beinonit, relations stay forbidden until it is done, however long that takes.',
    asks: 'not clean, or relations first',
    sources: [MO(), MMC()],
    confidence: 'H',
    handling: 'decides',
  },
  {
    id: 'V12',
    title: 'Stains',
    text:
      'A stain creates no veset. A stain that forces a new hefsek does not move the haflagah count: it still runs from the original hefsek.',
    asks: 'the stain itself',
    sources: [MO('mikvah.org calendar notes')],
    confidence: 'H',
    handling: 'asks',
  },
  // --- life stages and patterns -----------------------------------------------------------
  {
    id: 'L1',
    title: 'Pregnancy',
    text:
      'Keep the onot that fall in the first three months, counted from the immersion. After that, none until the first period after the birth.',
    asks: 'any bleeding',
    sources: [MMC(), MO(), viaSAH('Shulchan Aruch HaRav, Yoreh Deah 189:113–115')],
    confidence: 'H',
    handling: 'decides',
  },
  {
    id: 'L2',
    title: 'After a birth or miscarriage',
    text:
      'After a birth, or a miscarriage at 40 days or more, the birth itself makes no veset. The first period after: hachodesh and beinonit. The second: haflagah too. No veset kavua for 24 months.',
    asks: 'staining after the birth',
    sources: [MMC(), MO()],
    confidence: 'H',
    handling: 'decides',
  },
  {
    id: 'L3',
    title: 'The first hefsek after a birth',
    text: "The earliest hefsek after a birth or miscarriage was not verified in the research. She enters the date her rav gives.",
    asks: 'always',
    sources: [],
    confidence: 'U',
    handling: 'asks',
  },
  {
    id: 'L4',
    title: 'No period for 90 days or more',
    text: 'Because of age: no calendar until three new cycles less than 90 days apart. Entered only on a rav’s word.',
    asks: 'always',
    sources: [MMC(), MO()],
    confidence: 'S',
    handling: 'asks',
  },
  {
    id: 'L5',
    title: 'Medication and contraception',
    text: 'Hormonal contraception, medication or a medical procedure: any change they cause is a question for a rav. No automatic rule.',
    asks: 'always',
    sources: [MMC(), MO()],
    confidence: 'H',
    handling: 'asks',
  },
  {
    id: 'L6',
    title: 'A kallah',
    text: 'Bleeding from first relations makes her niddah but has no effect on the calendar.',
    asks: 'the timing',
    sources: [MMC()],
    confidence: 'H',
    handling: 'asks',
  },
  {
    id: 'K1',
    title: 'A possible veset kavua',
    text:
      'The app looks for patterns — the same Hebrew date and onah three times running; three equal haflagah numbers (four flows) in the same onah; the same weekday at the same number of weeks three times; steadily growing or shrinking intervals; every-other-month patterns; a body symptom before three flows — and tells her. It never applies one: it keeps calculating as before until she enters her rav’s ruling. No notice within 24 months of a birth.',
    asks: 'every pattern',
    sources: [research('Shulchan Aruch, Yoreh Deah 189:2, 189:13'), research('yoatzot.org'), MMC('My Mikvah Calendar ("does NOT calculate the kavua for you")')],
    confidence: 'H',
    handling: 'asks',
  },
  {
    id: 'K2',
    title: 'Uprooting',
    text: 'A veset without a pattern is dropped after one clean passing. A kavua needs three.',
    asks: 'a kavua that may have been uprooted',
    sources: [research('Shulchan Aruch, Yoreh Deah 189'), research('yoatzot.org')],
    confidence: 'H',
    handling: 'asks',
  },
  {
    id: 'T1',
    title: 'Travel and the clocks',
    text:
      'Zmanim follow where she is. Gaining or losing hours in travel does not change the day count. With daylight saving, the onah follows the sun; the stored clock time is only a guide.',
    asks: 'crossing the date line, or a bedikah in flight',
    sources: [MMC(), MO()],
    confidence: 'H',
    handling: 'decides',
  },
  {
    id: 'W1',
    title: 'A written calendar too',
    text:
      'Some opinions hold that a computer record does not fulfil the duty to record the onot. Both Chabad sources tell couples to keep a written calendar as well — the printable calendar is for that.',
    sources: [MMC(), MO()],
    confidence: 'H',
    handling: 'feature',
  },
  {
    id: 'HR',
    title: 'Harchakot',
    text:
      'While she is niddah, until she immerses, the harchakot — the restrictions on contact between them — apply. The calendar shows this as a one-line note and does not track them.',
    sources: [MO()],
    confidence: 'H',
    handling: 'feature',
  },
  {
    id: 'SEP',
    title: 'Separation days for everyone',
    text: "Yom Kippur, Tisha B'Av and shiva are days of separation for every couple.",
    sources: [MO()],
    confidence: 'H',
    handling: 'decides',
  },
  {
    id: 'ASK',
    title: 'Ask a rav',
    text:
      'The calendar only calculates; it never rules. For anything outside the small core it can compute, it records what happened, holds the affected dates, and waits for the answer your rav gives.',
    sources: [MMC(), MO()],
    confidence: 'H',
    handling: 'asks',
  },
]

export const RULE_BY_ID: Record<string, Rule> = Object.fromEntries(RULES.map((r) => [r.id, r]))

export function rule(id: string): Rule {
  const r = RULE_BY_ID[id]
  if (!r) throw new Error(`Unknown rule ${id}`)
  return r
}

/** A citation as it should be read: bare when checked, "as cited by" when not. */
export function citation(s: Source): string {
  return s.checked ? s.ref : `${s.ref}, as cited by ${s.via}`
}

/** A correction stored in the database, applied over the registry. */
export interface SourceNote {
  rule_id: string
  /** Position in the rule's source list. */
  idx: number
  ref: string | null
  checked: boolean | null
}

export function withNotes(r: Rule, notes: SourceNote[]): Rule {
  const mine = notes.filter((n) => n.rule_id === r.id)
  if (mine.length === 0) return r
  return {
    ...r,
    sources: r.sources.map((s, i) => {
      const n = mine.find((m) => m.idx === i)
      return n ? { ...s, ref: n.ref ?? s.ref, checked: n.checked ?? s.checked } : s
    }),
  }
}

/** The glossary the help screen shows, from the prompt's terms. */
export const GLOSSARY: { term: string; meaning: string }[] = [
  { term: 'Onah', meaning: 'Half a day. The day onah is netz to shkiah; the night onah is shkiah to netz, and belongs to the Hebrew date of the morning after.' },
  { term: 'Hefsek taharah', meaning: 'The internal check, done before shkiah, that confirms bleeding has stopped.' },
  { term: 'Moch dachuk', meaning: 'A cloth left in place from before shkiah until nightfall after the hefsek.' },
  { term: 'Bedikah', meaning: 'An internal check.' },
  { term: "Shivah neki'im", meaning: 'The seven clean days after the hefsek.' },
  { term: 'Veset / onat perishah', meaning: 'An onah when a period is anticipated: the couple separate and she does a bedikah.' },
  { term: 'Veset kavua', meaning: 'An established pattern (three repetitions). Only a rav sets one here.' },
  { term: 'Tzeit', meaning: 'Nightfall.' },
  { term: 'Plag, mincha ketanah', meaning: 'Afternoon times, used for an earlier hefsek.' },
  { term: 'Chafifah', meaning: 'The washing and preparation before immersion.' },
  { term: 'Chatzitzah', meaning: 'Anything that would be a barrier in the water.' },
]
