import { describe, expect, it } from 'vitest'
import { deriveActivity, isActivityTable } from './activity'

/**
 * These mirror the end-to-end cases the Postgres `log_activity()` trigger was
 * verified against, because the whole point of this module is that the local
 * adapter behaves identically to the database. The two that matter most are
 * the two that were real bugs in the SQL: a chore completion must not be
 * logged as "unclaimed", and a no-op write must log nothing at all.
 */

const AVI = 'avi'
const JACKIE = 'jackie'

const row = (patch: Record<string, unknown> = {}) => ({
  id: 'x',
  title: 'Milk',
  created_by: AVI,
  updated_by: null,
  claimed_by: null,
  is_done: false,
  ...patch,
})

describe('isActivityTable', () => {
  it('covers exactly the four list tables', () => {
    expect(isActivityTable('todos')).toBe(true)
    expect(isActivityTable('chores')).toBe(true)
    expect(isActivityTable('shopping_items')).toBe(true)
    expect(isActivityTable('wishlist_items')).toBe(true)
    expect(isActivityTable('stores')).toBe(false)
    expect(isActivityTable('activity_log')).toBe(false)
  })
})

describe('deriveActivity', () => {
  it('credits the creator on insert', () => {
    expect(deriveActivity('todos', 'insert', null, row())).toEqual({
      event: 'added',
      actorId: AVI,
    })
  })

  it('attributes a delete to whoever last touched it', () => {
    expect(
      deriveActivity('todos', 'delete', row({ updated_by: JACKIE }), null),
    ).toEqual({ event: 'deleted', actorId: JACKIE })
    expect(
      deriveActivity('todos', 'delete', row({ claimed_by: JACKIE }), null),
    ).toEqual({ event: 'deleted', actorId: JACKIE })
    expect(deriveActivity('todos', 'delete', row(), null)).toEqual({
      event: 'deleted',
      actorId: AVI,
    })
  })

  it('logs claiming and unclaiming', () => {
    expect(
      deriveActivity('todos', 'update', row(), row({ claimed_by: JACKIE })),
    ).toEqual({ event: 'claimed', actorId: JACKIE })
    expect(
      deriveActivity('todos', 'update', row({ claimed_by: JACKIE }), row()),
    ).toEqual({ event: 'unclaimed', actorId: JACKIE })
  })

  it('logs completion of a one-off item', () => {
    expect(
      deriveActivity(
        'todos',
        'update',
        row({ claimed_by: JACKIE }),
        row({ claimed_by: JACKIE, is_done: true, updated_by: JACKIE }),
      ),
    ).toEqual({ event: 'completed', actorId: JACKIE })
  })

  it('logs a chore completion as completed, not unclaimed', () => {
    // The real bug: completeChore sets last_completed_by AND clears claimed_by
    // in one write. Checking claiming first reported every completion as
    // "unclaimed", which is both wrong and insulting.
    const before = row({ claimed_by: JACKIE, last_completed_by: null })
    const after = row({ claimed_by: null, last_completed_by: JACKIE })
    expect(deriveActivity('chores', 'update', before, after)).toEqual({
      event: 'completed',
      actorId: JACKIE,
    })
  })

  it('logs buying and un-buying a wish', () => {
    const before = row({ is_purchased: false })
    expect(
      deriveActivity(
        'wishlist_items',
        'update',
        before,
        row({ is_purchased: true, updated_by: JACKIE }),
      ),
    ).toEqual({ event: 'completed', actorId: JACKIE })
  })

  it('logs a plain edit when updated_by changes', () => {
    expect(
      deriveActivity('todos', 'update', row(), row({ updated_by: AVI, title: 'Milk v2' })),
    ).toEqual({ event: 'edited', actorId: AVI })
  })

  it('logs nothing for a write that changed nothing worth reporting', () => {
    // Sort-order drags and the cooldown ticker both land here.
    expect(deriveActivity('todos', 'update', row(), row())).toBeNull()
    expect(
      deriveActivity('todos', 'update', row(), row({ sort_order: 99 } as never)),
    ).toBeNull()
  })

  it('never reads claimed_by on wishlist items, which do not have it', () => {
    const before = row({ is_purchased: false, claimed_by: undefined })
    const after = row({ is_purchased: false, claimed_by: undefined, title: 'New' })
    expect(deriveActivity('wishlist_items', 'update', before, after)).toBeNull()
  })
})
