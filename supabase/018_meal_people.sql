-- Household Launcher — headcount on meals
--
-- Safe to run more than once. Run it after 017_meals.sql.
--
-- ---------------------------------------------------------------------------
-- A Shabbat dinner for two and one for twelve are the same courses and very
-- different amounts of cooking. So a meal carries how many people it is for,
-- and a template carries the number it is usually for, which a meal planned
-- from it starts at.
--
-- Nothing else is stored. Batches per dish, scaled ingredient amounts and the
-- scaled cost are all derived on the phone from `people` and each dish's own
-- `servings` — the chicken that serves four needs three batches for twelve,
-- the rice that serves eight needs two — so a corrected servings count on a
-- dish corrects every meal it is in, same as a corrected price does.
-- ---------------------------------------------------------------------------

alter table meals
  add column if not exists people integer not null default 4 check (people > 0);
alter table meal_templates
  add column if not exists people integer not null default 4 check (people > 0);

-- Sensible defaults for the built-ins, applied once: only rows still on the
-- column default are touched, so a headcount somebody has since edited stays.
update meal_templates set people = v.people
from (values
  ('5b2c1e10-0001-4d00-8000-000000000001'::uuid, 2),   -- Weeknight dinner
  ('5b2c1e10-0001-4d00-8000-000000000002'::uuid, 4),   -- Special dinner
  ('5b2c1e10-0001-4d00-8000-000000000003'::uuid, 6),   -- Shabbat dinner
  ('5b2c1e10-0001-4d00-8000-000000000004'::uuid, 6),   -- Shabbat lunch
  ('5b2c1e10-0001-4d00-8000-000000000005'::uuid, 8),   -- Rosh Hashanah
  ('5b2c1e10-0001-4d00-8000-000000000006'::uuid, 8),   -- Yom Kippur break-fast
  ('5b2c1e10-0001-4d00-8000-000000000007'::uuid, 8),   -- Sukkot
  ('5b2c1e10-0001-4d00-8000-000000000008'::uuid, 6),   -- Chanukah
  ('5b2c1e10-0001-4d00-8000-000000000009'::uuid, 8),   -- Purim seudah
  ('5b2c1e10-0001-4d00-8000-000000000010'::uuid, 10),  -- Pesach seder
  ('5b2c1e10-0001-4d00-8000-000000000011'::uuid, 6)    -- Shavuot
) as v(id, people)
where meal_templates.id = v.id and meal_templates.is_builtin and meal_templates.people = 4;
