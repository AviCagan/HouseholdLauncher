import { describe, expect, it } from 'vitest'
import { activityRow, deriveActivity, isActivityTable } from './activity'

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

describe('stolen claims', () => {
  it('reports a claim moving between two people as stolen, not edited', () => {
    const derived = deriveActivity(
      'todos',
      'update',
      { id: 't', claimed_by: 'avi' },
      { id: 't', claimed_by: 'jackie' },
    )
    expect(derived).toEqual({ event: 'stolen', actorId: 'jackie', subjectId: 'avi' })
  })

  it('names the thief as the actor and the victim as the subject', () => {
    const derived = deriveActivity(
      'shopping_items',
      'update',
      { id: 's', claimed_by: 'jackie' },
      { id: 's', claimed_by: 'avi' },
    )
    expect(derived?.actorId).toBe('avi')
    expect(derived?.subjectId).toBe('jackie')
  })

  /*
    The ordering that makes the whole thing work. A steal never passes through
    null, so the claimed/unclaimed check — which tests whether the NULL-ness
    changed — cannot see it. Put that check first and every theft is logged as
    a plain edit, or as nothing at all.
  */
  it('is not confused with an ordinary claim or release', () => {
    const claimed = deriveActivity(
      'todos',
      'update',
      { id: 't', claimed_by: null },
      { id: 't', claimed_by: 'avi' },
    )
    expect(claimed?.event).toBe('claimed')

    const released = deriveActivity(
      'todos',
      'update',
      { id: 't', claimed_by: 'avi' },
      { id: 't', claimed_by: null },
    )
    expect(released?.event).toBe('unclaimed')
  })

  it('does not fire when the same person re-claims their own item', () => {
    const derived = deriveActivity(
      'todos',
      'update',
      { id: 't', claimed_by: 'avi' },
      { id: 't', claimed_by: 'avi' },
    )
    expect(derived).toBeNull()
  })

  /*
    Completing a recurring chore writes last_completed_by AND clears claimed_by
    in one update. Completion is checked first, so this stays 'completed' — if
    theft were checked earlier it would still be safe (the new claim is null),
    but this pins the behaviour either way.
  */
  it('still reports a completed chore as completed, not as a claim change', () => {
    const derived = deriveActivity(
      'chores',
      'update',
      { id: 'c', claimed_by: 'avi', last_completed_by: null },
      { id: 'c', claimed_by: null, last_completed_by: 'jackie' },
    )
    expect(derived?.event).toBe('completed')
  })

  it('leaves subject_id null for every event that is not a theft', () => {
    const added = deriveActivity('todos', 'insert', null, { id: 't', created_by: 'avi' })
    expect(activityRow('todos', 't', 'x', added!).subject_id).toBeNull()
  })
})
