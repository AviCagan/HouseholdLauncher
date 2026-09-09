-- Household Launcher — Meals
--
-- Safe to run more than once. Run it after 015_launcher.sql.
--
-- ---------------------------------------------------------------------------
-- What this adds
--
-- Three tables, and the relationship between them is the whole design:
--
--   dishes          One thing you cook. A recipe, with what goes in it, how to
--                   make it, what it costs and what's in it nutritionally.
--   meal_templates  The *shape* of an occasion — "Shabbat dinner is challah,
--                   fish, soup, a main, two sides and dessert" — as a list of
--                   slots, with no particular dishes in them.
--   meals           An actual meal: a template's slots filled with dishes, or
--                   an ad-hoc set. Cost and nutrition are derived from the
--                   dishes in it, never stored, so editing a dish's price
--                   corrects every meal it has ever been part of.
--
-- Dishes are referenced from meals by id inside a jsonb array rather than a
-- join table. The alternative — meal_dishes(meal_id, dish_id, slot) — is the
-- textbook answer and the wrong one here: a meal is edited as a unit (fill the
-- slots, save), it is loaded as a unit, and realtime delivers it as a unit.
-- One row per meal means one change event per edit rather than a burst of
-- inserts and deletes the other phone has to reassemble in the right order.
-- ---------------------------------------------------------------------------

-- ---------------------------------------------------------------------------
-- Dishes
-- ---------------------------------------------------------------------------
create table if not exists dishes (
  id           uuid primary key,
  name         text not null check (length(trim(name)) > 0),
  -- The picture, for an app that is meant to look like a picture book. A
  -- single emoji is enough and never needs a storage bucket.
  emoji        text not null default '🍽️',
  -- What role it plays on the table, which is what templates slot by.
  kind         text not null default 'main' check (kind in (
                 'main', 'side', 'soup', 'salad', 'bread', 'dessert',
                 'drink', 'snack', 'other')),
  -- [{ name, amount, cost_cents }]. `amount` is free text ("2 cups", "a
  -- pinch") because normalising recipe quantities is a research problem and
  -- nobody is going to sum them anyway.
  ingredients  jsonb not null default '[]'::jsonb,
  -- ["Preheat the oven…", …]
  steps        jsonb not null default '[]'::jsonb,
  servings     integer not null default 4 check (servings > 0),
  -- What the whole dish costs to make, in integer cents. Null means "not
  -- entered", which the UI shows as a blank rather than as $0.
  cost_cents   integer check (cost_cents is null or cost_cents >= 0),
  -- Per serving: { calories, protein_g, carbs_g, fat_g, fiber_g, sodium_mg }.
  -- Any key may be absent. Stored per serving rather than per dish because
  -- that is how every recipe site and every label reports it.
  nutrition    jsonb not null default '{}'::jsonb,
  source_url   text,
  source_kind  text not null default 'manual'
                 check (source_kind in ('manual', 'web', 'instagram')),
  image_url    text,
  notes        text,
  tags         text[] not null default '{}',
  created_by   uuid references profiles(id) on delete set null,
  updated_by   uuid references profiles(id) on delete set null,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

create index if not exists dishes_kind_idx on dishes (kind, name);

-- ---------------------------------------------------------------------------
-- Templates
-- ---------------------------------------------------------------------------
create table if not exists meal_templates (
  id           uuid primary key,
  name         text not null check (length(trim(name)) > 0),
  emoji        text not null default '🍽️',
  -- A short tag the meals list groups by: 'weeknight', 'special', 'shabbat',
  -- 'holiday'. Free text on purpose — the built-ins use these, but a
  -- "Sunday brunch" template can say 'brunch' without a migration.
  occasion     text not null default 'dinner',
  -- [{ role, label }]. `role` matches dishes.kind so the picker can suggest
  -- the right dishes for a slot; `label` is what the slot is called on this
  -- occasion ("Round challah", not just "bread").
  slots        jsonb not null default '[]'::jsonb,
  -- Seeded by this migration. Editable like any other, but never deleted by
  -- a re-run, and shown with a little badge so a custom one can be told apart.
  is_builtin   boolean not null default false,
  sort_order   double precision not null default extract(epoch from now()),
  created_by   uuid references profiles(id) on delete set null,
  updated_by   uuid references profiles(id) on delete set null,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- Meals
-- ---------------------------------------------------------------------------
create table if not exists meals (
  id           uuid primary key,
  name         text not null check (length(trim(name)) > 0),
  emoji        text not null default '🍽️',
  occasion     text not null default 'dinner',
  -- Where the slots came from. Nullable and set-null on delete: a meal
  -- outlives the template it was built from.
  template_id  uuid references meal_templates(id) on delete set null,
  -- Optional. A saved combination doesn't need a date; a plan for Friday does.
  planned_for  date,
  -- [{ role, label, dish_id }]. The template's slots, each filled or not.
  courses      jsonb not null default '[]'::jsonb,
  notes        text,
  created_by   uuid references profiles(id) on delete set null,
  updated_by   uuid references profiles(id) on delete set null,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

create index if not exists meals_planned_idx on meals (planned_for desc nulls last, created_at desc);

-- ---------------------------------------------------------------------------
-- updated_at, kept honest by the database rather than by every caller.
-- ---------------------------------------------------------------------------
create or replace function meals_touch() returns trigger
language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end $$;

do $$
declare t text;
begin
  foreach t in array array['dishes', 'meal_templates', 'meals'] loop
    execute format('drop trigger if exists %I_touch on %I', t, t);
    execute format(
      'create trigger %I_touch before update on %I
         for each row execute function meals_touch()', t, t);
  end loop;
end $$;

-- ---------------------------------------------------------------------------
-- Row level security
--
-- All three are app-scoped on 'meals', same as the Owe list is on 'owe': a
-- member without the grant cannot read a single row. Both owners have every
-- app unconditionally, so Avi and Jackie can each add and edit everything.
-- ---------------------------------------------------------------------------
do $$
declare t text;
begin
  foreach t in array array['dishes', 'meal_templates', 'meals'] loop
    execute format('alter table %I enable row level security', t);
    execute format('drop policy if exists %I_rw on %I', t, t);
    execute format(
      'create policy %I_rw on %I for all
         to authenticated using (has_app(''meals'')) with check (has_app(''meals''))', t, t);
  end loop;
end $$;

-- ---------------------------------------------------------------------------
-- Realtime, so a dish Jackie imports appears on Avi's phone without a reload.
-- ---------------------------------------------------------------------------
do $$
declare t text;
begin
  foreach t in array array['dishes', 'meal_templates', 'meals'] loop
    execute format('alter table %I replica identity full', t);
    begin
      execute format('alter publication supabase_realtime add table %I', t);
    exception when duplicate_object then
      null;
    end;
  end loop;
end $$;

-- ---------------------------------------------------------------------------
-- Notifications. INSERT only: a meal being planned or a dish being added is
-- news; someone fixing a typo in the ingredients is not.
-- ---------------------------------------------------------------------------
do $$
begin
  if exists (select 1 from pg_proc where proname = 'notify_change') then
    drop trigger if exists dishes_notify on dishes;
    create trigger dishes_notify
      after insert on dishes
      for each row execute function notify_change();
    drop trigger if exists meals_notify on meals;
    create trigger meals_notify
      after insert on meals
      for each row execute function notify_change();
  else
    raise notice
      'notify_change() not found — run 005_notifications.sql to get notifications.';
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- Built-in templates
--
-- Fixed ids so a re-run inserts nothing and never duplicates. The slot lists
-- are a starting point, not doctrine: every one is editable in the app, and
-- the labels are what the slot is called at *this* table.
-- ---------------------------------------------------------------------------
insert into meal_templates (id, name, emoji, occasion, slots, is_builtin, sort_order) values
  ('5b2c1e10-0001-4d00-8000-000000000001', 'Weeknight dinner', '🍝', 'weeknight',
   '[{"role":"main","label":"Main"},{"role":"side","label":"Side"},{"role":"salad","label":"Something green"}]', true, 1),

  ('5b2c1e10-0001-4d00-8000-000000000002', 'Special dinner', '✨', 'special',
   '[{"role":"soup","label":"Starter"},{"role":"main","label":"Main"},{"role":"side","label":"Side"},{"role":"side","label":"Side"},{"role":"dessert","label":"Dessert"}]', true, 2),

  ('5b2c1e10-0001-4d00-8000-000000000003', 'Shabbat dinner', '🕯️', 'shabbat',
   '[{"role":"bread","label":"Challah"},{"role":"main","label":"Fish"},{"role":"soup","label":"Soup"},{"role":"main","label":"Main"},{"role":"side","label":"Side"},{"role":"side","label":"Side"},{"role":"dessert","label":"Dessert"}]', true, 3),

  ('5b2c1e10-0001-4d00-8000-000000000004', 'Shabbat lunch', '☀️', 'shabbat',
   '[{"role":"bread","label":"Challah"},{"role":"main","label":"Fish"},{"role":"salad","label":"Salads"},{"role":"main","label":"Cholent or main"},{"role":"side","label":"Side"},{"role":"dessert","label":"Dessert"}]', true, 4),

  ('5b2c1e10-0001-4d00-8000-000000000005', 'Rosh Hashanah', '🍎', 'holiday',
   '[{"role":"bread","label":"Round challah"},{"role":"snack","label":"Apples & honey"},{"role":"main","label":"Fish"},{"role":"soup","label":"Soup"},{"role":"main","label":"Main"},{"role":"side","label":"Tzimmes"},{"role":"side","label":"Side"},{"role":"dessert","label":"Honey cake"}]', true, 5),

  ('5b2c1e10-0001-4d00-8000-000000000006', 'Yom Kippur break-fast', '🥯', 'holiday',
   '[{"role":"bread","label":"Bagels & lox"},{"role":"side","label":"Kugel"},{"role":"salad","label":"Salads"},{"role":"drink","label":"Something to drink"},{"role":"dessert","label":"Dessert"}]', true, 6),

  ('5b2c1e10-0001-4d00-8000-000000000007', 'Sukkot', '🍂', 'holiday',
   '[{"role":"bread","label":"Challah"},{"role":"soup","label":"Soup"},{"role":"main","label":"Stuffed main"},{"role":"side","label":"Side"},{"role":"side","label":"Side"},{"role":"dessert","label":"Dessert"}]', true, 7),

  ('5b2c1e10-0001-4d00-8000-000000000008', 'Chanukah', '🕎', 'holiday',
   '[{"role":"side","label":"Latkes"},{"role":"main","label":"Main"},{"role":"salad","label":"Salad"},{"role":"dessert","label":"Sufganiyot"}]', true, 8),

  ('5b2c1e10-0001-4d00-8000-000000000009', 'Purim seudah', '🎭', 'holiday',
   '[{"role":"bread","label":"Challah"},{"role":"main","label":"Main"},{"role":"side","label":"Side"},{"role":"side","label":"Side"},{"role":"dessert","label":"Hamantaschen"}]', true, 9),

  ('5b2c1e10-0001-4d00-8000-000000000010', 'Pesach seder', '🍷', 'holiday',
   '[{"role":"other","label":"Seder plate"},{"role":"bread","label":"Matzah"},{"role":"main","label":"Gefilte fish"},{"role":"soup","label":"Matzah ball soup"},{"role":"main","label":"Main"},{"role":"side","label":"Side"},{"role":"side","label":"Side"},{"role":"dessert","label":"Dessert"}]', true, 10),

  ('5b2c1e10-0001-4d00-8000-000000000011', 'Shavuot', '🧀', 'holiday',
   '[{"role":"main","label":"Blintzes or dairy main"},{"role":"salad","label":"Salad"},{"role":"side","label":"Side"},{"role":"dessert","label":"Cheesecake"}]', true, 11)
on conflict (id) do nothing;
