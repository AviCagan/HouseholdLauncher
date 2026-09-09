import type { Dish } from '@/data/types'
import { domainOf } from '@/lib/unfurl'
import type { DishInput } from './actions'

/**
 * The "want to try" shelf.
 *
 * A recipe you found and aren't sure about yet is a dish with a tag on it,
 * not a separate table: it already has a name, a link, ingredients when the
 * page gave them up, and the moment it's cooked it becomes an ordinary dish by
 * losing the tag. Everything that lists "my dishes" leaves shelved ones out;
 * the star in the header is where they live.
 */
export const SHELF_TAG = 'want-to-try'

export const isShelved = (dish: Pick<Dish, 'tags'>): boolean => dish.tags.includes(SHELF_TAG)

/** Newest saved first — the one you just found is the one you're thinking about. */
export function shelved(dishes: Dish[]): Dish[] {
  return dishes.filter(isShelved).sort((a, b) => b.created_at.localeCompare(a.created_at))
}

/** Everything that isn't on the shelf. */
export const cookable = (dishes: Dish[]): Dish[] => dishes.filter((d) => !isShelved(d))

/**
 * A shelf entry for a link the reader couldn't get into — a site that blocks
 * bots, a post behind a login. Nothing but the link and a name made from it;
 * the recipe is still on the page, and the point is not to lose the page.
 */
export function linkOnly(url: string): DishInput {
  const domain = domainOf(url)
  return {
    name: `Recipe from ${domain || 'a link'}`,
    emoji: '🔖',
    kind: 'other',
    ingredients: [],
    steps: [],
    servings: 4,
    cost_cents: null,
    nutrition: {},
    nutrition_auto: false,
    source_url: url,
    source_kind: /instagram\.com/i.test(url) ? 'instagram' : 'web',
    image_url: null,
    notes: null,
    tags: [SHELF_TAG],
  }
}
