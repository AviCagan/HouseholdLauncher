import { describe, expect, it } from 'vitest'
import type { Dish } from '@/data/types'
import { SHELF_TAG, cookable, isShelved, linkOnly, shelved } from './shelf'

const dish = (id: string, tags: string[], created_at: string): Dish => ({
  id, name: id, emoji: '🍽️', kind: 'main', ingredients: [], steps: [], servings: 4, cost_cents: null,
  nutrition: {}, source_url: null, source_kind: 'manual', image_url: null, notes: null, tags,
  created_by: null, updated_by: null, created_at, updated_at: created_at,
})

describe('the shelf', () => {
  const a = dish('a', [SHELF_TAG], '2026-09-01T00:00:00.000Z')
  const b = dish('b', [], '2026-09-02T00:00:00.000Z')
  const c = dish('c', ['x', SHELF_TAG], '2026-09-03T00:00:00.000Z')

  it('separates shelved dishes from cookable ones, newest saved first', () => {
    expect(isShelved(a)).toBe(true)
    expect(isShelved(b)).toBe(false)
    expect(shelved([a, b, c]).map((d) => d.id)).toEqual(['c', 'a'])
    expect(cookable([a, b, c]).map((d) => d.id)).toEqual(['b'])
  })

  it('makes a link-only entry that keeps the page and says where it came from', () => {
    const d = linkOnly('https://www.bbcgoodfood.com/recipes/challah')
    expect(d.name).toBe('Recipe from bbcgoodfood.com')
    expect(d.source_url).toBe('https://www.bbcgoodfood.com/recipes/challah')
    expect(d.source_kind).toBe('web')
    expect(d.tags).toEqual([SHELF_TAG])
    expect(linkOnly('https://www.instagram.com/p/abc/').source_kind).toBe('instagram')
  })
})
