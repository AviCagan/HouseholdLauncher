import { describe, expect, it } from 'vitest'
import {
  flattenInstructions,
  looksLikeIngredient,
  looksLikeStep,
  parseNutrition,
  parseRecipeHtml,
  parseRecipeText,
  parseYield,
  splitIngredient,
} from '../../supabase/functions/recipe/parse'
import { isPrivateAddress } from '../../supabase/functions/_shared/net'

/**
 * The recipe importer's parser, tested from the app's suite.
 *
 * parse.ts is pure — no Deno, no fetch — precisely so this file can import it
 * directly rather than extracting functions from source text the way the
 * unfurl test has to. The pages here are cut down to the parts that matter,
 * but the shapes are real: the JSON-LD forms are the ones recipe sites
 * actually emit, and the caption is what an Instagram post looks like once
 * its og:description has been read.
 */

const jsonLd = (obj: unknown) =>
  `<html><head><script type="application/ld+json">${JSON.stringify(obj)}</script></head><body></body></html>`

describe('structured recipes (JSON-LD)', () => {
  it('reads a plain Recipe node', () => {
    const html = jsonLd({
      '@context': 'https://schema.org',
      '@type': 'Recipe',
      name: 'Classic Challah',
      image: ['https://x/img.jpg'],
      recipeYield: '2 loaves',
      recipeIngredient: ['4 cups bread flour', '2 large eggs', '1/4 cup honey'],
      recipeInstructions: [
        { '@type': 'HowToStep', text: 'Mix the dough.' },
        { '@type': 'HowToStep', text: 'Braid and bake.' },
      ],
      nutrition: {
        '@type': 'NutritionInformation',
        calories: '210 calories',
        proteinContent: '6 g',
        carbohydrateContent: '38 g',
        fatContent: '4.5 g',
        sodiumContent: '180 mg',
      },
    })
    const r = parseRecipeHtml(html, 'https://food.example.com/challah')
    expect(r.confidence).toBe('structured')
    expect(r.name).toBe('Classic Challah')
    expect(r.image).toBe('https://x/img.jpg')
    expect(r.servings).toBe(2)
    expect(r.ingredients).toHaveLength(3)
    expect(r.steps).toEqual(['Mix the dough.', 'Braid and bake.'])
    expect(r.nutrition).toEqual({ calories: 210, protein_g: 6, carbs_g: 38, fat_g: 4.5, sodium_mg: 180 })
    expect(r.sourceKind).toBe('web')
  })

  it('finds the Recipe inside an @graph, which is how WordPress recipe plugins emit it', () => {
    const html = jsonLd({
      '@context': 'https://schema.org',
      '@graph': [
        { '@type': 'WebPage', name: 'Blog' },
        { '@type': ['Recipe', 'Thing'], name: 'Latkes', recipeIngredient: ['3 potatoes'], recipeInstructions: 'Grate. Fry.' },
      ],
    })
    const r = parseRecipeHtml(html, 'https://blog.example.com/latkes')
    expect(r.name).toBe('Latkes')
    expect(r.ingredients).toEqual(['3 potatoes'])
    expect(r.steps).toEqual(['Grate.', 'Fry.'])
  })

  it('flattens HowToSections into one list of steps', () => {
    const steps = flattenInstructions([
      {
        '@type': 'HowToSection',
        name: 'Dough',
        itemListElement: [{ '@type': 'HowToStep', text: 'Knead.' }, { '@type': 'HowToStep', text: 'Rest.' }],
      },
      { '@type': 'HowToSection', name: 'Bake', itemListElement: [{ '@type': 'HowToStep', text: 'Bake at 180.' }] },
    ])
    expect(steps).toEqual(['Knead.', 'Rest.', 'Bake at 180.'])
  })

  it('strips markup left inside step text', () => {
    expect(flattenInstructions([{ text: 'Whisk <strong>well</strong>.&nbsp;' }])).toEqual(['Whisk well.'])
  })

  it('reads yield in the forms sites use', () => {
    expect(parseYield('4 servings')).toBe(4)
    expect(parseYield(['12', '12 muffins'])).toBe(12)
    expect(parseYield(6)).toBe(6)
    expect(parseYield('Serves a crowd')).toBeNull()
  })

  it('ignores an empty Recipe node and falls through to the page text', () => {
    const html =
      jsonLd({ '@type': 'Recipe', name: 'Nothing' }).replace('</head>', '<meta property="og:description" content="2 cups flour&#10;Mix it."></head>')
    const r = parseRecipeHtml(html, 'https://x.example.com')
    expect(r.confidence).toBe('heuristic')
  })

  it('parses nutrition amounts with units attached', () => {
    expect(parseNutrition({ calories: 250, fiberContent: '3g' })).toEqual({ calories: 250, fiber_g: 3 })
    expect(parseNutrition(null)).toEqual({})
  })
})

describe('caption heuristics', () => {
  it('sorts an Instagram-style caption into ingredients and steps', () => {
    const caption = [
      'THE BEST SHAKSHUKA 🍳',
      'Save this for Sunday!',
      '',
      '2 tbsp olive oil',
      '1 onion, diced',
      '4 cloves garlic',
      '1 can crushed tomatoes',
      '4 eggs',
      'Salt to taste',
      '',
      '1. Heat the oil and soften the onion.',
      '2. Add garlic and tomatoes, simmer 10 min.',
      '3. Crack in the eggs, cover, cook until set.',
      '',
      '#shakshuka #brunch',
      'Follow for more easy dinners!',
    ].join('\n')

    const r = parseRecipeText(caption)
    expect(r.name).toBe('THE BEST SHAKSHUKA 🍳')
    expect(r.ingredients).toEqual([
      '2 tbsp olive oil',
      '1 onion, diced',
      '4 cloves garlic',
      '1 can crushed tomatoes',
      '4 eggs',
      'Salt to taste',
    ])
    expect(r.steps).toEqual([
      'Heat the oil and soften the onion.',
      'Add garlic and tomatoes, simmer 10 min.',
      'Crack in the eggs, cover, cook until set.',
    ])
  })

  it('honours Ingredients / Method headings when present', () => {
    const r = parseRecipeText('Ingredients:\nflour\neggs\nMethod:\nCombine everything and bake.')
    expect(r.ingredients).toEqual(['flour', 'eggs'])
    expect(r.steps).toEqual(['Combine everything and bake.'])
  })

  it('strips bullets, emoji markers and numbering', () => {
    const r = parseRecipeText('• 1 cup sugar\n🥕 2 carrots\n- ½ tsp salt\nStep 1: Mix everything together.')
    expect(r.ingredients).toEqual(['1 cup sugar', '2 carrots', '½ tsp salt'])
    expect(r.steps).toEqual(['Mix everything together.'])
  })

  it('knows the shapes of ingredients and steps', () => {
    expect(looksLikeIngredient('1 1/2 cups milk')).toBe(true)
    expect(looksLikeIngredient('a pinch of saffron')).toBe(true)
    expect(looksLikeIngredient('Black pepper, to taste')).toBe(true)
    expect(looksLikeIngredient('Preheat the oven to 200C and line a tray.')).toBe(false)
    expect(looksLikeStep('Preheat the oven to 200C and line a tray.')).toBe(true)
    expect(looksLikeStep('flour')).toBe(false)
  })

  it('splits amount from name, and leaves lines with no quantity whole', () => {
    expect(splitIngredient('2 cups flour')).toEqual({ amount: '2 cups', name: 'flour' })
    expect(splitIngredient('1/4 cup of honey')).toEqual({ amount: '1/4 cup', name: 'honey' })
    expect(splitIngredient('3 large eggs')).toEqual({ amount: '3 large', name: 'eggs' })
    expect(splitIngredient('Salt to taste')).toEqual({ amount: null, name: 'Salt to taste' })
    expect(splitIngredient('½ tsp cinnamon')).toEqual({ amount: '½ tsp', name: 'cinnamon' })
  })
})

describe('Instagram pages', () => {
  const page = (title: string, description: string | null) =>
    `<html><head><meta property="og:title" content="${title}">${
      description ? `<meta property="og:description" content="${description}">` : ''
    }<meta property="og:image" content="https://ig/img.jpg"></head></html>`

  it('reads the caption out of og:description and the account out of og:title', () => {
    const html = page(
      'Jackie Cooks on Instagram: &quot;Easiest challah&quot;',
      'Easiest challah&#10;4 cups flour&#10;2 eggs&#10;Mix, braid, bake at 180 for 30 minutes.',
    )
    const r = parseRecipeHtml(html, 'https://www.instagram.com/p/abc123/')
    expect(r.sourceKind).toBe('instagram')
    expect(r.confidence).toBe('heuristic')
    expect(r.name).toBe('Easiest challah')
    expect(r.ingredients).toEqual(['4 cups flour', '2 eggs'])
    expect(r.steps).toEqual(['Mix, braid, bake at 180 for 30 minutes.'])
    expect(r.image).toBe('https://ig/img.jpg')
  })

  it('reports a login wall rather than an empty recipe', () => {
    const r = parseRecipeHtml(page('Instagram', null), 'https://instagram.com/reel/xyz/')
    expect(r.problem).toBe('login-wall')
    expect(r.ingredients).toEqual([])
  })
})

describe('address filter shared with unfurl', () => {
  it('blocks private and metadata addresses and allows public hosts', () => {
    expect(isPrivateAddress('169.254.169.254')).toBe(true)
    expect(isPrivateAddress('10.0.0.5')).toBe(true)
    expect(isPrivateAddress('localhost')).toBe(true)
    expect(isPrivateAddress('metadata.google.internal')).toBe(true)
    expect(isPrivateAddress('www.instagram.com')).toBe(false)
    expect(isPrivateAddress('smittenkitchen.com')).toBe(false)
  })
})
