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

/** What a meal is for when nobody has said. Matches the column default. */
export const DEFAULT_PEOPLE = 4

/**
 * How many times a dish has to be made to feed `people`.
 *
 * Whole batches, rounded up: a recipe that serves four is made three times
 * for twelve, not 2.7 times, because that is what happens in a kitchen — and
 * the leftovers are Shabbat lunch. A dish with no usable servings count is
 * made once and left alone, on the same principle as the cost figures: an
 * unknown is not a thing to multiply.
 */
export function batchesFor(people: number, servings: number): number {
  if (!Number.isFinite(servings) || servings <= 0) return 1
  if (!Number.isFinite(people) || people <= 0) return 1
  return Math.max(1, Math.ceil(people / servings))
}

export interface MealSummary {
  /** The dishes actually in the meal, in course order. Empty slots skipped. */
  dishes: Dish[]
  /** For each entry in `dishes`: how many times it is made for `people`. */
  batches: number[]
  /** The headcount the cost and batches are for. */
  people: number
  /** Slots with nothing in them yet. */
  empty: number
  /** Slots whose dish has since been deleted. */
  orphaned: number
  /** To make the whole meal for `people`: every batch of every priced dish. */
  cost: number | null
  /** How many of the dishes had a cost. */
  costKnown: number
  /** Per plate: one serving of each dish, whatever the headcount. */
  nutrition: NutritionTotals
}

export function summariseMeal(meal: Pick<Meal, 'courses' | 'people'>, allDishes: Dish[]): MealSummary {
  const people = meal.people > 0 ? meal.people : DEFAULT_PEOPLE
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

  const batches = dishes.map((d) => batchesFor(people, d.servings))
  let cost: number | null = null
  let costKnown = 0
  dishes.forEach((d, i) => {
    const c = dishCost(d)
    if (c == null) return
    cost = (cost ?? 0) + c * batches[i]
    costKnown += 1
  })

  return {
    dishes,
    batches,
    people,
    empty,
    orphaned,
    cost,
    costKnown,
    nutrition: sumNutrition(dishes.map((d) => d.nutrition)),
  }
}

// --- scaling amounts ------------------------------------------------------------

const VULGAR: Record<string, number> = {
  '½': 1 / 2, '⅓': 1 / 3, '⅔': 2 / 3, '¼': 1 / 4, '¾': 3 / 4,
  '⅛': 1 / 8, '⅜': 3 / 8, '⅝': 5 / 8, '⅞': 7 / 8,
}
const VULGAR_CHARS = Object.keys(VULGAR).join('')
// Mixed number, then a fraction, then a digit with a vulgar stuck to it, then
// a plain number, then a vulgar on its own. Longest first, or "1/4" reads as 1.
const NUMBER = `(?:\\d+\\s+\\d+\\s*\\/\\s*\\d+|\\d+\\s*\\/\\s*\\d+|\\d+[${VULGAR_CHARS}]|\\d+(?:[.,]\\d+)?|[${VULGAR_CHARS}])`
const LEADING = new RegExp(`^(\\s*)(${NUMBER})(?:(\\s*(?:-|–|to)\\s*)(${NUMBER}))?`)

/** "1 1/2" → 1.5, "1½" → 1.5, "3/4" → 0.75, "2,5" → 2.5. Null if it isn't one. */
export function parseQuantity(token: string): number | null {
  const t = token.trim()
  let m = t.match(/^(\d+)\s+(\d+)\s*\/\s*(\d+)$/)
  if (m) return Number(m[3]) > 0 ? Number(m[1]) + Number(m[2]) / Number(m[3]) : null
  m = t.match(/^(\d+)\s*\/\s*(\d+)$/)
  if (m) return Number(m[2]) > 0 ? Number(m[1]) / Number(m[2]) : null
  m = t.match(new RegExp(`^(\\d+)([${VULGAR_CHARS}])$`))
  if (m) return Number(m[1]) + VULGAR[m[2]]
  if (t.length === 1 && t in VULGAR) return VULGAR[t]
  if (/^\d+(?:[.,]\d+)?$/.test(t)) return Number(t.replace(',', '.'))
  return null
}

/**
 * A number the way a recipe writes it: "1½", "¾", "3", "2.3".
 *
 * Snaps to the nearest kitchen fraction when it is within a hair of one, so
 * ⅓ × 2 comes out as ⅔ and not 0.6667; anything else gets one decimal.
 */
export function formatQuantity(n: number): string {
  if (!Number.isFinite(n)) return ''
  const whole = Math.floor(n)
  const frac = n - whole
  if (frac < 0.02) return String(whole)
  if (frac > 0.98) return String(whole + 1)
  for (const [sym, v] of Object.entries(VULGAR)) {
    if (Math.abs(frac - v) < 0.02) return `${whole || ''}${sym}`
  }
  return String(Math.round(n * 10) / 10)
}

/** Whether an amount starts with a number that can be multiplied. */
export const scalable = (amount: string | null): boolean => !!amount && LEADING.test(amount)

/**
 * The number an amount starts with, and what follows it: "2-3 cups" →
 * { value: 2.5, rest: "cups" } (a range counts as its middle), "400g" →
 * { value: 400, rest: "g" }. Null when it doesn't start with a number.
 */
export function leadingQuantity(amount: string): { value: number; rest: string } | null {
  const m = amount.match(LEADING)
  if (!m) return null
  const first = parseQuantity(m[2])
  if (first == null) return null
  const second = m[4] ? parseQuantity(m[4]) : null
  const value = second != null ? (first + second) / 2 : first
  return { value, rest: amount.slice(m[0].length).trim() }
}

/**
 * "½ tsp" ×3 → "1½ tsp"; "2-3 cloves" ×2 → "4-6 cloves"; "400g" ×2 → "800g".
 *
 * An amount with no number in front — "a pinch", "to taste" — can't be
 * multiplied, so it is marked "×3" and left for the cook to read. So is a
 * missing amount: "×3" on its own says "however much you usually use, three
 * times", which is the truth.
 */
export function scaleAmount(amount: string | null, factor: number): string | null {
  if (factor === 1) return amount
  if (!amount) return `×${factor}`
  const m = amount.match(LEADING)
  const first = m ? parseQuantity(m[2]) : null
  if (!m || first == null) return `${amount} ×${factor}`
  let out = `${m[1]}${formatQuantity(first * factor)}`
  if (m[3] && m[4]) {
    const second = parseQuantity(m[4])
    out += m[3] + (second == null ? m[4] : formatQuantity(second * factor))
  }
  return out + amount.slice(m[0].length)
}

// --- shopping list ------------------------------------------------------------

export interface ShoppingLine {
  name: string
  /** Scaled to the batches, or marked ×N where it couldn't be. */
  amount: string | null
}

export interface ShoppingGroup {
  dish: Dish
  batches: number
  lines: ShoppingLine[]
}

/**
 * Everything to buy for the meal at its headcount, dish by dish.
 *
 * Deliberately not merged across dishes: "2 eggs" and "3 large eggs" are the
 * same thing to a person and not to a string, and a list that says both under
 * their own headings is more use than one that guessed.
 */
export function shoppingList(meal: Pick<Meal, 'courses' | 'people'>, allDishes: Dish[]): ShoppingGroup[] {
  const { dishes, batches } = summariseMeal(meal, allDishes)
  return dishes.map((dish, i) => ({
    dish,
    batches: batches[i],
    lines: dish.ingredients.map((ing) => ({ name: ing.name, amount: scaleAmount(ing.amount, batches[i]) })),
  }))
}

/** "6 lemons", "salt — to taste ×3", "challah ×2", "eggs". */
export function lineText(line: ShoppingLine): string {
  if (!line.amount) return line.name
  if (line.amount.startsWith('×')) return `${line.name} ${line.amount}`
  return scalable(line.amount) ? `${line.amount} ${line.name}` : `${line.name} — ${line.amount}`
}

/** The list as plain text, for pasting into a notes app or a message. */
export function shoppingListText(meal: Pick<Meal, 'name' | 'people'>, groups: ShoppingGroup[]): string {
  const out = [`${meal.name} — shopping for ${meal.people}`]
  for (const g of groups) {
    out.push('', `${g.dish.emoji} ${g.dish.name}${g.batches > 1 ? ` ×${g.batches}` : ''}`)
    if (g.lines.length === 0) out.push('  (no ingredients written down)')
    for (const line of g.lines) out.push(`  • ${lineText(line)}`)
  }
  return out.join('\n')
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
