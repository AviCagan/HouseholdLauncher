import { describe, expect, it } from 'vitest'
import type { Dish, Meal } from '@/data/types'
import {
  addDays,
  boardLength,
  copyMealForDate,
  googleMealEventUrl,
  isoDate,
  mealEventDescription,
  mealFromDishes,
  mealsInRange,
  planWeeks,
  quickMeal,
  repeatable,
} from './plan'

const meal = (patch: Partial<Meal>): Meal => ({
  id: 'm',
  name: 'Shabbat dinner',
  emoji: '🕯️',
  occasion: 'shabbat',
  template_id: null,
  planned_for: null,
  people: 6,
  courses: [],
  notes: null,
  created_by: null,
  updated_by: null,
  created_at: '2026-09-01T00:00:00.000Z',
  updated_at: '2026-09-01T00:00:00.000Z',
  ...patch,
})

// A Wednesday.
const WED = new Date(2026, 8, 9, 15, 30)

describe('dates', () => {
  it('writes local dates, not UTC ones', () => {
    expect(isoDate(new Date(2026, 8, 9, 23, 59))).toBe('2026-09-09')
    expect(isoDate(new Date(2026, 0, 1, 0, 0))).toBe('2026-01-01')
  })

  it('adds days across a month end', () => {
    expect(addDays('2026-09-29', 3)).toBe('2026-10-02')
    expect(addDays('2026-09-09', -9)).toBe('2026-08-31')
  })
})

describe('the board', () => {
  it('runs to the Saturday two whole weeks out, never a week cut off midway', () => {
    expect(boardLength(WED)).toBe(18)
    expect(boardLength(new Date(2026, 8, 13))).toBe(21) // a Sunday
    expect(boardLength(new Date(2026, 8, 12))).toBe(15) // a Saturday
    const weeks = planWeeks([], WED)
    expect(weeks.map((w) => w.label)).toEqual(['This week', 'Next week', 'In two weeks'])
    expect(weeks.map((w) => w.days.length)).toEqual([4, 7, 7])
    expect(weeks[1].days[0].weekday).toBe(0)
    expect(weeks[2].days[6].weekday).toBe(6)
    expect(weeks.flatMap((w) => w.days)).toHaveLength(18)
  })

  it('labels today and tomorrow, then the weekday, and marks Shabbat', () => {
    const [thisWeek] = planWeeks([], WED)
    expect(thisWeek.days.map((d) => d.label)).toEqual(['Today', 'Tomorrow', 'Fri', 'Sat'])
    expect(thisWeek.days.map((d) => d.shabbat)).toEqual([null, null, 'dinner', 'lunch'])
    expect(thisWeek.days[0].short).toBe('9 Sep')
  })

  it('puts each meal on its day, oldest first', () => {
    const a = meal({ id: 'a', planned_for: '2026-09-11', created_at: '2026-09-02T00:00:00.000Z' })
    const b = meal({ id: 'b', planned_for: '2026-09-11', created_at: '2026-09-01T00:00:00.000Z' })
    const c = meal({ id: 'c', planned_for: '2026-10-01' })
    const [thisWeek] = planWeeks([a, b, c], WED)
    expect(thisWeek.days[2].meals.map((m) => m.id)).toEqual(['b', 'a'])
    expect(planWeeks([a, b, c], WED).flatMap((w) => w.days).flatMap((d) => d.meals)).toHaveLength(2)
  })

  it('starts a fresh board from a Sunday with three full weeks', () => {
    const weeks = planWeeks([], new Date(2026, 8, 13))
    expect(weeks.map((w) => w.days.length)).toEqual([7, 7, 7])
  })
})

describe('what is on the board', () => {
  it('is every dated meal on the board, in order', () => {
    const inside = meal({ id: 'in', planned_for: '2026-09-26' }) // the last Saturday
    const edge = meal({ id: 'edge', planned_for: '2026-09-09' })
    const outside = meal({ id: 'out', planned_for: '2026-09-27' })
    const undated = meal({ id: 'none' })
    expect(mealsInRange([outside, inside, undated, edge], WED).map((m) => m.id)).toEqual(['edge', 'in'])
  })

  it('offers meals with dishes in them as repeatable, newest first, one per name', () => {
    const withDish = (id: string, name: string, updated: string) =>
      meal({ id, name, updated_at: updated, courses: [{ role: 'main', label: 'Main', dish_id: 'd' }] })
    const list = [
      withDish('old', 'Shabbat dinner', '2026-08-01T00:00:00.000Z'),
      withDish('new', 'shabbat dinner', '2026-09-01T00:00:00.000Z'),
      withDish('other', 'Taco night', '2026-08-15T00:00:00.000Z'),
      meal({ id: 'empty', name: 'Leftovers' }),
    ]
    expect(repeatable(list).map((m) => m.id)).toEqual(['new', 'other'])
  })
})

describe('making a meal for a day', () => {
  it('copies the dishes and headcount onto the new date, without the notes', () => {
    const src = meal({ notes: 'Nuri came', courses: [{ role: 'main', label: 'Main', dish_id: 'd' }], template_id: 't' })
    const copy = copyMealForDate(src, '2026-09-18')
    expect(copy.planned_for).toBe('2026-09-18')
    expect(copy.courses).toEqual(src.courses)
    expect(copy.courses).not.toBe(src.courses)
    expect(copy.people).toBe(6)
    expect(copy.template_id).toBe('t')
    expect(copy.notes).toBeNull()
  })

  it('makes a quick note into a meal with a fitting emoji and no courses', () => {
    expect(quickMeal('Leftovers', '2026-09-10', 2)).toMatchObject({ name: 'Leftovers', emoji: '🥡', planned_for: '2026-09-10', people: 2, courses: [] })
    expect(quickMeal('Pizza night', '2026-09-10', 2).emoji).toBe('🍕')
    expect(quickMeal('Something', '2026-09-10', 2).emoji).toBe('📝')
  })
})

describe('calendar event', () => {
  const dishes = [{ id: 'd1', name: 'Roast chicken' }]
  const planned = meal({
    planned_for: '2026-09-11',
    people: 8,
    notes: 'Bring the good wine',
    courses: [
      { role: 'main', label: 'Main', dish_id: 'd1' },
      { role: 'side', label: 'Side', dish_id: null },
    ],
  })

  it('describes the headcount and every course', () => {
    expect(mealEventDescription(planned, dishes)).toBe('For 8\n\nMain: Roast chicken\nSide: —\n\nBring the good wine')
  })

  it('is an all-day Google event on the planned day', () => {
    const url = new URL(googleMealEventUrl(planned, dishes)!)
    expect(url.searchParams.get('action')).toBe('TEMPLATE')
    expect(url.searchParams.get('text')).toBe('🕯️ Shabbat dinner')
    expect(url.searchParams.get('dates')).toBe('20260911/20260912')
    expect(url.searchParams.get('details')).toContain('Main: Roast chicken')
  })

  it('has nothing to add for an undated meal', () => {
    expect(googleMealEventUrl(meal({}), dishes)).toBeNull()
  })
})

describe('a meal from dishes', () => {
  const dish = (id: string, name: string, kind: Dish['kind'], emoji = '🍽️'): Dish => ({
    id, name, emoji, kind, ingredients: [], steps: [], servings: 4, cost_cents: null, nutrition: {},
    source_url: null, source_kind: 'manual', image_url: null, notes: null, tags: [],
    created_by: null, updated_by: null, created_at: '2026-09-01T00:00:00.000Z', updated_at: '2026-09-01T00:00:00.000Z',
  })
  const chicken = dish('c', 'Roast chicken', 'main', '🍗')
  const rice = dish('r', 'Rice', 'side')
  const salad = dish('s', 'Green salad', 'salad')
  const cake = dish('k', 'Honey cake', 'dessert')

  it('puts a course per dish in table order and names the meal after them', () => {
    const m = mealFromDishes([rice, cake, chicken], '2026-09-15', 3)
    expect(m.courses.map((c) => `${c.label}:${c.dish_id}`)).toEqual(['Main:c', 'Side:r', 'Dessert:k'])
    expect(m.name).toBe('Roast chicken, Rice & Honey cake')
    expect(m.emoji).toBe('🍗')
    expect(m.people).toBe(3)
    expect(m.planned_for).toBe('2026-09-15')
    expect(m.occasion).toBe('dinner')
  })

  it('keeps a long list readable and calls a Friday Shabbat', () => {
    expect(mealFromDishes([chicken, rice, salad, cake], '2026-09-11', 6).name).toBe('Green salad, Roast chicken & 2 more')
    expect(mealFromDishes([chicken], '2026-09-11', 6).name).toBe('Roast chicken')
    expect(mealFromDishes([chicken], '2026-09-11', 6).occasion).toBe('shabbat')
  })
})
