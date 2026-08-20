// Turning spoken time into data. Pure — no Deno, no network — so the app's
// Vitest suite can test it directly, same as parse.ts.

/**
 * Deliberately a small hand-written matcher rather than a date library.
 *
 * What a person actually says to a shortcut is a short, closed set: "tomorrow",
 * "Friday", "in three days", "next week". A general-purpose parser would accept
 * far more than that and, more importantly, would guess at input it doesn't
 * really understand — and a deadline quietly set to the wrong day is worse than
 * no deadline at all. Anything not recognised here returns null and the item is
 * added without one, which is the honest outcome.
 */

const WEEKDAYS: Record<string, number> = {
  sunday: 0, sun: 0,
  monday: 1, mon: 1,
  tuesday: 2, tue: 2, tues: 2,
  wednesday: 3, wed: 3,
  thursday: 4, thu: 4, thur: 4, thurs: 4,
  friday: 5, fri: 5,
  saturday: 6, sat: 6,
}

const NUMBER_WORDS: Record<string, number> = {
  a: 1, an: 1, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6,
  seven: 7, eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12,
  fourteen: 14, twenty: 20, thirty: 30,
}

const count = (word: string): number | null => {
  const n = /^\d+$/.test(word) ? parseInt(word, 10) : NUMBER_WORDS[word.toLowerCase()]
  return typeof n === 'number' && n > 0 ? n : null
}

/** End of the given day in local terms — a deadline means "by then", not 00:00. */
function endOfDay(d: Date): Date {
  const out = new Date(d)
  out.setHours(23, 59, 0, 0)
  return out
}

const addDays = (d: Date, n: number): Date => {
  const out = new Date(d)
  out.setDate(out.getDate() + n)
  return out
}

/**
 * "tomorrow" / "friday" / "in 3 days" / "next week" → an ISO timestamp.
 *
 * `now` is injectable so the tests aren't hostage to the day they run on.
 * Returns null for anything it doesn't confidently understand.
 */
export function parseWhen(input: string, now: Date = new Date()): string | null {
  const s = input.trim().toLowerCase().replace(/[.,!?]+$/, '')
  if (!s) return null

  if (/^(today|tonight|this evening)$/.test(s)) return endOfDay(now).toISOString()
  if (/^tomorrow$/.test(s)) return endOfDay(addDays(now, 1)).toISOString()
  if (/^(the day after tomorrow|day after tomorrow)$/.test(s)) {
    return endOfDay(addDays(now, 2)).toISOString()
  }

  // "in 3 days" / "in a week" / "in two months"
  const relative = s.match(/^in\s+(\w+)\s+(day|days|week|weeks|month|months)$/)
  if (relative) {
    const n = count(relative[1])
    if (n === null) return null
    const unit = relative[2]
    if (unit.startsWith('day')) return endOfDay(addDays(now, n)).toISOString()
    if (unit.startsWith('week')) return endOfDay(addDays(now, n * 7)).toISOString()
    const months = new Date(now)
    months.setMonth(months.getMonth() + n)
    return endOfDay(months).toISOString()
  }

  if (/^next week$/.test(s)) return endOfDay(addDays(now, 7)).toISOString()
  if (/^next month$/.test(s)) {
    const d = new Date(now)
    d.setMonth(d.getMonth() + 1)
    return endOfDay(d).toISOString()
  }

  // "friday" / "on friday" / "next friday" — always the coming one, never a
  // day already gone. "next friday" when today IS Friday means a week away,
  // not today, which is what people mean by it.
  const named = s.match(/^(?:on\s+|this\s+|next\s+)?(\w+)$/)
  if (named && named[1] in WEEKDAYS) {
    const target = WEEKDAYS[named[1]]
    const isNext = s.startsWith('next')
    let delta = (target - now.getDay() + 7) % 7
    if (delta === 0) delta = 7
    if (isNext && delta < 7) delta += 0
    return endOfDay(addDays(now, delta)).toISOString()
  }

  return null
}

/** Recurrence, in the shape the chores table stores it. */
export interface SpokenRecurrence {
  count: number | null
  unit: 'hours' | 'days' | 'weeks' | 'months' | 'years' | 'weekdays'
  days: number[] | null
}

/**
 * "every 3 days" / "weekly" / "mondays and fridays" → a chore recurrence.
 *
 * Returns null when nothing recurring was said, which the caller treats as a
 * one-off — a schedule is a commitment and shouldn't be invented from a phrase
 * that didn't ask for one.
 */
export function parseRecurrence(input: string): SpokenRecurrence | null {
  const s = input.trim().toLowerCase().replace(/[.,!?]+$/, '')
  if (!s) return null

  // A plain "no"/"once" answer to "does this repeat?" is an explicit no.
  if (/^(no|nope|once|one off|one-off|never)$/.test(s)) return null

  if (/^(daily|every ?day)$/.test(s)) return { count: 1, unit: 'days', days: null }
  if (/^(weekly|every ?week)$/.test(s)) return { count: 1, unit: 'weeks', days: null }
  if (/^(fortnightly|biweekly)$/.test(s)) return { count: 2, unit: 'weeks', days: null }
  if (/^(monthly|every ?month)$/.test(s)) return { count: 1, unit: 'months', days: null }
  if (/^(yearly|annually|every ?year)$/.test(s)) return { count: 1, unit: 'years', days: null }

  // "every 3 days", "every two weeks"
  const every = s.match(/^every\s+(\w+)\s+(hour|hours|day|days|week|weeks|month|months|year|years)$/)
  if (every) {
    const n = count(every[1])
    if (n === null) return null
    const unit = every[2].replace(/s$/, '')
    const plural = `${unit}s` as SpokenRecurrence['unit']
    return { count: n, unit: plural, days: null }
  }

  // "mondays and fridays", "every monday", "tuesday, wednesday"
  const dayWords = s
    .replace(/^every\s+/, '')
    .split(/[,&]|\band\b/)
    .map((part) => part.trim().replace(/s$/, ''))
    .filter(Boolean)

  if (dayWords.length > 0 && dayWords.every((d) => d in WEEKDAYS)) {
    const days = [...new Set(dayWords.map((d) => WEEKDAYS[d]))].sort((a, b) => a - b)
    return { count: null, unit: 'weekdays', days }
  }

  return null
}
