-- Household Launcher — nutrition worked out from the ingredients
--
-- Safe to run more than once. Run it after 017_meals.sql.
--
-- A dish can have its per-serving nutrition worked out from what goes in it
-- (a bundled pantry of common ingredients on the phone — see
-- src/apps/meals/foods.ts) rather than typed in. The figures are still stored
-- in `nutrition`, so every meal sums them the same way; this flag only says
-- whether the editor should keep recomputing them from the ingredients or
-- leave them as somebody typed them.

alter table dishes
  add column if not exists nutrition_auto boolean not null default false;
