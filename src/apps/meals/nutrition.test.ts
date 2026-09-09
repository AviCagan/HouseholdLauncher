import { describe, expect, it } from 'vitest'
import {
  dishCost,
  draftFromImport,
  guessEmoji,
  ingredientCostSum,
  sumNutrition,
  summariseMeal,
} from './nutrition'
import type { Dish, Meal } from '@/data/types'

const dish = (patch: Partial<Dish> = {}): Dish => ({
  id: 'd1',
  name: 'Roast chicken',
  emoji: '🍗',
  kind: 'main',
  ingredients: [],
  steps: [],
  servings: 4,
  cost_cents: null,
  nutrition: {},
  source_url: null,
  source_kind: 'manual',
  image_url: null,
  notes: null,
  tags: [],
  created_by: null,
  updated_by: null,
  created_at: '2026-09-01T00:00:00.000Z',
  updated_at: '2026-09-01T00:00:00.000Z',
  ...patch,
})

const meal = (patch: Partial<Meal> = {}): Meal => ({
  id: 'm1',
  name: 'Shabbat dinner',
  emoji: '🕯️',
  occasion: 'shabbat',
  template_id: null,
  planned_for: null,
  courses: [],
  notes: null,
  created_by: null,
  updated_by: null,
  created_at: '2026-09-01T00:00:00.000Z',
  updated_at: '2026-09-01T00:00:00.000Z',
  ...patch,
})

describe('dish cost', () => {
  it('is null until something is entered, never zero', () => {
    expect(dishCost(dish())).toBeNull()
    expect(ingredientCostSum([{ name: 'flour', amount: '2 cups', cost_cents: null }])).toBeNull()
  })

  it('adds up ingredient costs when only those are known', () => {
    const d = dish({
      ingredients: [
        { name: 'chicken', amount: '1', cost_cents: 1200 },
        { name: 'lemon', amount: '2', cost_cents: 80 },
        { name: 'salt', amount: 'to taste', cost_cents: null },
      ],
    })
    expect(dishCost(d)).toBe(1280)
  })

  it('prefers a typed-in total over the ingredient sum', () => {
    const d = dish({
      cost_cents: 1500,
      ingredients: [{ name: 'chicken', amount: '1', cost_cents: 1200 }],
    })
    expect(dishCost(d)).toBe(1500)
  })
})

describe('nutrition totals', () => {
  it('sums what is known and counts how many contributed', () => {
    const { totals, known } = sumNutrition([
      { calories: 300, protein_g: 20 },
      { calories: 150 },
      {},
    ])
    expect(totals.calories).toBe(450)
    expect(totals.protein_g).toBe(20)
    expect(known.calories).toBe(2)
    expect(known.protein_g).toBe(1)
    // Nothing contributed carbs, so there is no carbs figure at all — not 0.
    expect(totals.carbs_g).toBeUndefined()
    expect(known.carbs_g).toBe(0)
  })
})

describe('meal summary', () => {
  const chicken = dish({ id: 'chicken', cost_cents: 1800, nutrition: { calories: 420, protein_g: 38 } })
  const rice = dish({ id: 'rice', kind: 'side', cost_cents: 200, nutrition: { calories: 210 } })
  const salad = dish({ id: 'salad', kind: 'salad' }) // nothing entered

  it('totals cost and per-plate nutrition across the dishes in it', () => {
    const m = meal({
      courses: [
        { role: 'main', label: 'Main', dish_id: 'chicken' },
        { role: 'side', label: 'Side', dish_id: 'rice' },
        { role: 'salad', label: 'Salad', dish_id: 'salad' },
      ],
    })
    const s = summariseMeal(m, [chicken, rice, salad])
    expect(s.dishes.map((d) => d.id)).toEqual(['chicken', 'rice', 'salad'])
    expect(s.cost).toBe(2000)
    expect(s.costKnown).toBe(2)
    expect(s.nutrition.totals.calories).toBe(630)
    expect(s.nutrition.known.calories).toBe(2)
    expect(s.nutrition.totals.protein_g).toBe(38)
  })

  it('separates an empty slot from a slot whose dish was deleted', () => {
    const m = meal({
      courses: [
        { role: 'main', label: 'Main', dish_id: 'chicken' },
        { role: 'side', label: 'Side', dish_id: null },
        { role: 'dessert', label: 'Dessert', dish_id: 'gone' },
      ],
    })
    const s = summariseMeal(m, [chicken])
    expect(s.dishes).toHaveLength(1)
    expect(s.empty).toBe(1)
    expect(s.orphaned).toBe(1)
  })

  it('reports no cost when no dish has one, rather than $0', () => {
    const m = meal({ courses: [{ role: 'salad', label: 'Salad', dish_id: 'salad' }] })
    expect(summariseMeal(m, [salad]).cost).toBeNull()
  })
})

describe('draft from an import', () => {
  it('splits ingredient lines into amount and name', () => {
    const draft = draftFromImport(
      {
        name: 'Challah',
        image: null,
        ingredients: ['4 cups flour', '2 eggs', 'Salt to taste'],
        steps: ['Mix.', 'Bake.'],
        servings: 8,
        nutrition: { calories: 180 },
        sourceKind: 'web',
        confidence: 'structured',
      },
      'https://example.com/challah',
    )
    expect(draft.ingredients).toEqual([
      { name: 'flour', amount: '4 cups', cost_cents: null },
      { name: 'eggs', amount: '2', cost_cents: null },
      { name: 'Salt to taste', amount: null, cost_cents: null },
    ])
    expect(draft.servings).toBe(8)
    expect(draft.nutrition.calories).toBe(180)
    expect(draft.source_kind).toBe('web')
  })

  it('falls back to four servings when the page did not say', () => {
    const draft = draftFromImport(
      { name: null, image: null, ingredients: [], steps: [], servings: null, nutrition: {}, sourceKind: 'instagram', confidence: 'heuristic' },
      null,
    )
    expect(draft.servings).toBe(4)
    expect(draft.name).toBe('')
  })
})

describe('emoji guessing', () => {
  it('picks from the name first, then the kind', () => {
    expect(guessEmoji('Honey cake', 'dessert')).toBe('🍰')
    expect(guessEmoji('Round challah', 'bread')).toBe('🍞')
    expect(guessEmoji('Matzah ball soup', 'soup')).toBe('🍲')
    expect(guessEmoji('Something mysterious', 'side')).toBe('🥔')
  })
})
