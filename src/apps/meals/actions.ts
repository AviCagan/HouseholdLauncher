import { toast } from 'sonner'
import { useData } from '@/store/useData'
import { newId, nowIso, type TableName } from '@/data/adapter'
import { fire } from '@/lib/haptics'
import type { Dish, Meal, MealTemplate } from '@/data/types'

/**
 * Writes for Meals — dishes, meals and templates.
 *
 * Optimistic in the strict sense the rest of the app means it: the row is in
 * the store — and handed back to the caller — before the network is touched.
 * The commit runs on its own; if it fails, the store is put back exactly as
 * it was and a toast says so. No sheet ever waits on the round-trip, because
 * on a phone that round-trip can take a second or three minutes, and a
 * button stuck on "Saving…" is the worse of the two.
 *
 * The three tables are identical in this respect, so one generic trio of
 * helpers serves all of them.
 */

type Row = Dish | Meal | MealTemplate
type MealTable = Extract<TableName, 'dishes' | 'meals' | 'meal_templates'>

function rows<T extends Row>(table: MealTable): T[] {
  return useData.getState()[table] as unknown as T[]
}

function replaceRow<T extends Row>(table: MealTable, id: string, next: T | null): void {
  const current = rows<T>(table)
  const updated = next
    ? current.some((r) => r.id === id)
      ? current.map((r) => (r.id === id ? next : r))
      : [...current, next]
    : current.filter((r) => r.id !== id)
  useData.setState({ [table]: updated } as never)
}

/** Put the row in the store now; commit in the background. */
function insert<T extends Row>(table: MealTable, row: T, failure: string): void {
  replaceRow(table, row.id, row)
  void (async () => {
    try {
      await useData.getState().adapter.insert(table, row as never)
    } catch (err) {
      replaceRow(table, row.id, null)
      fire('error')
      toast.error(failure)
      console.error(`[${table}]`, err)
    }
  })()
}

function update<T extends Row>(table: MealTable, before: T, patch: Partial<T>, failure: string): void {
  const next = { ...before, ...patch, updated_at: nowIso() } as T
  replaceRow(table, before.id, next)
  void (async () => {
    try {
      await useData.getState().adapter.update(table, before.id, patch as never)
    } catch (err) {
      replaceRow(table, before.id, before)
      fire('error')
      toast.error(failure)
      console.error(`[${table}]`, err)
    }
  })()
}

function remove<T extends Row>(table: MealTable, row: T, failure: string): void {
  fire('delete')
  replaceRow(table, row.id, null)
  void (async () => {
    try {
      await useData.getState().adapter.remove(table, row.id)
    } catch (err) {
      replaceRow(table, row.id, row)
      fire('error')
      toast.error(failure)
      console.error(`[${table}]`, err)
    }
  })()
}

// --- dishes -------------------------------------------------------------------

export type DishInput = Pick<
  Dish,
  | 'name' | 'emoji' | 'kind' | 'ingredients' | 'steps' | 'servings' | 'cost_cents'
  | 'nutrition' | 'source_url' | 'source_kind' | 'image_url' | 'notes'
>

export function addDish(input: DishInput, profileId: string | null): Dish | null {
  const name = input.name.trim()
  if (!name) return null
  const row: Dish = {
    id: newId(),
    ...input,
    name,
    emoji: input.emoji || '🍽️',
    ingredients: input.ingredients.filter((i) => i.name.trim()),
    steps: input.steps.map((s) => s.trim()).filter(Boolean),
    tags: [],
    created_by: profileId,
    updated_by: null,
    created_at: nowIso(),
    updated_at: nowIso(),
  }
  fire('success')
  insert('dishes', row, "Couldn't save that dish")
  return row
}

export function updateDish(dish: Dish, patch: Partial<DishInput>, profileId: string | null): Dish {
  const full: Partial<Dish> = { ...patch, updated_by: profileId }
  if (patch.name !== undefined) full.name = patch.name.trim()
  if (patch.ingredients) full.ingredients = patch.ingredients.filter((i) => i.name.trim())
  if (patch.steps) full.steps = patch.steps.map((s) => s.trim()).filter(Boolean)
  fire('success')
  update('dishes', dish, full, "Couldn't save that dish")
  return { ...dish, ...full }
}

export const removeDish = (dish: Dish): void => remove('dishes', dish, "Couldn't delete that dish")

// --- meals --------------------------------------------------------------------

export type MealInput = Pick<Meal, 'name' | 'emoji' | 'occasion' | 'template_id' | 'planned_for' | 'people' | 'courses' | 'notes'>

export function addMeal(input: MealInput, profileId: string | null): Meal | null {
  const name = input.name.trim()
  if (!name) return null
  const row: Meal = {
    id: newId(),
    ...input,
    name,
    emoji: input.emoji || '🍽️',
    created_by: profileId,
    updated_by: null,
    created_at: nowIso(),
    updated_at: nowIso(),
  }
  fire('success')
  insert('meals', row, "Couldn't save that meal")
  return row
}

export function updateMeal(meal: Meal, patch: Partial<MealInput>, profileId: string | null): void {
  const full: Partial<Meal> = { ...patch, updated_by: profileId }
  if (patch.name !== undefined) full.name = patch.name.trim()
  fire('success')
  update('meals', meal, full, "Couldn't save that meal")
}

export const removeMeal = (meal: Meal): void => remove('meals', meal, "Couldn't delete that meal")

// --- templates ----------------------------------------------------------------

export type TemplateInput = Pick<MealTemplate, 'name' | 'emoji' | 'occasion' | 'people' | 'slots'>

export function addTemplate(input: TemplateInput, profileId: string | null): MealTemplate | null {
  const name = input.name.trim()
  if (!name) return null
  const row: MealTemplate = {
    id: newId(),
    ...input,
    name,
    emoji: input.emoji || '🍽️',
    slots: input.slots.filter((s) => s.label.trim()),
    is_builtin: false,
    sort_order: Date.now(),
    created_by: profileId,
    updated_by: null,
    created_at: nowIso(),
    updated_at: nowIso(),
  }
  fire('success')
  insert('meal_templates', row, "Couldn't save that template")
  return row
}

export function updateTemplate(
  template: MealTemplate,
  patch: Partial<TemplateInput>,
  profileId: string | null,
): void {
  const full: Partial<MealTemplate> = { ...patch, updated_by: profileId }
  if (patch.name !== undefined) full.name = patch.name.trim()
  if (patch.slots) full.slots = patch.slots.filter((s) => s.label.trim())
  fire('success')
  update('meal_templates', template, full, "Couldn't save that template")
}

export const removeTemplate = (template: MealTemplate): void =>
  remove('meal_templates', template, "Couldn't delete that template")
