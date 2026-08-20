import { describe, expect, it } from 'vitest'
import { outstanding, scoreboard, shareOfDone, daysAgoIso } from './stats'
import type { ActivityLog, Chore, ShoppingItem, Todo, WishlistItem } from '@/data/types'

const NOW = Date.parse('2026-08-16T12:00:00.000Z')

const todo = (patch: Partial<Todo> = {}): Todo => ({
  id: 't1',
  title: 'Milk',
  urgency: 1,
  claimed_by: null,
  created_by: null,
  updated_by: null,
  sort_order: 0,
  created_at: '2026-08-01T00:00:00.000Z',
  updated_at: '2026-08-01T00:00:00.000Z',
  notes: null,
  is_done: false,
  completed_by: null,
  completed_at: null,
  due_at: null,
  ...patch,
})

const chore = (patch: Partial<Chore> = {}): Chore => ({
  ...todo(),
  id: 'c1',
  is_recurring: true,
  recurrence_count: 1,
  recurrence_unit: 'days',
  recurrence_days: null,
  last_completed_at: null,
  last_completed_by: null,
  next_due_at: null,
  cooldown_notified_at: null,
  ...patch,
}) as Chore

const shop = (patch: Partial<ShoppingItem> = {}): ShoppingItem => ({
  ...todo(),
  id: 's1',
  store_id: null,
  quantity: null,
  url: null,
  image_url: null,
  price_cents: null,
  ...patch,
}) as ShoppingItem

const wish = (patch: Partial<WishlistItem> = {}): WishlistItem => ({
  id: 'w1',
  title: 'Headphones',
  notes: null,
  url: null,
  price_cents: null,
  image_url: null,
  desire_level: 3,
  owner_id: null,
  is_purchased: false,
  purchased_at: null,
  created_by: null,
  updated_by: null,
  sort_order: 0,
  created_at: '2026-08-01T00:00:00.000Z',
  updated_at: '2026-08-01T00:00:00.000Z',
  ...patch,
})

const log = (patch: Partial<ActivityLog> = {}): ActivityLog => ({
  id: 'a1',
  table_name: 'todos',
  row_id: 't1',
  title: 'Milk',
  event: 'completed',
  actor_id: 'avi',
  created_at: '2026-08-16T00:00:00.000Z',
  ...patch,
})

describe('outstanding', () => {
  it('counts only what is actually actionable', () => {
    const o = outstanding(
      [todo({ id: 'a' }), todo({ id: 'b', is_done: true })],
      [chore({ id: 'c' })],
      [shop({ id: 'd' })],
      [wish({ id: 'e' })],
      NOW,
    )
    expect(o.todos).toBe(1)
    expect(o.chores).toBe(1)
    expect(o.shopping).toBe(1)
    expect(o.wishlist).toBe(1)
    // Wishes are wants, not chores — they stay out of the actionable total.
    expect(o.total).toBe(3)
  })

  it('moves a resting chore out of the actionable count', () => {
    const resting = chore({
      id: 'r',
      last_completed_at: '2026-08-16T11:00:00.000Z',
      next_due_at: '2026-08-17T11:00:00.000Z',
    })
    const o = outstanding([], [resting], [], [], NOW)
    expect(o.chores).toBe(0)
    expect(o.resting).toBe(1)
    expect(o.total).toBe(0)
  })

  it('a chore whose cooldown has passed is actionable again', () => {
    const ready = chore({
      id: 'r',
      last_completed_at: '2026-08-14T11:00:00.000Z',
      next_due_at: '2026-08-15T11:00:00.000Z',
    })
    const o = outstanding([], [ready], [], [], NOW)
    expect(o.chores).toBe(1)
    expect(o.resting).toBe(0)
  })

  it('counts urgent and unclaimed across the actionable lists', () => {
    const o = outstanding(
      [todo({ id: 'a', urgency: 2 }), todo({ id: 'b', urgency: 0, claimed_by: 'avi' })],
      [],
      [shop({ id: 'c', urgency: 2, claimed_by: 'jackie' })],
      [],
      NOW,
    )
    expect(o.urgent).toBe(2)
    expect(o.unclaimed).toBe(1)
  })

  it('does not count a done item as urgent', () => {
    const o = outstanding([todo({ id: 'a', urgency: 2, is_done: true })], [], [], [], NOW)
    expect(o.urgent).toBe(0)
    expect(o.total).toBe(0)
  })
})

describe('scoreboard', () => {
  const since = daysAgoIso(7, NOW)

  it('counts completions per person inside the window', () => {
    const entries = [
      log({ id: '1', actor_id: 'avi' }),
      log({ id: '2', actor_id: 'avi' }),
      log({ id: '3', actor_id: 'jackie' }),
    ]
    const [avi, jackie] = scoreboard(entries, ['avi', 'jackie'], since, [])
    expect(avi.done).toBe(2)
    expect(jackie.done).toBe(1)
  })

  it('ignores anything older than the window', () => {
    const entries = [
      log({ id: '1', actor_id: 'avi', created_at: '2026-07-01T00:00:00.000Z' }),
      log({ id: '2', actor_id: 'avi' }),
    ]
    const [avi] = scoreboard(entries, ['avi'], since, [])
    expect(avi.done).toBe(1)
  })

  it('separates adding from finishing', () => {
    const entries = [
      log({ id: '1', actor_id: 'avi', event: 'added' }),
      log({ id: '2', actor_id: 'avi', event: 'completed' }),
    ]
    const [avi] = scoreboard(entries, ['avi'], since, [])
    expect(avi.added).toBe(1)
    expect(avi.done).toBe(1)
  })

  it('does not count claims or edits as finishing something', () => {
    const entries = [
      log({ id: '1', actor_id: 'avi', event: 'claimed' }),
      log({ id: '2', actor_id: 'avi', event: 'edited' }),
      log({ id: '3', actor_id: 'avi', event: 'deleted' }),
    ]
    const [avi] = scoreboard(entries, ['avi'], since, [])
    expect(avi.done).toBe(0)
  })

  it('counts what is currently on each plate', () => {
    const [avi, jackie] = scoreboard([], ['avi', 'jackie'], since, ['avi', 'avi', 'jackie', null])
    expect(avi.claimed).toBe(2)
    expect(jackie.claimed).toBe(1)
  })
})

describe('shareOfDone', () => {
  it('splits proportionally', () => {
    const share = shareOfDone([
      { profileId: 'avi', done: 3, added: 0, claimed: 0 },
      { profileId: 'jackie', done: 1, added: 0, claimed: 0 },
    ])
    expect(share).toEqual([0.75, 0.25])
  })

  it('reads level when nobody has done anything, rather than a default winner', () => {
    const share = shareOfDone([
      { profileId: 'avi', done: 0, added: 0, claimed: 0 },
      { profileId: 'jackie', done: 0, added: 0, claimed: 0 },
    ])
    expect(share).toEqual([0.5, 0.5])
  })
})
