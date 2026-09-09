// Pure recipe extraction — no Deno, no network. Unit tested from the app.
//
// Two tiers, tried in order:
//
//   1. Structured. Nearly every recipe site embeds a schema.org `Recipe` as
//      JSON-LD, because that is what puts the little recipe card in Google
//      results. When it is there, the ingredients, steps, yield and nutrition
//      come out clean and this file has done almost nothing.
//
//   2. Heuristic. Instagram captions, blog posts that never bothered, a
//      recipe someone typed into Notes and pasted. Lines are sorted into
//      ingredients and steps by what they look like — a quantity at the
//      front is an ingredient, a numbered sentence with a cooking verb is a
//      step — and the result is offered as a draft to correct, not as truth.
//
// Every number this produces is a best effort and the UI says so.

export interface ParsedNutrition {
  calories?: number
  protein_g?: number
  carbs_g?: number
  fat_g?: number
  fiber_g?: number
  sodium_mg?: number
}

export interface ParsedRecipe {
  name: string | null
  image: string | null
  ingredients: string[]
  steps: string[]
  servings: number | null
  nutrition: ParsedNutrition
  /** Where the page was, which the app records against the dish. */
  sourceKind: 'web' | 'instagram'
  /** How much to trust it. 'heuristic' gets a "check this" nudge in the UI. */
  confidence: 'structured' | 'heuristic'
  /** Set when a page had nothing usable at all, so the caller can say why. */
  problem?: 'login-wall' | 'nothing-found'
}

// --- HTML helpers -------------------------------------------------------------

export function decodeEntities(s: string): string {
  return s
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;|&#x27;/g, "'")
    .replace(/&nbsp;/g, ' ')
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(Number.parseInt(n, 16)))
}

/** Pull a meta tag's content by property or name, whichever the page used. */
export function meta(html: string, key: string): string | null {
  const patterns = [
    new RegExp(`<meta[^>]+(?:property|name)=["']${key}["'][^>]+content=["']([^"']*)["']`, 'i'),
    new RegExp(`<meta[^>]+content=["']([^"']*)["'][^>]+(?:property|name)=["']${key}["']`, 'i'),
  ]
  for (const re of patterns) {
    const m = html.match(re)
    if (m?.[1]) return decodeEntities(m[1].trim())
  }
  return null
}

function stripTags(s: string): string {
  return decodeEntities(s.replace(/<[^>]+>/g, ' '))
    .replace(/\s+/g, ' ')
    // "<strong>well</strong>." became "well ." above; close the gap.
    .replace(/\s+([.,;:!?])/g, '$1')
    .trim()
}

// --- JSON-LD ---------------------------------------------------------------------

type Json = Record<string, unknown>

function isRecipeNode(node: unknown): node is Json {
  if (!node || typeof node !== 'object') return false
  const type = (node as Json)['@type']
  const types = Array.isArray(type) ? type : [type]
  return types.some((t) => typeof t === 'string' && t.toLowerCase() === 'recipe')
}

/** Walk every JSON-LD block, including @graph, and return the first Recipe. */
export function findRecipeNode(html: string): Json | null {
  const blocks = html.matchAll(
    /<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi,
  )
  for (const block of blocks) {
    let parsed: unknown
    try {
      parsed = JSON.parse(block[1].trim())
    } catch {
      // Malformed JSON-LD is common; the heuristic tier will have a go.
      continue
    }
    const queue: unknown[] = [parsed]
    while (queue.length) {
      const node = queue.shift()
      if (Array.isArray(node)) {
        queue.push(...node)
        continue
      }
      if (!node || typeof node !== 'object') continue
      if (isRecipeNode(node)) return node
      const graph = (node as Json)['@graph']
      if (Array.isArray(graph)) queue.push(...graph)
      // Some sites nest the recipe under mainEntity / mainEntityOfPage.
      const main = (node as Json).mainEntity
      if (main) queue.push(main)
    }
  }
  return null
}

function asText(v: unknown): string | null {
  if (typeof v === 'string') return stripTags(v) || null
  if (v && typeof v === 'object') {
    const o = v as Json
    if (typeof o.text === 'string') return stripTags(o.text) || null
    if (typeof o.name === 'string') return stripTags(o.name) || null
  }
  return null
}

/**
 * recipeInstructions is the least consistent field in the schema: a string,
 * an array of strings, an array of HowToStep, or HowToSections each holding
 * their own steps. All four flatten to a list of sentences.
 */
export function flattenInstructions(v: unknown): string[] {
  if (v == null) return []
  if (typeof v === 'string') {
    // One blob: split on newlines, on numbered markers, and on sentence
    // boundaries — a period followed by a capital or a digit. "1.5 cups" is
    // safe because the split needs whitespace after the period.
    return stripTags(v)
      .split(/\r?\n|(?<=[.!?])\s+(?=[A-Z0-9])/)
      .map((s) => s.replace(/^\d+[.)]\s*/, '').trim())
      .filter((s) => s.length > 2)
  }
  if (Array.isArray(v)) return v.flatMap(flattenInstructions)
  if (typeof v === 'object') {
    const o = v as Json
    if (Array.isArray(o.itemListElement)) return flattenInstructions(o.itemListElement)
    const t = asText(o)
    return t ? [t] : []
  }
  return []
}

/** "4 servings", ["4", "4 servings"], 4, "Makes 12 muffins" → 4, 4, 4, 12. */
export function parseYield(v: unknown): number | null {
  const candidates = Array.isArray(v) ? v : [v]
  for (const c of candidates) {
    const text = typeof c === 'number' ? String(c) : typeof c === 'string' ? c : ''
    const m = text.match(/(\d+)/)
    if (m) {
      const n = Number(m[1])
      if (n > 0 && n < 1000) return n
    }
  }
  return null
}

/** "250 calories" → 250, "12 g" → 12, "1.5g" → 1.5, "300 mg" → 300. */
export function parseAmount(v: unknown): number | undefined {
  if (typeof v === 'number') return Number.isFinite(v) ? v : undefined
  if (typeof v !== 'string') return undefined
  const m = v.replace(',', '.').match(/(\d+(?:\.\d+)?)/)
  if (!m) return undefined
  const n = Number(m[1])
  return Number.isFinite(n) ? n : undefined
}

export function parseNutrition(v: unknown): ParsedNutrition {
  if (!v || typeof v !== 'object') return {}
  const o = v as Json
  const out: ParsedNutrition = {}
  const put = (key: keyof ParsedNutrition, raw: unknown) => {
    const n = parseAmount(raw)
    if (n !== undefined) out[key] = n
  }
  put('calories', o.calories)
  put('protein_g', o.proteinContent)
  put('carbs_g', o.carbohydrateContent)
  put('fat_g', o.fatContent)
  put('fiber_g', o.fiberContent)
  put('sodium_mg', o.sodiumContent)
  return out
}

function firstImage(v: unknown): string | null {
  if (typeof v === 'string') return v
  if (Array.isArray(v)) return firstImage(v[0])
  if (v && typeof v === 'object') {
    const o = v as Json
    if (typeof o.url === 'string') return o.url
    if (typeof o.contentUrl === 'string') return o.contentUrl
  }
  return null
}

// --- Heuristics ---------------------------------------------------------------------

const UNITS =
  'cups?|c\\.|tbsps?|tablespoons?|tsps?|teaspoons?|g|grams?|kg|kilos?|oz|ounces?|lbs?|pounds?|ml|l|litres?|liters?|cloves?|cans?|tins?|bunch(?:es)?|pinch(?:es)?|handfuls?|slices?|pieces?|sticks?|sprigs?|packages?|packets?|pkgs?|jars?|bottles?|heads?|stalks?|leaves|large|medium|small|whole|dash(?:es)?|drops?|scoops?|quarts?|pints?|gallons?|inch|"'

// Ordered longest-first on purpose: alternation takes the first branch that
// matches, so with the plain integer ahead of the fraction "1/4 cup" splits
// as "1" and "/4 cup of honey".
const QUANTITY =
  '(?:\\d+\\s+\\d+\\s*\\/\\s*\\d+|\\d+\\s*\\/\\s*\\d+|\\d+[½¼¾⅓⅔⅛⅜⅝⅞]|\\d+(?:[.,]\\d+)?|[½¼¾⅓⅔⅛⅜⅝⅞])(?:\\s*(?:-|–|to)\\s*(?:\\d+(?:[.,]\\d+)?|[½¼¾⅓⅔⅛⅜⅝⅞]))?'

const INGREDIENT_START = new RegExp(`^(?:${QUANTITY})\\s*(?:(?:${UNITS})\\b\\.?)?\\s*(?:of\\s+)?`, 'i')
const INGREDIENT_WORDY = new RegExp(`^(?:a|an|one|two|three|four|half|some)\\s+(?:${UNITS})\\b`, 'i')
const TO_TASTE = /\b(?:to taste|as needed|for (?:serving|garnish|frying|greasing))\b/i

const COOKING_VERB =
  /\b(?:preheat|mix|stir|whisk|fold|beat|combine|add|pour|bake|roast|cook|heat|fry|boil|simmer|saut[ée]|sear|grill|chop|dice|slice|mince|grate|peel|season|drain|rinse|blend|transfer|place|put|spread|roll|knead|rest|cool|chill|refrigerate|freeze|serve|garnish|top|cover|remove|let|allow|reduce|bring|toss|marinate|melt|brown|caramelise|caramelize|assemble|layer|divide|shape|form|press|flip|turn|sprinkle|drizzle|squeeze|mash|puree|purée|strain|set aside|repeat|enjoy)\b/i

const SECTION_INGREDIENTS = /^\W*(?:ingredients?|what you(?:'|’)?ll need|you(?:'|’)?ll need|shopping list)\W*$/i
const SECTION_STEPS = /^\W*(?:instructions?|directions?|method|steps?|how to(?: make it)?|to make|preparation|recipe)\W*$/i
const NOISE = /(?:^#|\b(?:link in bio|follow (?:me|us|for)|save this|tag (?:a|someone)|recipe below|full recipe|comment ["']?\w+["']?\s*(?:for|to)|dm me|swipe|click the link)\b)/i

/** Strip bullets, emoji markers, numbering and trailing punctuation. */
function cleanLine(line: string): string {
  return line
    .replace(/^[\s\-–—•*·▪️◦●◽🔸🔹✔️✅➡️👉🥣🍽️]+/u, '')
    .replace(/^\p{Extended_Pictographic}️?\s*/u, '')
    .replace(/^(?:step\s*)?\d+\s*[.):-]\s*/i, '')
    .replace(/\s+/g, ' ')
    .trim()
}

export function looksLikeIngredient(line: string): boolean {
  if (line.length > 90) return false
  return INGREDIENT_START.test(line) || INGREDIENT_WORDY.test(line) || TO_TASTE.test(line)
}

export function looksLikeStep(line: string): boolean {
  if (line.length < 12) return false
  return COOKING_VERB.test(line)
}

/**
 * Sort free text into ingredients and steps.
 *
 * Headed sections win when present. Without them, each line is judged on
 * its own — which is what an Instagram caption needs, since those rarely say
 * "Ingredients:" and often interleave the two.
 */
export function parseRecipeText(text: string): {
  name: string | null
  ingredients: string[]
  steps: string[]
} {
  const raw = text
    .split(/\r?\n/)
    .map(cleanLine)
    .filter((l) => l.length > 0 && !NOISE.test(l))

  const ingredients: string[] = []
  const steps: string[] = []
  let mode: 'ingredients' | 'steps' | null = null
  let name: string | null = null

  for (const line of raw) {
    if (SECTION_INGREDIENTS.test(line)) {
      mode = 'ingredients'
      continue
    }
    if (SECTION_STEPS.test(line)) {
      mode = 'steps'
      continue
    }

    if (mode === 'ingredients') {
      ingredients.push(line)
      continue
    }
    if (mode === 'steps') {
      steps.push(line)
      continue
    }

    // No section yet: judge the line on its own shape.
    if (looksLikeIngredient(line)) {
      ingredients.push(line)
    } else if (looksLikeStep(line)) {
      steps.push(line)
    } else if (!name && line.length <= 60 && ingredients.length === 0 && steps.length === 0) {
      // A short line before anything recognisable is the title.
      name = line.replace(/[!.:]+$/, '')
    }
  }

  return { name, ingredients, steps }
}

/**
 * "2 cups flour" → { amount: "2 cups", name: "flour" }.
 * "Salt to taste" → { amount: null, name: "Salt to taste" }.
 *
 * Only the leading quantity-and-unit is split off; everything after it stays
 * as the name, including "finely chopped". Nobody needs that normalised.
 */
export function splitIngredient(line: string): { amount: string | null; name: string } {
  const m = line.match(INGREDIENT_START)
  if (m && m[0].trim().length > 0 && m[0].length < line.length) {
    return {
      amount: m[0].replace(/\s+of\s*$/i, '').trim(),
      name: line.slice(m[0].length).replace(/^of\s+/i, '').trim(),
    }
  }
  return { amount: null, name: line.trim() }
}

// --- Entry points ---------------------------------------------------------------------

export function isInstagram(url: string): boolean {
  try {
    return /(^|\.)instagram\.com$/i.test(new URL(url).hostname)
  } catch {
    return false
  }
}

/**
 * Instagram's og:title reads `Account on Instagram: "the first bit of the
 * caption…"`, and og:description is the caption itself (when the page is
 * served at all — a login wall serves neither).
 */
function instagramCaption(html: string): { author: string | null; caption: string | null } {
  const title = meta(html, 'og:title') ?? ''
  const author = title.match(/^(.+?) on Instagram/i)?.[1]?.trim() ?? null
  const description = meta(html, 'og:description')
  return { author, caption: description }
}

export function parseRecipeHtml(html: string, url: string): ParsedRecipe {
  const instagram = isInstagram(url)
  const sourceKind = instagram ? 'instagram' : 'web'

  const node = findRecipeNode(html)
  if (node) {
    const ingredients = (Array.isArray(node.recipeIngredient) ? node.recipeIngredient : [])
      .map((i) => (typeof i === 'string' ? stripTags(i) : ''))
      .filter(Boolean)
    const steps = flattenInstructions(node.recipeInstructions)
    if (ingredients.length > 0 || steps.length > 0) {
      return {
        name: asText(node.name) ?? meta(html, 'og:title'),
        image: firstImage(node.image) ?? meta(html, 'og:image'),
        ingredients,
        steps,
        servings: parseYield(node.recipeYield),
        nutrition: parseNutrition(node.nutrition),
        sourceKind,
        confidence: 'structured',
      }
    }
  }

  // Heuristic tier: whatever text the page gave us.
  let text: string | null = null
  let name: string | null = null
  if (instagram) {
    const { author, caption } = instagramCaption(html)
    if (!caption) {
      return {
        name: null,
        image: null,
        ingredients: [],
        steps: [],
        servings: null,
        nutrition: {},
        sourceKind,
        confidence: 'heuristic',
        problem: 'login-wall',
      }
    }
    text = caption
    name = author ? `From ${author}` : null
  } else {
    text = meta(html, 'og:description') ?? meta(html, 'description')
    name = meta(html, 'og:title')
  }

  const parsed = parseRecipeText(text ?? '')
  const nothing = parsed.ingredients.length === 0 && parsed.steps.length === 0
  return {
    name: parsed.name ?? name,
    image: meta(html, 'og:image'),
    ingredients: parsed.ingredients,
    steps: parsed.steps,
    servings: null,
    nutrition: {},
    sourceKind,
    confidence: 'heuristic',
    ...(nothing ? { problem: 'nothing-found' as const } : {}),
  }
}
