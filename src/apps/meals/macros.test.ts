import { describe, expect, it } from 'vitest'
import { dishMacros, findFood, gramsFor, lineMacros, normaliseFoodName } from './macros'
import { FOODS } from './foods'

describe('the pantry', () => {
  it('has no duplicate names and sane numbers', () => {
    const seen = new Map<string, string>()
    for (const food of FOODS) {
      for (const name of food.names) {
        expect(seen.has(name), `"${name}" is listed under both "${seen.get(name)}" and "${food.names[0]}"`).toBe(false)
        seen.set(name, food.names[0])
      }
      const [kcal, p, c, fat] = food.n
      expect(kcal).toBeGreaterThanOrEqual(0)
      expect(kcal).toBeLessThanOrEqual(920)
      // Macros can't add up to more than the weight.
      expect(p + c + fat).toBeLessThanOrEqual(101)
    }
  })
})

describe('finding the food', () => {
  it('strips what a recipe says around the ingredient', () => {
    expect(normaliseFoodName('2 large eggs, lightly beaten')).toBe('2 eggs')
    expect(normaliseFoodName('Fresh flat-leaf parsley (chopped)')).toBe('flat-leaf parsley')
    expect(findFood('boneless skinless chicken breasts')?.names[0]).toBe('chicken breast')
    expect(findFood('Eggs')?.names[0]).toBe('egg')
    expect(findFood('eggplant')?.names[0]).toBe('eggplant')
    expect(findFood('extra virgin olive oil')?.names[0]).toBe('olive oil')
    expect(findFood('cloves of garlic, minced')?.names[0]).toBe('garlic')
    expect(findFood('tomatoes')?.names[0]).toBe('tomato')
    expect(findFood('Kosher salt')?.names[0]).toBe('kosher salt')
    expect(findFood("za'atar")?.names[0]).toBe("za'atar")
  })

  it('prefers the longer, more specific name', () => {
    expect(findFood('brown sugar')?.names[0]).toBe('brown sugar')
    expect(findFood('sugar')?.names[0]).toBe('sugar')
    expect(findFood('cherry tomatoes')?.names[0]).toBe('cherry tomatoes')
    expect(findFood('ground beef')?.names[0]).toBe('ground beef')
  })

  it('gives up on things it has never heard of', () => {
    expect(findFood('love')).toBeNull()
    expect(findFood('grandma’s secret')).toBeNull()
    expect(findFood('')).toBeNull()
  })
})

describe('grams', () => {
  const flour = findFood('flour')!
  const egg = findFood('egg')!
  const garlic = findFood('garlic')!
  const oil = findFood('olive oil')!
  const water = findFood('water')!

  it('uses the cup weight for volume, and water-density when there is none', () => {
    expect(gramsFor('2 cups', flour)).toEqual({ grams: 250, how: 'volume' })
    expect(gramsFor('1 tbsp', oil)).toMatchObject({ how: 'volume' })
    expect((gramsFor('1 tbsp', oil) as { grams: number }).grams).toBeCloseTo(13.5, 0)
    expect((gramsFor('1 cup', water) as { grams: number }).grams).toBeCloseTo(237, 0)
    expect((gramsFor('½ tsp', flour) as { grams: number }).grams).toBeCloseTo(1.3, 0)
  })

  it('takes weights as they are, in any unit', () => {
    expect(gramsFor('400g', flour)).toEqual({ grams: 400, how: 'weight' })
    expect(gramsFor('1.5 kg', flour)).toEqual({ grams: 1500, how: 'weight' })
    expect((gramsFor('1 lb', flour) as { grams: number }).grams).toBeCloseTo(453.6, 0)
    expect((gramsFor('8 oz', flour) as { grams: number }).grams).toBeCloseTo(226.8, 0)
    expect(gramsFor('1 (400g) can', findFood('chickpeas')!)).toEqual({ grams: 400, how: 'weight' })
    expect(gramsFor('2 (14 oz) cans', findFood('chickpeas')!)).toMatchObject({ how: 'weight' })
  })

  it('counts pieces with the food’s own weight', () => {
    expect(gramsFor('3', egg)).toEqual({ grams: 150, how: 'each' })
    expect(gramsFor('2 large', egg)).toEqual({ grams: 100, how: 'each' })
    expect(gramsFor(null, egg)).toEqual({ grams: 50, how: 'each' })
    expect(gramsFor('4 cloves', garlic)).toEqual({ grams: 12, how: 'each' })
    expect(gramsFor('1 head', garlic)).toEqual({ grams: 40, how: 'each' })
    expect(gramsFor('2-3', egg)).toEqual({ grams: 125, how: 'each' })
  })

  it('knows a pinch from nothing at all', () => {
    expect(gramsFor('a pinch', findFood('salt')!)).toEqual({ grams: 0.3, how: 'each' })
    expect(gramsFor('to taste', findFood('salt')!)).toEqual({ grams: 0, how: 'each' })
    expect(gramsFor('some', flour)).toEqual({ reason: 'no-amount' })
    expect(gramsFor('2', flour)).toEqual({ reason: 'no-weight' })
  })
})

describe('a dish', () => {
  const challah = [
    { name: 'bread flour', amount: '4 cups', cost_cents: null },
    { name: 'eggs', amount: '2', cost_cents: null },
    { name: 'honey', amount: '¼ cup', cost_cents: null },
    { name: 'vegetable oil', amount: '⅓ cup', cost_cents: null },
    { name: 'salt', amount: '1 tsp', cost_cents: null },
    { name: 'yeast', amount: '1 packet', cost_cents: null },
    { name: 'love', amount: 'lots', cost_cents: null },
    { name: '', amount: null, cost_cents: null },
  ]

  it('adds up what it can, per serving, and names what it could not', () => {
    const m = dishMacros(challah, 12)
    expect(m.known).toHaveLength(6)
    expect(m.unknown.map((u) => `${u.ingredient.name}:${u.reason}`)).toEqual(['love:no-food'])
    // 4 cups bread flour ≈ 508 g ≈ 1834 kcal; two eggs 143; honey 85 g ≈ 258;
    // oil 72 g ≈ 640; a whole loaf is roughly 2900 kcal, so ~240 a slice.
    expect(m.perServing.calories).toBeGreaterThan(200)
    expect(m.perServing.calories).toBeLessThan(290)
    expect(m.perServing.protein_g).toBeGreaterThan(5)
    expect(m.perServing.sodium_mg).toBeGreaterThan(150)
    expect(m.total.calories).toBeCloseTo(m.perServing.calories! * 12, -2)
  })

  it('is empty, not zero, when nothing matched', () => {
    const m = dishMacros([{ name: 'love', amount: null, cost_cents: null }], 4)
    expect(m.perServing).toEqual({})
    expect(m.known).toEqual([])
    expect(m.unknown).toHaveLength(1)
  })

  it('reports why a line was left out', () => {
    expect(lineMacros({ name: 'flour', amount: '2', cost_cents: null })).toMatchObject({ reason: 'no-weight' })
    expect(lineMacros({ name: 'flour', amount: 'some', cost_cents: null })).toMatchObject({ reason: 'no-amount' })
    expect(lineMacros({ name: 'chicken breast', amount: '2', cost_cents: null })).toMatchObject({ grams: 348, food: 'chicken breast' })
  })
})
