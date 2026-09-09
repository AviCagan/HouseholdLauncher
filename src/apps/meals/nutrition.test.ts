import { describe, expect, it } from 'vitest'
import {
  batchesFor,
  dishCost,
  draftFromImport,
  formatQuantity,
  guessEmoji,
  ingredientCostSum,
  lineText,
  scaleAmount,
  shoppingList,
  shoppingListText,
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
  people: 4,
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

  it('scales cost by batches for the headcount, and leaves per-plate nutrition alone', () => {
    const bigRice = { ...rice, servings: 8 }
    const m = meal({
      people: 12,
      courses: [
        { role: 'main', label: 'Main', dish_id: 'chicken' },
        { role: 'side', label: 'Side', dish_id: 'rice' },
        { role: 'salad', label: 'Salad', dish_id: 'salad' },
      ],
    })
    const s = summariseMeal(m, [chicken, bigRice, salad])
    // chicken serves 4 → 3 batches; rice serves 8 → 2; salad serves 4 → 3.
    expect(s.batches).toEqual([3, 2, 3])
    expect(s.people).toBe(12)
    expect(s.cost).toBe(1800 * 3 + 200 * 2)
    expect(s.costKnown).toBe(2)
    expect(s.nutrition.totals.calories).toBe(630)
  })

  it('falls back to four people when the headcount is missing', () => {
    const m = meal({ people: 0, courses: [{ role: 'main', label: 'Main', dish_id: 'chicken' }] })
    expect(summariseMeal(m, [chicken]).people).toBe(4)
  })
})

describe('batches for a headcount', () => {
  it('rounds up to whole batches', () => {
    expect(batchesFor(12, 4)).toBe(3)
    expect(batchesFor(6, 4)).toBe(2)
    expect(batchesFor(4, 4)).toBe(1)
    expect(batchesFor(2, 4)).toBe(1)
    expect(batchesFor(9, 8)).toBe(2)
  })

  it('makes a dish once when it has no usable servings count', () => {
    expect(batchesFor(12, 0)).toBe(1)
    expect(batchesFor(12, NaN)).toBe(1)
    expect(batchesFor(0, 4)).toBe(1)
  })
})

describe('scaling an amount', () => {
  it('multiplies the leading number and writes it like a recipe would', () => {
    expect(scaleAmount('½ tsp', 3)).toBe('1½ tsp')
    expect(scaleAmount('2 cups', 2)).toBe('4 cups')
    expect(scaleAmount('1 1/2 cups', 2)).toBe('3 cups')
    expect(scaleAmount('1/4 cup', 3)).toBe('¾ cup')
    expect(scaleAmount('⅓ cup', 2)).toBe('⅔ cup')
    expect(scaleAmount('1½ tbsp', 2)).toBe('3 tbsp')
    expect(scaleAmount('400g', 2)).toBe('800g')
    expect(scaleAmount('1.5 kg', 2)).toBe('3 kg')
    expect(scaleAmount('2,5 dl', 2)).toBe('5 dl')
    expect(scaleAmount('2 (400g) tins', 3)).toBe('6 (400g) tins')
  })

  it('scales both ends of a range', () => {
    expect(scaleAmount('2-3 cloves', 2)).toBe('4-6 cloves')
    expect(scaleAmount('1 to 2 tbsp', 3)).toBe('3 to 6 tbsp')
  })

  it('marks what it cannot multiply instead of guessing', () => {
    expect(scaleAmount('a pinch', 2)).toBe('a pinch ×2')
    expect(scaleAmount('to taste', 3)).toBe('to taste ×3')
    expect(scaleAmount(null, 3)).toBe('×3')
  })

  it('leaves a single batch exactly as written', () => {
    expect(scaleAmount('2 cups', 1)).toBe('2 cups')
    expect(scaleAmount('to taste', 1)).toBe('to taste')
    expect(scaleAmount(null, 1)).toBeNull()
  })

  it('writes quantities as kitchen fractions where they fit, decimals where not', () => {
    expect(formatQuantity(2.25)).toBe('2¼')
    expect(formatQuantity(0.5)).toBe('½')
    expect(formatQuantity(3)).toBe('3')
    expect(formatQuantity(2.999)).toBe('3')
    expect(formatQuantity(0.4)).toBe('0.4')
    expect(formatQuantity(1.2)).toBe('1.2')
    expect(formatQuantity(0.6)).toBe('0.6')
  })
})

describe('shopping list', () => {
  const chicken = dish({
    id: 'chicken',
    ingredients: [
      { name: 'chicken', amount: '1', cost_cents: 1200 },
      { name: 'lemons', amount: '2', cost_cents: 80 },
      { name: 'salt', amount: 'to taste', cost_cents: null },
      { name: 'thyme', amount: null, cost_cents: null },
    ],
  })
  const bread = dish({ id: 'bread', name: 'Challah', emoji: '🍞', kind: 'bread', servings: 12, ingredients: [] })

  it('scales every ingredient to the batches for the headcount', () => {
    const m = meal({
      people: 12,
      courses: [
        { role: 'main', label: 'Main', dish_id: 'chicken' },
        { role: 'bread', label: 'Challah', dish_id: 'bread' },
      ],
    })
    const groups = shoppingList(m, [chicken, bread])
    expect(groups.map((g) => g.batches)).toEqual([3, 1])
    expect(groups[0].lines.map(lineText)).toEqual(['3 chicken', '6 lemons', 'salt — to taste ×3', 'thyme ×3'])
    expect(groups[1].lines).toEqual([])
  })

  it('reads as a list when written out', () => {
    const m = meal({ name: 'Friday', people: 12, courses: [{ role: 'main', label: 'Main', dish_id: 'chicken' }] })
    const text = shoppingListText(m, shoppingList(m, [chicken]))
    expect(text.split('\n')).toEqual([
      'Friday — shopping for 12',
      '',
      '🍗 Roast chicken ×3',
      '  • 3 chicken',
      '  • 6 lemons',
      '  • salt — to taste ×3',
      '  • thyme ×3',
    ])
  })

  it('puts the amount after the name when it is not a number', () => {
    expect(lineText({ name: 'eggs', amount: '4' })).toBe('4 eggs')
    expect(lineText({ name: 'salt', amount: 'a pinch' })).toBe('salt — a pinch')
    expect(lineText({ name: 'salt', amount: null })).toBe('salt')
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
