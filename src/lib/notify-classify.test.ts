import { describe, expect, it } from 'vitest'
import { classify, URGENT_LEVEL } from '../../supabase/functions/notify/classify'
import { URGENCY } from '@/data/types'

/**
 * Tests the exact module the Edge Function ships, imported directly rather
 * than duplicated — a regression here already happened once: urgency was cut
 * from four levels to three (0-3 → 0-2) and this file's threshold was left at
 * the old top value, so `urgent_added` could never fire again. Nothing looked
 * broken because `any_added` covered every insert regardless, which is
 * exactly the kind of gap that survives casual testing and only shows up as
 * "notifications aren't working" days later.
 */

describe('URGENT_LEVEL', () => {
  it('tracks the app-wide urgency scale, not a hardcoded copy of it', () => {
    expect(URGENT_LEVEL).toBe(URGENCY.URGENT)
  })
})

describe('classify: inserts', () => {
  it('is any_added below the top urgency level', () => {
    for (const urgency of [0, 1]) {
      const c = classify({
        type: 'INSERT',
        table: 'todos',
        record: { id: '1', title: 'Milk', urgency, created_by: 'avi' },
        old_record: null,
      })
      expect(c?.event).toBe('any_added')
    }
  })

  it('is urgent_added at the top urgency level', () => {
    const c = classify({
      type: 'INSERT',
      table: 'todos',
      record: { id: '1', title: 'Milk', urgency: URGENCY.URGENT, created_by: 'avi' },
      old_record: null,
    })
    expect(c?.event).toBe('urgent_added')
  })

  it('never emits both events for one insert', () => {
    // any_added subsumes urgent_added by design — classify must resolve to
    // exactly one, or the recipient gets double-notified for one action.
    const c = classify({
      type: 'INSERT',
      table: 'chores',
      record: { id: '1', title: 'Bins', urgency: 2, created_by: 'jackie' },
      old_record: null,
    })
    expect(['any_added', 'urgent_added']).toContain(c?.event)
  })

  it('credits the creator as actor, with no target yet', () => {
    const c = classify({
      type: 'INSERT',
      table: 'shopping_items',
      record: { id: '1', title: 'Eggs', created_by: 'avi' },
      old_record: null,
    })
    expect(c?.actorId).toBe('avi')
    expect(c?.targetId).toBeNull()
  })
})

describe('classify: claiming', () => {
  it('fires only on the null → set transition', () => {
    const c = classify({
      type: 'UPDATE',
      table: 'todos',
      record: { id: '1', title: 'Milk', claimed_by: 'jackie', created_by: 'avi' },
      old_record: { id: '1', title: 'Milk', claimed_by: null, created_by: 'avi' },
    })
    expect(c?.event).toBe('claim_complete')
    expect(c?.actorId).toBe('jackie')
    expect(c?.targetId).toBe('avi')
  })

  it('does not fire when the claim is unchanged', () => {
    const c = classify({
      type: 'UPDATE',
      table: 'todos',
      record: { id: '1', title: 'Milk', claimed_by: 'jackie', created_by: 'avi' },
      old_record: { id: '1', title: 'Milk', claimed_by: 'jackie', created_by: 'avi' },
    })
    expect(c).toBeNull()
  })
})

describe('classify: completing', () => {
  it('one-off items fire on is_done false → true', () => {
    const c = classify({
      type: 'UPDATE',
      table: 'todos',
      record: { id: '1', title: 'Milk', is_done: true, created_by: 'avi' },
      old_record: { id: '1', title: 'Milk', is_done: false, created_by: 'avi' },
    })
    expect(c?.event).toBe('claim_complete')
    expect(c?.targetId).toBe('avi')
  })

  it('recurring chores fire on last_completed_by changing, not is_done', () => {
    const c = classify({
      type: 'UPDATE',
      table: 'chores',
      record: { id: '1', title: 'Bins', last_completed_by: 'jackie' },
      old_record: { id: '1', title: 'Bins', last_completed_by: null },
    })
    expect(c?.event).toBe('claim_complete')
    expect(c?.actorId).toBe('jackie')
    expect(c?.push.tab).toBe('chores')
  })
})

describe('classify: editing', () => {
  it('fires item_edited when updated_by changes and nothing else matched', () => {
    const c = classify({
      type: 'UPDATE',
      table: 'wishlist_items',
      record: { id: '1', title: 'New headphones', updated_by: 'avi' },
      old_record: { id: '1', title: 'Headphones', updated_by: null },
    })
    expect(c?.event).toBe('item_edited')
    expect(c?.actorId).toBe('avi')
    expect(c?.targetId).toBeNull()
    expect(c?.push.tab).toBe('wishlist')
  })

  it('does not fire when updated_by is unchanged', () => {
    const c = classify({
      type: 'UPDATE',
      table: 'todos',
      record: { id: '1', title: 'Milk v2', updated_by: 'avi' },
      old_record: { id: '1', title: 'Milk', updated_by: 'avi' },
    })
    expect(c).toBeNull()
  })

  it('is a fallback — claiming still wins even if updated_by also changed', () => {
    const c = classify({
      type: 'UPDATE',
      table: 'todos',
      record: { id: '1', title: 'Milk', claimed_by: 'jackie', created_by: 'avi', updated_by: 'jackie' },
      old_record: { id: '1', title: 'Milk', claimed_by: null, created_by: 'avi', updated_by: null },
    })
    expect(c?.event).toBe('claim_complete')
  })
})

describe('classify: no-ops', () => {
  it('ignores deletes', () => {
    expect(
      classify({ type: 'DELETE', table: 'todos', record: null, old_record: { id: '1', title: 'x' } }),
    ).toBeNull()
  })

  it('ignores an update with nothing notification-worthy in it', () => {
    const c = classify({
      type: 'UPDATE',
      table: 'todos',
      record: { id: '1', title: 'Milk v2' },
      old_record: { id: '1', title: 'Milk' },
    })
    expect(c).toBeNull()
  })
})

describe('classify: encyclopedia', () => {
  it('announces a new entry the way the book prints it', () => {
    const c = classify({
      type: 'INSERT',
      table: 'lexicon_entries',
      record: {
        id: 'e1',
        term: 'schlumpy',
        part_of_speech: 'adjective',
        definition: 'Looking as though one has been rained on, emotionally.',
        created_by: 'jackie',
      },
      old_record: null,
    })
    expect(c?.event).toBe('entry_added')
    expect(c?.appId).toBe('encyclopedia')
    expect(c?.actorId).toBe('jackie')
    expect(c?.push.title).toBe('📖 schlumpy (adj.)')
    expect(c?.push.body).toBe('Looking as though one has been rained on, emotionally.')
    expect(c?.push.itemId).toBe('e1')
  })

  it('says nothing about a revision', () => {
    const record = { id: 'e1', term: 'schlumpy', definition: 'x', updated_by: 'avi' }
    expect(classify({ type: 'UPDATE', table: 'lexicon_entries', record, old_record: record })).toBeNull()
  })
})

describe('classify: watched', () => {
  it('announces a show going on a shelf, saying whose', () => {
    const shelf = (shelf_owner: string | null) =>
      classify({
        type: 'INSERT',
        table: 'watch_shows',
        record: { id: 's1', title: 'Severance', stage: 'shelf', shelf_owner, created_by: 'jackie' },
        old_record: null,
      })
    expect(shelf('jackie')).toMatchObject({
      event: 'show_added',
      appId: 'watched',
      actorId: 'jackie',
      push: { title: '📺 Severance', body: 'On their shelf', tab: 'shelf', itemId: 's1' },
    })
    expect(shelf(null)?.push.body).toBe('On the shared shelf')
    expect(shelf('avi')?.push.body).toBe('On your shelf')
  })

  it('says nothing about a show added after the fact to be rated', () => {
    expect(
      classify({
        type: 'INSERT',
        table: 'watch_shows',
        record: { id: 's1', title: 'Lost', stage: 'watched', watched_before: true, created_by: 'avi' },
        old_record: null,
      }),
    ).toBeNull()
  })

  it('asks for a rating when a show is finished, and only then', () => {
    const before = { id: 's1', title: 'Severance', stage: 'watching', updated_by: 'avi' }
    const c = classify({ type: 'UPDATE', table: 'watch_shows', record: { ...before, stage: 'watched' }, old_record: before })
    expect(c).toMatchObject({ event: 'show_finished', actorId: 'avi', push: { tab: 'rate:0', itemId: 's1' } })
    expect(classify({ type: 'UPDATE', table: 'watch_shows', record: { ...before, stage: 'lineup' }, old_record: before })).toBeNull()
  })

  it('asks for a rating when a season is finished, naming it', () => {
    const start = { id: 'r1', show_id: 's1', season: 2, show_title: 'Severance', created_by: 'avi', finished_at: null }
    expect(classify({ type: 'INSERT', table: 'watch_seasons', record: start, old_record: null })).toBeNull()
    const done = { ...start, finished_at: '2026-10-12T20:00:00Z', updated_by: 'jackie' }
    expect(classify({ type: 'UPDATE', table: 'watch_seasons', record: done, old_record: start })).toMatchObject({
      event: 'season_finished',
      appId: 'watched',
      actorId: 'jackie',
      push: { title: '🏁 Severance · Season 2', tab: 'rate:2', itemId: 's1' },
    })
    // Finished in one go from a phone that never saw it start.
    expect(classify({ type: 'INSERT', table: 'watch_seasons', record: done, old_record: null })?.event).toBe('season_finished')
    // Already finished: an edit.
    expect(classify({ type: 'UPDATE', table: 'watch_seasons', record: done, old_record: done })).toBeNull()
  })
})
