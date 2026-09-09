import type { MealTemplate } from '@/data/types'

/**
 * The built-in templates, for a device running with no backend.
 *
 * On the household's real project these rows are seeded by
 * supabase/017_meals.sql, and that file is the source of truth — the ids here
 * are the same fixed ids, so a local database and the live one agree about
 * which template is which. This copy exists only so the local adapter has
 * something to show on the Templates tab; it is never written to Supabase.
 */

const at = '2026-01-01T00:00:00.000Z'

const t = (
  n: number,
  name: string,
  emoji: string,
  occasion: string,
  people: number,
  slots: MealTemplate['slots'],
): MealTemplate => ({
  id: `5b2c1e10-0001-4d00-8000-${String(n).padStart(12, '0')}`,
  name,
  emoji,
  occasion,
  slots,
  people,
  is_builtin: true,
  sort_order: n,
  created_by: null,
  updated_by: null,
  created_at: at,
  updated_at: at,
})

export const BUILTIN_TEMPLATES: MealTemplate[] = [
  t(1, 'Weeknight dinner', '🍝', 'weeknight', 2, [
    { role: 'main', label: 'Main' }, { role: 'side', label: 'Side' }, { role: 'salad', label: 'Something green' },
  ]),
  t(2, 'Special dinner', '✨', 'special', 4, [
    { role: 'soup', label: 'Starter' }, { role: 'main', label: 'Main' }, { role: 'side', label: 'Side' },
    { role: 'side', label: 'Side' }, { role: 'dessert', label: 'Dessert' },
  ]),
  t(3, 'Shabbat dinner', '🕯️', 'shabbat', 6, [
    { role: 'bread', label: 'Challah' }, { role: 'main', label: 'Fish' }, { role: 'soup', label: 'Soup' },
    { role: 'main', label: 'Main' }, { role: 'side', label: 'Side' }, { role: 'side', label: 'Side' },
    { role: 'dessert', label: 'Dessert' },
  ]),
  t(4, 'Shabbat lunch', '☀️', 'shabbat', 6, [
    { role: 'bread', label: 'Challah' }, { role: 'main', label: 'Fish' }, { role: 'salad', label: 'Salads' },
    { role: 'main', label: 'Cholent or main' }, { role: 'side', label: 'Side' }, { role: 'dessert', label: 'Dessert' },
  ]),
  t(5, 'Rosh Hashanah', '🍎', 'holiday', 8, [
    { role: 'bread', label: 'Round challah' }, { role: 'snack', label: 'Apples & honey' }, { role: 'main', label: 'Fish' },
    { role: 'soup', label: 'Soup' }, { role: 'main', label: 'Main' }, { role: 'side', label: 'Tzimmes' },
    { role: 'side', label: 'Side' }, { role: 'dessert', label: 'Honey cake' },
  ]),
  t(6, 'Yom Kippur break-fast', '🥯', 'holiday', 8, [
    { role: 'bread', label: 'Bagels & lox' }, { role: 'side', label: 'Kugel' }, { role: 'salad', label: 'Salads' },
    { role: 'drink', label: 'Something to drink' }, { role: 'dessert', label: 'Dessert' },
  ]),
  t(7, 'Sukkot', '🍂', 'holiday', 8, [
    { role: 'bread', label: 'Challah' }, { role: 'soup', label: 'Soup' }, { role: 'main', label: 'Stuffed main' },
    { role: 'side', label: 'Side' }, { role: 'side', label: 'Side' }, { role: 'dessert', label: 'Dessert' },
  ]),
  t(8, 'Chanukah', '🕎', 'holiday', 6, [
    { role: 'side', label: 'Latkes' }, { role: 'main', label: 'Main' }, { role: 'salad', label: 'Salad' },
    { role: 'dessert', label: 'Sufganiyot' },
  ]),
  t(9, 'Purim seudah', '🎭', 'holiday', 8, [
    { role: 'bread', label: 'Challah' }, { role: 'main', label: 'Main' }, { role: 'side', label: 'Side' },
    { role: 'side', label: 'Side' }, { role: 'dessert', label: 'Hamantaschen' },
  ]),
  t(10, 'Pesach seder', '🍷', 'holiday', 10, [
    { role: 'other', label: 'Seder plate' }, { role: 'bread', label: 'Matzah' }, { role: 'main', label: 'Gefilte fish' },
    { role: 'soup', label: 'Matzah ball soup' }, { role: 'main', label: 'Main' }, { role: 'side', label: 'Side' },
    { role: 'side', label: 'Side' }, { role: 'dessert', label: 'Dessert' },
  ]),
  t(11, 'Shavuot', '🧀', 'holiday', 6, [
    { role: 'main', label: 'Blintzes or dairy main' }, { role: 'salad', label: 'Salad' }, { role: 'side', label: 'Side' },
    { role: 'dessert', label: 'Cheesecake' },
  ]),
]
