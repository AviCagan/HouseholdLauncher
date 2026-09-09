import { create } from 'zustand'
import type { Dish, Meal, MealTemplate } from '@/data/types'
import type { DishInput } from './actions'

/**
 * Where you are inside Meals.
 *
 * A store rather than props threaded through three tabs, because the same
 * sheet is opened from several places — a dish from its card, from the
 * importer's preview, from a slot in a meal — and a notification tap has to
 * be able to land on one too.
 */

export type MealsTab = 'dishes' | 'meals' | 'templates'

export type MealsSheet =
  | {
      kind: 'dish'
      dish: Dish | null
      /** Pre-filled fields for a new dish — from the importer, or a slot's role. */
      draft?: Partial<DishInput>
      /** A one-line caution shown above the form, e.g. "guessed from a caption". */
      note?: string
    }
  | { kind: 'meal'; meal: Meal | null; template?: MealTemplate | null }
  | { kind: 'template'; template: MealTemplate | null }
  | { kind: 'import' }

interface MealsUI {
  tab: MealsTab
  sheet: MealsSheet | null
  /** Bumped on every save worth celebrating; the confetti keys off it. */
  burst: number
  setTab: (tab: MealsTab) => void
  openSheet: (sheet: MealsSheet) => void
  closeSheet: () => void
  celebrate: () => void
}

export const useMealsUI = create<MealsUI>((set) => ({
  tab: 'dishes',
  sheet: null,
  burst: 0,
  setTab: (tab) => set({ tab }),
  openSheet: (sheet) => set({ sheet }),
  closeSheet: () => set({ sheet: null }),
  celebrate: () => set((s) => ({ burst: s.burst + 1 })),
}))
