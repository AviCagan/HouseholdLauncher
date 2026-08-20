import { create } from 'zustand'
import type { TabKey } from '@/data/types'

export const TABS: { key: TabKey; label: string; icon: string }[] = [
  { key: 'todos', label: 'To-do', icon: 'check' },
  { key: 'chores', label: 'Chores', icon: 'repeat' },
  { key: 'shopping', label: 'Shopping', icon: 'cart' },
  { key: 'wishlist', label: 'Wishlist', icon: 'star' },
]

type Sheet =
  | { kind: 'none' }
  | { kind: 'settings' }
  | { kind: 'trip' }
  | { kind: 'stores' }
  | { kind: 'item'; table: 'todos' | 'chores' | 'shopping_items' | 'wishlist_items'; id: string }
  | { kind: 'activity' }

/** Every sort key any tab offers. Each tab exposes only the ones it means. */
export type SortKey = 'urgency' | 'added' | 'recurring' | 'desire' | 'price' | 'store'
export type WishSort = 'desire' | 'price' | 'added'
/** null = everyone; 'shared' = the ones marked as for both of you. */
export type WishOwner = string | 'shared' | null

interface UIState {
  tab: TabKey
  sheet: Sheet
  highlightId: string | null
  /** The walkthrough. Shown once per person per device, replayable from Settings. */
  tour: boolean
  /**
   * Newest activity entry this person has seen, ISO. Lives here rather than in
   * ActivityBell because the badge and the sheet are mounted in two different
   * places — the sheet has to escape the header rail's stacking context, so
   * they can't share component state.
   */
  activitySeenAt: string | null
  setActivitySeenAt: (iso: string | null) => void
  // Wishlist view state lives here so it survives switching tabs.
  wishSort: WishSort
  wishDesc: boolean
  wishOwner: WishOwner
  // Sort per tab, so switching tabs doesn't reset what you chose.
  sortBy: Record<TabKey, SortKey>
  sortDesc: Record<TabKey, boolean>
  setTab: (tab: TabKey) => void
  openSheet: (sheet: Sheet) => void
  closeSheet: () => void
  highlight: (id: string | null) => void
  setWishSort: (sort: WishSort) => void
  toggleWishDir: () => void
  setWishOwner: (owner: WishOwner) => void
  setSort: (tab: TabKey, key: SortKey) => void
  toggleSortDir: (tab: TabKey) => void
  startTour: () => void
  endTour: () => void
}

export const useUI = create<UIState>((set) => ({
  tab: 'todos',
  sheet: { kind: 'none' },
  highlightId: null,
  tour: false,
  wishSort: 'desire',
  wishDesc: true,
  wishOwner: null,
  sortBy: {
    todos: 'urgency',
    chores: 'urgency',
    shopping: 'urgency',
    wishlist: 'desire',
  },
  sortDesc: { todos: true, chores: true, shopping: true, wishlist: true },
  activitySeenAt: null,
  setActivitySeenAt: (activitySeenAt) => set({ activitySeenAt }),
  setTab: (tab) => set({ tab }),
  openSheet: (sheet) => set({ sheet }),
  closeSheet: () => set({ sheet: { kind: 'none' } }),
  highlight: (id) => set({ highlightId: id }),
  setWishSort: (wishSort) => set({ wishSort }),
  toggleWishDir: () => set((s) => ({ wishDesc: !s.wishDesc })),
  setWishOwner: (wishOwner) => set({ wishOwner }),
  setSort: (tab, key) => set((s) => ({ sortBy: { ...s.sortBy, [tab]: key } })),
  toggleSortDir: (tab) =>
    set((s) => ({ sortDesc: { ...s.sortDesc, [tab]: !s.sortDesc[tab] } })),
  // The tour drives the tab underneath it, so it always starts from the first
  // tab rather than wherever you happened to be.
  startTour: () => set({ tour: true, sheet: { kind: 'none' }, tab: 'todos' }),
  endTour: () => set({ tour: false }),
}))

export const tabIndex = (tab: TabKey): number =>
  TABS.findIndex((t) => t.key === tab)
