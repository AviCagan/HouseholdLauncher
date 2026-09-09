import { NUTRITION_KEYS } from '@/data/types'
import type { Dish, Ingredient, Meal, Nutrition } from '@/data/types'
import { splitIngredient } from '../../../supabase/functions/recipe/parse'
import type { ImportedRecipe } from '@/lib/recipe'

/**
 * Pure maths behind the cost and nutrition figures — no store, no React, so
 * the rules can be tested on their own.
 *
 * The one rule that matters everywhere here: an unknown is not a zero. A meal
 * of three dishes where only one has nutrition entered does not have "140
 * calories"; it has 140 known calories and two dishes nobody has filled in.
 * Every total therefore comes with a count of how many contributed, and the
 * UI says "2 of 3 dishes" rather than presenting a partial sum as the answer.
 */

/** Sum of the per-ingredient costs, or null if none were entered. */
export function ingredientCostSum(ingredients: Ingredient[]): number | null {
  let sum = 0
  let any = false
  for (const i of ingredients) {
    if (i.cost_cents != null) {
      sum += i.cost_cents
      any = true
    }
  }
  return any ? sum : null
}

/**
 * What a dish costs to make.
 *
 * An explicitly entered dish cost wins over the ingredient sum: the sum is a
 * convenience for someone pricing as they go, and a typed-in total is the
 * more deliberate statement of the two.
 */
export const dishCost = (dish: Pick<Dish, 'cost_cents' | 'ingredients'>): number | null =>
  dish.cost_cents ?? ingredientCostSum(dish.ingredients)

export interface NutritionTotals {
  totals: Nutrition
  /** How many inputs contributed a value for each key. */
  known: Record<keyof Nutrition, number>
}

export function sumNutrition(list: Nutrition[]): NutritionTotals {
  const totals: Nutrition = {}
  const known = Object.fromEntries(NUTRITION_KEYS.map((k) => [k, 0])) as Record<
    keyof Nutrition,
    number
  >
  for (const n of list) {
    for (const key of NUTRITION_KEYS) {
      const v = n[key]
      if (v == null || !Number.isFinite(v)) continue
      totals[key] = (totals[key] ?? 0) + v
      known[key] += 1
    }
  }
  return { totals, known }
}

export interface MealSummary {
  /** The dishes actually in the meal, in course order. Empty slots skipped. */
  dishes: Dish[]
  /** Slots with nothing in them yet. */
  empty: number
  /** Slots whose dish has since been deleted. */
  orphaned: number
  cost: number | null
  /** How many of the dishes had a cost. */
  costKnown: number
  /** Per plate: each dish contributes one serving's worth. */
  nutrition: NutritionTotals
}

export function summariseMeal(meal: Meal, allDishes: Dish[]): MealSummary {
  const byId = new Map(allDishes.map((d) => [d.id, d]))
  const dishes: Dish[] = []
  let empty = 0
  let orphaned = 0

  for (const course of meal.courses) {
    if (!course.dish_id) {
      empty += 1
      continue
    }
    const dish = byId.get(course.dish_id)
    if (dish) dishes.push(dish)
    else orphaned += 1
  }

  let cost: number | null = null
  let costKnown = 0
  for (const d of dishes) {
    const c = dishCost(d)
    if (c == null) continue
    cost = (cost ?? 0) + c
    costKnown += 1
  }

  return {
    dishes,
    empty,
    orphaned,
    cost,
    costKnown,
    nutrition: sumNutrition(dishes.map((d) => d.nutrition)),
  }
}

export const fmtKcal = (n: number): string => `${Math.round(n)} kcal`
export const fmtGrams = (n: number): string => `${Math.round(n)}g`
export const fmtMg = (n: number): string => `${Math.round(n)}mg`

export const NUTRITION_LABEL: Record<keyof Nutrition, { label: string; fmt: (n: number) => string }> = {
  calories: { label: 'Calories', fmt: fmtKcal },
  protein_g: { label: 'Protein', fmt: fmtGrams },
  carbs_g: { label: 'Carbs', fmt: fmtGrams },
  fat_g: { label: 'Fat', fmt: fmtGrams },
  fiber_g: { label: 'Fibre', fmt: fmtGrams },
  sodium_mg: { label: 'Sodium', fmt: fmtMg },
}

/** Whether any nutrition value at all has been entered. */
export const hasNutrition = (n: Nutrition): boolean =>
  NUTRITION_KEYS.some((k) => n[k] != null && Number.isFinite(n[k] as number))

/**
 * Turn what the importer read into the shape the dish editor edits.
 *
 * Ingredient lines are split into amount and name — "2 cups flour" becomes
 * { amount: "2 cups", name: "flour" } — using the same splitter the server's
 * parser uses, so a line reads the same whichever side handled it.
 */
export function draftFromImport(
  recipe: ImportedRecipe,
  url: string | null,
): Pick<
  Dish,
  'name' | 'ingredients' | 'steps' | 'servings' | 'nutrition' | 'source_url' | 'source_kind' | 'image_url'
> {
  return {
    name: recipe.name?.trim() || '',
    ingredients: recipe.ingredients.map((line) => {
      const { amount, name } = splitIngredient(line)
      return { name, amount, cost_cents: null }
    }),
    steps: recipe.steps,
    servings: recipe.servings ?? 4,
    nutrition: { ...recipe.nutrition },
    source_url: url,
    source_kind: recipe.sourceKind,
    image_url: recipe.image,
  }
}

/** A plausible emoji for a dish name, for when nobody has picked one. */
export function guessEmoji(name: string, kind: string): string {
  const n = name.toLowerCase()
  const table: [RegExp, string][] = [
    [/challah|bread|loaf|bagel|pita|roll/, '🍞'],
    [/chicken|schnitzel/, '🍗'],
    [/beef|brisket|steak|roast/, '🥩'],
    [/salmon|fish|tuna|gefilte|lox/, '🐟'],
    [/soup|broth|matzah ball/, '🍲'],
    [/salad|greens|slaw/, '🥗'],
    [/pasta|spaghetti|noodle|lasagn/, '🍝'],
    [/rice|risotto/, '🍚'],
    [/potato|latke|kugel|fries/, '🥔'],
    [/egg|omelet|shakshuka/, '🍳'],
    [/cake|cheesecake|brownie|cookie|hamantasch|babka/, '🍰'],
    [/pie|tart/, '🥧'],
    [/donut|doughnut|sufgani/, '🍩'],
    [/ice cream|sorbet|gelato/, '🍨'],
    [/wine|kiddush/, '🍷'],
    [/juice|lemonade|drink|tea|coffee/, '🥤'],
    [/apple/, '🍎'],
    [/honey/, '🍯'],
    [/cheese|blintz/, '🧀'],
    [/taco|burrito/, '🌮'],
    [/pizza/, '🍕'],
    [/burger/, '🍔'],
    [/curry/, '🍛'],
    [/hummus|dip|tahini/, '🥣'],
    [/carrot|tzimmes/, '🥕'],
    [/broccoli|veg/, '🥦'],
    [/corn/, '🌽'],
    [/pumpkin|squash/, '🎃'],
    [/matzah|matzo/, '🫓'],
  ]
  for (const [re, emoji] of table) if (re.test(n)) return emoji
  const byKind: Record<string, string> = {
    main: '🍽️', side: '🥔', soup: '🍲', salad: '🥗', bread: '🍞',
    dessert: '🍰', drink: '🥤', snack: '🍿', other: '✨',
  }
  return byKind[kind] ?? '🍽️'
}
