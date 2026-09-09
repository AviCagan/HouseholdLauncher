import { toast } from 'sonner'
import { useData } from '@/store/useData'
import { newId, nowIso, type TableName } from '@/data/adapter'
import { fire } from '@/lib/haptics'
import type { Dish, Meal, MealTemplate } from '@/data/types'

/**
 * Writes for Meals — dishes, meals and templates.
 *
 * Same optimistic shape as Things and Owe: put the row in the store first,
 * fire the haptic, then commit, and if the commit fails put the store back
 * exactly as it was. The three tables are identical in this respect, so one
 * generic trio of helpers serves all of them.
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

async function insert<T extends Row>(table: MealTable, row: T, failure: string): Promise<boolean> {
  replaceRow(table, row.id, row)
  try {
    await useData.getState().adapter.insert(table, row as never)
    return true
  } catch (err) {
    replaceRow(table, row.id, null)
    fire('error')
    toast.error(failure)
    console.error(`[${table}]`, err)
    return false
  }
}

async function update<T extends Row>(
  table: MealTable,
  before: T,
  patch: Partial<T>,
  failure: string,
): Promise<boolean> {
  const next = { ...before, ...patch, updated_at: nowIso() } as T
  replaceRow(table, before.id, next)
  try {
    await useData.getState().adapter.update(table, before.id, patch as never)
    return true
  } catch (err) {
    replaceRow(table, before.id, before)
    fire('error')
    toast.error(failure)
    console.error(`[${table}]`, err)
    return false
  }
}

async function remove<T extends Row>(table: MealTable, row: T, failure: string): Promise<boolean> {
  fire('delete')
  replaceRow(table, row.id, null)
  try {
    await useData.getState().adapter.remove(table, row.id)
    return true
  } catch (err) {
    replaceRow(table, row.id, row)
    fire('error')
    toast.error(failure)
    console.error(`[${table}]`, err)
    return false
  }
}

// --- dishes -------------------------------------------------------------------

export type DishInput = Pick<
  Dish,
  | 'name' | 'emoji' | 'kind' | 'ingredients' | 'steps' | 'servings' | 'cost_cents'
  | 'nutrition' | 'source_url' | 'source_kind' | 'image_url' | 'notes'
>

export async function addDish(input: DishInput, profileId: string | null): Promise<Dish | null> {
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
  return (await insert('dishes', row, "Couldn't save that dish")) ? row : null
}

export async function updateDish(dish: Dish, patch: Partial<DishInput>, profileId: string | null): Promise<boolean> {
  const full: Partial<Dish> = { ...patch, updated_by: profileId }
  if (patch.name !== undefined) full.name = patch.name.trim()
  if (patch.ingredients) full.ingredients = patch.ingredients.filter((i) => i.name.trim())
  if (patch.steps) full.steps = patch.steps.map((s) => s.trim()).filter(Boolean)
  fire('success')
  return update('dishes', dish, full, "Couldn't save that dish")
}

export const removeDish = (dish: Dish): Promise<boolean> =>
  remove('dishes', dish, "Couldn't delete that dish")

// --- meals --------------------------------------------------------------------

export type MealInput = Pick<Meal, 'name' | 'emoji' | 'occasion' | 'template_id' | 'planned_for' | 'courses' | 'notes'>

export async function addMeal(input: MealInput, profileId: string | null): Promise<Meal | null> {
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
  return (await insert('meals', row, "Couldn't save that meal")) ? row : null
}

export async function updateMeal(meal: Meal, patch: Partial<MealInput>, profileId: string | null): Promise<boolean> {
  const full: Partial<Meal> = { ...patch, updated_by: profileId }
  if (patch.name !== undefined) full.name = patch.name.trim()
  fire('success')
  return update('meals', meal, full, "Couldn't save that meal")
}

export const removeMeal = (meal: Meal): Promise<boolean> =>
  remove('meals', meal, "Couldn't delete that meal")

// --- templates ----------------------------------------------------------------

export type TemplateInput = Pick<MealTemplate, 'name' | 'emoji' | 'occasion' | 'slots'>

export async function addTemplate(input: TemplateInput, profileId: string | null): Promise<MealTemplate | null> {
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
  return (await insert('meal_templates', row, "Couldn't save that template")) ? row : null
}

export async function updateTemplate(
  template: MealTemplate,
  patch: Partial<TemplateInput>,
  profileId: string | null,
): Promise<boolean> {
  const full: Partial<MealTemplate> = { ...patch, updated_by: profileId }
  if (patch.name !== undefined) full.name = patch.name.trim()
  if (patch.slots) full.slots = patch.slots.filter((s) => s.label.trim())
  fire('success')
  return update('meal_templates', template, full, "Couldn't save that template")
}

export const removeTemplate = (template: MealTemplate): Promise<boolean> =>
  remove('meal_templates', template, "Couldn't delete that template")
