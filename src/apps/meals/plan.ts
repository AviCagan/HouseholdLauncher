import type { Dish, Meal } from '@/data/types'
import type { MealInput } from './actions'

/**
 * The planner's arithmetic: which days are on the board, how they fall into
 * weeks, what is planned on each, and how a planned meal becomes a calendar
 * event. No React in here so the week-splitting can be tested against fixed
 * dates rather than whatever today happens to be.
 */

/** A local calendar date as YYYY-MM-DD. Not UTC: dinner is where the phone is. */
export function isoDate(d: Date): string {
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

export function addDays(iso: string, n: number): string {
  const d = new Date(`${iso}T12:00:00`)
  d.setDate(d.getDate() + n)
  return isoDate(d)
}

/** 0 (Sunday) … 6 (Saturday), same convention as everywhere else in the app. */
export const weekdayOf = (iso: string): number => new Date(`${iso}T12:00:00`).getDay()

export const DAY_SHORT = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
const MONTH_SHORT = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

export interface PlanDay {
  date: string
  /** "Today", "Tomorrow", or the weekday. */
  label: string
  /** "12 Sep" */
  short: string
  weekday: number
  /** Friday night and Saturday get a candle and a sun; the planner marks them. */
  shabbat: 'dinner' | 'lunch' | null
  meals: Meal[]
}

export interface PlanWeek {
  label: string
  days: PlanDay[]
}

/** Meals on a date, oldest first so the order is stable as they're added. */
export function mealsOn(meals: Meal[], date: string): Meal[] {
  return meals.filter((m) => m.planned_for === date).sort((a, b) => a.created_at.localeCompare(b.created_at))
}

/**
 * The next `count` days from today, cut into weeks that end on Saturday —
 * the week a Shabbat household actually plans in — and labelled from where
 * today sits. Two weeks ahead from a Wednesday is the rest of this week,
 * all of next, and the start of the one after.
 */
export function planWeeks(meals: Meal[], today: Date, count = 14): PlanWeek[] {
  const start = isoDate(today)
  const weeks: PlanWeek[] = []
  const labels = ['This week', 'Next week', 'In two weeks', 'In three weeks']
  let current: PlanWeek | null = null
  for (let i = 0; i < count; i++) {
    const date = addDays(start, i)
    const weekday = weekdayOf(date)
    if (!current || weekday === 0) {
      current = { label: labels[weeks.length] ?? `Week ${weeks.length + 1}`, days: [] }
      weeks.push(current)
    }
    const d = new Date(`${date}T12:00:00`)
    current.days.push({
      date,
      label: i === 0 ? 'Today' : i === 1 ? 'Tomorrow' : DAY_SHORT[weekday],
      short: `${d.getDate()} ${MONTH_SHORT[d.getMonth()]}`,
      weekday,
      shabbat: weekday === 5 ? 'dinner' : weekday === 6 ? 'lunch' : null,
      meals: mealsOn(meals, date),
    })
  }
  return weeks
}

/** Every planned meal inside the board, in date order. */
export function mealsInRange(meals: Meal[], today: Date, count = 14): Meal[] {
  const from = isoDate(today)
  const to = addDays(from, count - 1)
  return meals
    .filter((m) => m.planned_for && m.planned_for >= from && m.planned_for <= to)
    .sort((a, b) => a.planned_for!.localeCompare(b.planned_for!) || a.created_at.localeCompare(b.created_at))
}

/** Saved meals worth offering as "make it again": has courses, newest first, no duplicates by name. */
export function repeatable(meals: Meal[], limit = 12): Meal[] {
  const seen = new Set<string>()
  return [...meals]
    .filter((m) => m.courses.some((c) => c.dish_id))
    .sort((a, b) => b.updated_at.localeCompare(a.updated_at))
    .filter((m) => {
      const key = m.name.trim().toLowerCase()
      if (seen.has(key)) return false
      seen.add(key)
      return true
    })
    .slice(0, limit)
}

/** A copy of a meal for a new date — same dishes and headcount, its own row. */
export function copyMealForDate(meal: Meal, date: string): MealInput {
  return {
    name: meal.name,
    emoji: meal.emoji,
    occasion: meal.occasion,
    template_id: meal.template_id,
    planned_for: date,
    people: meal.people > 0 ? meal.people : 4,
    courses: meal.courses.map((c) => ({ ...c })),
    notes: null,
  }
}

/** A meal that is only a name — "Leftovers", "Out", "Pizza night". */
export function quickMeal(name: string, date: string, people: number): MealInput {
  return {
    name: name.trim(),
    emoji: guessNoteEmoji(name),
    occasion: 'dinner',
    template_id: null,
    planned_for: date,
    people,
    courses: [],
    notes: null,
  }
}

function guessNoteEmoji(name: string): string {
  const n = name.toLowerCase()
  if (/leftover/.test(n)) return '🥡'
  if (/out|restaurant|order|takeaway|takeout|delivery/.test(n)) return '🍽️'
  if (/pizza/.test(n)) return '🍕'
  if (/sushi/.test(n)) return '🍣'
  if (/burger/.test(n)) return '🍔'
  if (/taco/.test(n)) return '🌮'
  if (/pasta|spaghetti/.test(n)) return '🍝'
  if (/soup/.test(n)) return '🍲'
  if (/salad/.test(n)) return '🥗'
  if (/breakfast|pancake|waffle/.test(n)) return '🥞'
  if (/shabbat|shabbos/.test(n)) return '🕯️'
  return '📝'
}

/**
 * What the calendar says about a meal: the headcount, then each course with
 * the dish in it. Mirrors the feed's own text (supabase/functions/calendar)
 * so the event reads the same whichever way it arrived.
 */
export function mealEventDescription(meal: Meal, dishes: Pick<Dish, 'id' | 'name'>[]): string {
  const nameOf = (id: string | null) => (id ? dishes.find((d) => d.id === id)?.name ?? null : null)
  const lines = [`For ${meal.people > 0 ? meal.people : 4}`]
  const courses = meal.courses.map((c) => `${c.label}: ${nameOf(c.dish_id) ?? '—'}`)
  if (courses.length) lines.push('', ...courses)
  if (meal.notes) lines.push('', meal.notes)
  return lines.join('\n')
}

/**
 * A pre-filled Google Calendar event for one meal: an all-day entry on the
 * day it's planned for, which lands the moment Save is pressed — the way to
 * get something onto the calendar now rather than when Google next polls the
 * feed. Null for a meal with no date.
 */
export function googleMealEventUrl(meal: Meal, dishes: Pick<Dish, 'id' | 'name'>[]): string | null {
  if (!meal.planned_for) return null
  const day = meal.planned_for.replace(/-/g, '')
  const next = addDays(meal.planned_for, 1).replace(/-/g, '')
  const params = new URLSearchParams({
    action: 'TEMPLATE',
    text: `${meal.emoji} ${meal.name}`.trim(),
    dates: `${day}/${next}`,
    details: mealEventDescription(meal, dishes),
  })
  return `https://calendar.google.com/calendar/render?${params.toString()}`
}
