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
