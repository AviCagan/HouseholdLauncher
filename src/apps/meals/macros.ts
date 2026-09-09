import type { Ingredient, Nutrition } from '@/data/types'
import { FOODS, type Food } from './foods'
import { leadingQuantity } from './nutrition'

/**
 * From "2 cups flour" to calories.
 *
 * Three steps, each of which can fail on its own and says so: find the food
 * ("flour" → all-purpose flour), turn the amount into grams (2 cups × 125 g),
 * and multiply out the per-100 g figures. A line that fails is reported as
 * unknown — food not in the pantry, or an amount with no weight to it — and
 * left out of the sum, never counted as zero. The dish then says "from 5 of
 * 7 ingredients", which is the honest number.
 */

// --- finding the food ------------------------------------------------------------

/** Words a recipe puts around an ingredient that say nothing about what it is. */
const NOISE = new RegExp(
  '\\b(?:fresh|freshly|chopped|finely|roughly|coarsely|thinly|thickly|diced|minced|sliced|grated|shredded|crushed|' +
    'peeled|seeded|deseeded|pitted|halved|quartered|cubed|julienned|trimmed|washed|rinsed|drained|melted|softened|' +
    'cold|warm|hot|room temperature|at room temperature|ripe|large|medium|small|big|extra|whole|raw|cooked|' +
    'organic|free-range|free range|good quality|good-quality|best quality|packed|sifted|beaten|lightly beaten|' +
    'to taste|as needed|optional|divided|plus more|plus extra|for serving|for garnish|for the pan|for frying|' +
    'for greasing|for drizzling|or so|about|approximately|approx\\.?|roughly|a little|some|of|the|a|an)\\b',
  'g',
)

export function normaliseFoodName(raw: string): string {
  let s = raw.toLowerCase()
  s = s.replace(/\([^)]*\)/g, ' ') // "(about 2 lbs)"
  s = s.replace(/,.*$/, ' ') // "flour, sifted"
  s = s.replace(NOISE, ' ')
  s = s.replace(/[^a-z0-9%'’\- ]/g, ' ')
  s = s.replace(/\s+/g, ' ').trim()
  return s
}

const singular = (w: string): string => {
  if (w.length <= 3) return w
  if (/ies$/.test(w)) return w.slice(0, -3) + 'y'
  if (/(?:oes|ches|shes|sses|xes)$/.test(w)) return w.slice(0, -2)
  if (/ss$/.test(w)) return w
  if (/s$/.test(w)) return w.slice(0, -1)
  return w
}

/** "tomatoes" → "tomato", word by word, so a plural still matches. */
const singularise = (s: string): string => s.split(' ').map(singular).join(' ')

interface Entry {
  name: string
  food: Food
}

/** Every name, longest first, so "chicken breast" wins over "chicken". */
const INDEX: Entry[] = FOODS.flatMap((food) => food.names.map((name) => ({ name: name.toLowerCase(), food }))).sort(
  (a, b) => b.name.length - a.name.length,
)
const EXACT = new Map<string, Food>()
for (const e of INDEX) {
  if (!EXACT.has(e.name)) EXACT.set(e.name, e.food)
  const sing = singularise(e.name)
  if (!EXACT.has(sing)) EXACT.set(sing, e.food)
}

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

/** The pantry entry for an ingredient name, or null. */
export function findFood(raw: string): Food | null {
  const cleaned = normaliseFoodName(raw)
  if (!cleaned) return null
  const exact = EXACT.get(cleaned) ?? EXACT.get(singularise(cleaned))
  if (exact) return exact
  // Longest name that appears as whole words: "boneless chicken thighs" →
  // "chicken thigh". Whole words, so "egg" never matches inside "eggplant".
  const sing = singularise(cleaned)
  for (const e of INDEX) {
    const name = singularise(e.name)
    if (name.length < 3) continue
    const re = new RegExp(`(?:^|\\s)${escapeRe(name)}(?:\\s|$)`)
    if (re.test(sing) || re.test(cleaned)) return e.food
  }
  return null
}

// --- turning an amount into grams -------------------------------------------------

const ML_PER_CUP = 236.6

type Unit =
  | { kind: 'mass'; grams: number }
  | { kind: 'volume'; ml: number }
  | { kind: 'each'; name?: keyof NonNullable<Food['units']>; fallback?: number }

const UNITS: [RegExp, Unit][] = [
  [/^(?:kg|kilos?|kilograms?)\b/, { kind: 'mass', grams: 1000 }],
  [/^(?:g|gr|grams?|gm)\b/, { kind: 'mass', grams: 1 }],
  [/^(?:lbs?|pounds?)\b/, { kind: 'mass', grams: 453.6 }],
  [/^(?:fl\.? ?oz|fluid ounces?)\b/, { kind: 'volume', ml: 29.57 }],
  [/^(?:oz|ounces?)\b/, { kind: 'mass', grams: 28.35 }],
  [/^(?:ml|millilit(?:er|re)s?|cc)\b/, { kind: 'volume', ml: 1 }],
  [/^(?:l|lit(?:er|re)s?)\b/, { kind: 'volume', ml: 1000 }],
  [/^(?:cups?|c)\b/, { kind: 'volume', ml: ML_PER_CUP }],
  [/^(?:tbsps?|tbs|tablespoons?|tbl|T)\b/, { kind: 'volume', ml: 14.79 }],
  [/^(?:tsps?|teaspoons?|t)\b/, { kind: 'volume', ml: 4.93 }],
  [/^(?:pinch(?:es)?)\b/, { kind: 'each', fallback: 0.3 }],
  [/^(?:dash(?:es)?|drops?|splash(?:es)?)\b/, { kind: 'each', fallback: 0.6 }],
  [/^(?:handfuls?)\b/, { kind: 'each', fallback: 30 }],
  [/^(?:cloves?)\b/, { kind: 'each', name: 'clove', fallback: 3 }],
  [/^(?:slices?)\b/, { kind: 'each', name: 'slice', fallback: 25 }],
  [/^(?:sticks?)\b/, { kind: 'each', name: 'stick', fallback: 113 }],
  [/^(?:cans?|tins?|jars?)\b/, { kind: 'each', name: 'can', fallback: 400 }],
  [/^(?:packets?|sachets?|envelopes?|packages?|pkgs?|bags?|boxes?)\b/, { kind: 'each', name: 'packet', fallback: 250 }],
  [/^(?:bunch(?:es)?)\b/, { kind: 'each', name: 'bunch', fallback: 100 }],
  [/^(?:heads?)\b/, { kind: 'each', name: 'head', fallback: 500 }],
  [/^(?:sheets?)\b/, { kind: 'each', name: 'sheet', fallback: 30 }],
  [/^(?:stalks?|ribs?)\b/, { kind: 'each', name: 'stalk', fallback: 40 }],
  [/^(?:sprigs?)\b/, { kind: 'each', name: 'sprig', fallback: 1 }],
  [/^(?:leaves|leaf)\b/, { kind: 'each', name: 'leaf', fallback: 0.5 }],
  [/^(?:ears?)\b/, { kind: 'each', name: 'ear', fallback: 90 }],
  [/^(?:fillets?|filets?)\b/, { kind: 'each', name: 'fillet', fallback: 150 }],
  [/^(?:pieces?|chunks?|knobs?|pats?)\b/, { kind: 'each', name: 'piece', fallback: 30 }],
  [/^(?:large|medium|small|whole)\b/, { kind: 'each' }],
]

/** "1 (400g) can" — a bracketed weight beats any unit maths. */
const BRACKETED = /\((\d+(?:[.,]\d+)?)\s*(g|kg|ml|l|oz|lb|lbs)\)/i

export interface Gramage {
  grams: number
  /** How the number was reached, for the "≈" in the UI. */
  how: 'weight' | 'volume' | 'each'
}

/**
 * Grams for an amount of a food, or null with the reason.
 *
 * "2 cups" needs a cup weight (or is taken as water-dense); "3" needs a
 * per-piece weight; "400g" needs nothing. An amount that is words alone —
 * "to taste", "a pinch" — gets the pinch treatment where it says so, and is
 * otherwise unknown.
 */
export function gramsFor(amount: string | null, food: Food): Gramage | { reason: 'no-amount' | 'no-weight' } {
  const text = (amount ?? '').trim()
  const bracket = text.match(BRACKETED)
  const q = text ? leadingQuantity(text) : null
  const count = q?.value ?? (text ? null : 1)

  if (bracket) {
    const n = Number(bracket[1].replace(',', '.'))
    const unit = bracket[2].toLowerCase()
    const grams = unit === 'kg' ? n * 1000 : unit === 'oz' ? n * 28.35 : unit === 'lb' || unit === 'lbs' ? n * 453.6 : unit === 'l' ? n * 1000 : n
    return { grams: grams * (count ?? 1), how: 'weight' }
  }

  if (count == null) {
    // No number in front: "a pinch", "to taste", "a handful".
    const lower = text.toLowerCase()
    if (/pinch/.test(lower)) return { grams: 0.3, how: 'each' }
    if (/dash|drop|splash/.test(lower)) return { grams: 0.6, how: 'each' }
    if (/handful/.test(lower)) return { grams: 30, how: 'each' }
    if (/to taste|as needed|for serving|for garnish/.test(lower)) return { grams: 0, how: 'each' }
    return { reason: 'no-amount' }
  }

  const rest = (q?.rest ?? '').toLowerCase().replace(/^of\s+/, '')
  let unit: Unit = { kind: 'each' }
  for (const [re, u] of UNITS) {
    if (re.test(rest)) {
      unit = u
      break
    }
  }

  if (unit.kind === 'mass') return { grams: count * unit.grams, how: 'weight' }
  if (unit.kind === 'volume') {
    const perCup = food.cup ?? ML_PER_CUP
    return { grams: (count * unit.ml * perCup) / ML_PER_CUP, how: 'volume' }
  }
  const named = unit.name ? food.units?.[unit.name] : undefined
  const each = named ?? (unit.name ? unit.fallback : food.each) ?? (unit.name ? undefined : food.each)
  if (each == null) return { reason: 'no-weight' }
  return { grams: count * each, how: 'each' }
}

// --- the sums --------------------------------------------------------------------------

export interface LineMacros {
  ingredient: Ingredient
  food: string
  grams: number
  how: Gramage['how']
  nutrition: Record<keyof Nutrition, number>
}

export interface LineUnknown {
  ingredient: Ingredient
  reason: 'no-food' | 'no-amount' | 'no-weight'
}

export function lineMacros(ingredient: Ingredient): LineMacros | LineUnknown {
  const food = findFood(ingredient.name)
  if (!food) return { ingredient, reason: 'no-food' }
  const g = gramsFor(ingredient.amount, food)
  if ('reason' in g) return { ingredient, reason: g.reason }
  const k = g.grams / 100
  const [kcal, protein, carbs, fat, fibre, sodium] = food.n
  return {
    ingredient,
    food: food.names[0],
    grams: g.grams,
    how: g.how,
    nutrition: {
      calories: kcal * k,
      protein_g: protein * k,
      carbs_g: carbs * k,
      fat_g: fat * k,
      fiber_g: fibre * k,
      sodium_mg: sodium * k,
    },
  }
}

export interface DishMacros {
  /** Per serving, rounded the way a label would. Empty when nothing matched. */
  perServing: Nutrition
  /** For the whole dish. */
  total: Nutrition
  known: LineMacros[]
  unknown: LineUnknown[]
}

export const isUnknown = (l: LineMacros | LineUnknown): l is LineUnknown => 'reason' in l

/**
 * A dish's nutrition worked out from what goes in it, per serving.
 *
 * Blank lines are ignored, not counted as unknown — an empty row in the
 * editor is not an ingredient nobody could place.
 */
export function dishMacros(ingredients: Ingredient[], servings: number): DishMacros {
  const lines = ingredients.filter((i) => i.name.trim()).map(lineMacros)
  const known = lines.filter((l): l is LineMacros => !isUnknown(l))
  const unknown = lines.filter(isUnknown)
  const total: Nutrition = {}
  if (known.length > 0) {
    for (const key of ['calories', 'protein_g', 'carbs_g', 'fat_g', 'fiber_g', 'sodium_mg'] as const) {
      total[key] = known.reduce((sum, l) => sum + l.nutrition[key], 0)
    }
  }
  const per = Math.max(1, servings)
  const perServing: Nutrition = {}
  for (const [key, value] of Object.entries(total) as [keyof Nutrition, number | null | undefined][]) {
    if (value == null) continue
    perServing[key] = Math.round((value / per) * 10) / 10
  }
  return { perServing, total, known, unknown }
}

export const UNKNOWN_REASON: Record<LineUnknown['reason'], string> = {
  'no-food': 'not in the pantry',
  'no-amount': 'needs an amount',
  'no-weight': 'needs a weight or a unit',
}
