-- Things — complete database setup, in one paste.
--
-- Copy this whole file into the Supabase SQL Editor and hit Run, once.
-- It is the same content as 001-004 and 006-014 run in order; those are
-- kept separate for readability, this is here so setup — and catching a
-- database up after a feature update — is a single step.
--
-- Safe to run more than once: every statement is idempotent, including on a
-- database that already has some of these tables. `create table if not
-- exists` alone would NOT be enough for that second case — it is a silent
-- no-op on a table that already exists, so a column added to a CREATE TABLE
-- block after the table was first created would never actually arrive. The
-- `alter table ... add column if not exists` statements later in this file
-- are what make re-running it actually catch a table up, not just the parts
-- of it that happen to be brand new.

-- ==========================================================================
-- 001_schema.sql
-- ==========================================================================

-- Things — schema
-- Run this in the Supabase SQL editor, then 002_rls.sql, 003_realtime.sql,
-- 004_seed.sql in order. See supabase/README.md for the full setup.

create extension if not exists pgcrypto;

-- ---------------------------------------------------------------------------
-- Profiles
--
-- These are APP-level identities, deliberately decoupled from Supabase Auth.
-- Both phones share one auth account (unlocked once by the PIN), while "who am
-- I" stays a pure tap-your-name choice stored on the device. That is what lets
-- the login screen have no passwords while the database still refuses anon.
-- ---------------------------------------------------------------------------
create table if not exists profiles (
  id           uuid primary key,
  slug         text unique not null check (slug in ('avi', 'jackie')),
  display_name text not null,
  avatar_emoji text not null default '🙂',
  -- Optional photo as a data URI; two users don't justify a storage bucket.
  avatar_url   text,
  color_hex    text not null default '#7c5cff',
  created_at   timestamptz not null default now()
);

create table if not exists profile_settings (
  profile_id        uuid primary key references profiles(id) on delete cascade,
  theme_mode        text not null default 'system'
                      check (theme_mode in ('system','light','dark','oled')),
  accent_hex        text not null default '#7c5cff',
  font_scale        numeric(3,2) not null default 1.00
                      check (font_scale between 0.80 and 1.40),
  haptic_intensity  text not null default 'heavy'
                      check (haptic_intensity in ('off','subtle','normal','heavy')),
  -- Per-event opt-outs, e.g. {"snap": false}. Absent key means enabled.
  haptic_events     jsonb not null default '{}'::jsonb,
  sound_enabled     boolean not null default false,
  reduce_motion     boolean not null default false,
  ios_native_switch boolean not null default true,
  nav_app           text not null default 'google'
                      check (nav_app in ('google','waze','apple')),
  notify_events     jsonb not null default '{}'::jsonb,
  -- Recurrence quick picks, by label. Empty = the built-in set.
  recurrence_presets jsonb not null default '[]'::jsonb,
  -- Unused today. Reserved so SMS can be added without a migration if iOS
  -- Web Push disappoints in practice.
  phone_e164        text,
  updated_at        timestamptz not null default now()
);

-- Single shared row. The CHECK pins it to exactly one.
create table if not exists household_settings (
  singleton    boolean primary key default true check (singleton),
  home_label   text,
  home_address text,
  home_lat     double precision,
  home_lng     double precision,
  -- Days to keep finished items. 0 disables clearing.
  auto_clear_days integer not null default 7,
  -- Secret in the calendar feed URL. null = calendar sync off.
  calendar_token text,
  -- Minutes of warning the calendar gives before a chore is due. 0 = none.
  calendar_alarm_minutes integer not null default 0,
  -- Secret in the voice-add URL (Siri / Google). null = voice adding off.
  -- Separate from calendar_token so revoking one doesn't revoke the other.
  voice_token text,
  updated_at   timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- Lists
--
-- `urgency` is a smallint + CHECK rather than a Postgres enum: enums need a
-- migration to extend and can't be altered inside a transaction. The TS union
-- in src/data/types.ts is the single source of truth.
-- ---------------------------------------------------------------------------
create table if not exists todos (
  id           uuid primary key,
  title        text not null check (length(trim(title)) > 0),
  notes        text,
  urgency      smallint not null default 1 check (urgency between 0 and 3),
  is_done      boolean not null default false,
  claimed_by   uuid references profiles(id) on delete set null,
  created_by   uuid references profiles(id) on delete set null,
  completed_by uuid references profiles(id) on delete set null,
  completed_at timestamptz,
  -- When this is actually due. Null = no deadline, which stays the normal case.
  -- Unlike chores' next_due_at, nothing derives or recomputes this: it is a
  -- date a person chose.
  due_at       timestamptz,
  -- Set only by the edit sheet, so an edit can notify the other person and
  -- the activity log can attribute it. created_by/claimed_by already mean
  -- something more specific, so this stays separate rather than overloaded.
  updated_by   uuid references profiles(id) on delete set null,
  sort_order   double precision not null default extract(epoch from now()),
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

create table if not exists chores (
  id                uuid primary key,
  title             text not null check (length(trim(title)) > 0),
  notes             text,
  urgency           smallint not null default 1 check (urgency between 0 and 3),
  claimed_by        uuid references profiles(id) on delete set null,
  created_by        uuid references profiles(id) on delete set null,
  updated_by        uuid references profiles(id) on delete set null,

  is_recurring      boolean not null default false,
  recurrence_count  integer check (recurrence_count > 0),
  recurrence_unit   text check (recurrence_unit in ('hours','days','weeks','months','years','weekdays')),
  -- Set only when recurrence_unit = 'weekdays'. 0 (Sunday) .. 6 (Saturday) —
  -- matches both JS Date.getDay() and Postgres's own extract(dow from ...).
  recurrence_days   smallint[],

  last_completed_at timestamptz,
  last_completed_by uuid references profiles(id) on delete set null,
  -- Maintained by the trigger below. See the long comment there — this can NOT
  -- be a generated column.
  next_due_at       timestamptz,
  -- Set when a cooldown-ready notification has been sent, so the pg_cron sweep
  -- is idempotent and a retry can't double-notify.
  cooldown_notified_at timestamptz,

  -- One-off chores only; recurring chores never set this.
  is_done           boolean not null default false,

  sort_order        double precision not null default extract(epoch from now()),
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),

  -- A weekday-mode chore has no meaningful count, and every other mode has no
  -- meaningful day set — enforced so the two shapes can never be set together
  -- or left half-filled.
  constraint recurrence_complete check (
    (not is_recurring
      and recurrence_count is null and recurrence_unit is null and recurrence_days is null)
    or (is_recurring and recurrence_unit = 'weekdays'
      and recurrence_count is null
      and recurrence_days is not null and cardinality(recurrence_days) > 0)
    or (is_recurring and recurrence_unit <> 'weekdays'
      and recurrence_count is not null and recurrence_days is null)
  )
);

create table if not exists stores (
  id             uuid primary key,
  name           text not null check (length(trim(name)) > 0),
  is_online      boolean not null default false,
  url            text,
  address        text,
  lat            double precision,
  lng            double precision,
  geocoded_at    timestamptz,
  geocode_source text check (geocode_source in ('photon','nominatim','manual')),
  color_hex      text not null default '#4a9d7e',
  emoji          text,
  sort_order     double precision not null default extract(epoch from now()),
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),

  -- Belt and braces: an online store can never carry coordinates, so it can
  -- never sneak into a driving route even if the UI filter were bypassed.
  constraint online_has_no_coords
    check (not is_online or (lat is null and lng is null))
);

create table if not exists shopping_items (
  id           uuid primary key,
  store_id     uuid references stores(id) on delete set null,
  title        text not null check (length(trim(title)) > 0),
  quantity     text,
  urgency      smallint not null default 1 check (urgency between 0 and 3),
  is_done      boolean not null default false,
  claimed_by   uuid references profiles(id) on delete set null,
  created_by   uuid references profiles(id) on delete set null,
  updated_by   uuid references profiles(id) on delete set null,
  completed_at timestamptz,
  -- A product link for an online-store item, the same way wishlist items
  -- carry one — paste a URL and the unfurl function fills in the rest.
  url          text,
  image_url    text,
  price_cents  integer check (price_cents is null or price_cents >= 0),
  sort_order   double precision not null default extract(epoch from now()),
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

create table if not exists wishlist_items (
  id           uuid primary key,
  title        text not null check (length(trim(title)) > 0),
  notes        text,
  url          text,
  price_cents  integer check (price_cents >= 0),
  image_url    text,
  desire_level smallint not null default 3 check (desire_level between 1 and 5),
  owner_id     uuid references profiles(id) on delete set null,
  is_purchased boolean not null default false,
  purchased_at timestamptz,
  created_by   uuid references profiles(id) on delete set null,
  updated_by   uuid references profiles(id) on delete set null,
  sort_order   double precision not null default extract(epoch from now()),
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

-- A plain-language feed of what changed, independent of push delivery — a
-- push can be missed or never registered correctly; this is a record either
-- of you can open and scroll regardless.
create table if not exists activity_log (
  id         uuid primary key default gen_random_uuid(),
  table_name text not null check (table_name in ('todos','chores','shopping_items','wishlist_items')),
  row_id     uuid not null,
  title      text not null,
  event      text not null check (event in
    ('added','edited','completed','uncompleted','claimed','unclaimed','deleted')),
  actor_id   uuid references profiles(id) on delete set null,
  created_at timestamptz not null default now()
);

create index if not exists activity_log_created_idx on activity_log (created_at desc);

-- Permanent geocode cache. Combined with denormalising lat/lng onto `stores`,
-- steady-state trip planning makes zero requests to the free geocoders.
create table if not exists geocode_cache (
  query_norm   text primary key,
  lat          double precision not null,
  lng          double precision not null,
  display_name text,
  provider     text not null,
  created_at   timestamptz not null default now()
);

create table if not exists shopping_trips (
  id               uuid primary key,
  created_by       uuid references profiles(id) on delete set null,
  stops            jsonb not null,
  ordered_index    integer[] not null,
  total_distance_m integer,
  total_duration_s integer,
  routed_with      text not null check (routed_with in ('osrm','haversine')),
  created_at       timestamptz not null default now()
);

-- One row per device per person; both of you can have several.
create table if not exists push_subscriptions (
  id           uuid primary key default gen_random_uuid(),
  profile_id   uuid not null references profiles(id) on delete cascade,
  platform     text not null check (platform in ('fcm','webpush')),
  -- FCM registration token
  token        text,
  -- Web Push subscription
  endpoint     text,
  p256dh       text,
  auth         text,
  user_agent   text,
  last_seen_at timestamptz not null default now(),
  created_at   timestamptz not null default now(),

  constraint push_shape check (
    (platform = 'fcm'     and token    is not null) or
    (platform = 'webpush' and endpoint is not null and p256dh is not null and auth is not null)
  )
);

-- Plain unique indexes, deliberately NOT partial (`where platform = 'fcm'`
-- etc). Postgres refuses to plan `ON CONFLICT (token)` against a partial
-- index unless the ON CONFLICT clause repeats the exact predicate — which the
-- Supabase client's `.upsert({ onConflict: 'token' })` has no way to do. A
-- partial index here means every single upsert fails at plan time, silently,
-- because nothing downstream checks the returned error either. A plain index
-- needs no such predicate: NULL is never equal to NULL under uniqueness, so
-- the many webpush rows (token always null) never collide with each other,
-- and the same holds for fcm rows on endpoint.
create unique index if not exists push_fcm_token_idx
  on push_subscriptions (token);
create unique index if not exists push_webpush_endpoint_idx
  on push_subscriptions (endpoint);

-- ---------------------------------------------------------------------------
-- Triggers
-- ---------------------------------------------------------------------------

create or replace function set_updated_at() returns trigger
language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end $$;

/*
  next_due_at MUST be maintained by a trigger, not a generated column.

  Postgres requires GENERATED ALWAYS AS expressions to be IMMUTABLE, and the
  timestamptz + interval operator is only STABLE — adding days or months
  depends on the session TimeZone because of DST. So

      next_due_at timestamptz GENERATED ALWAYS AS
        (last_completed_at + make_interval(...)) STORED

  is rejected outright. The trigger below does the same job, and the stored
  column remains indexable and sortable.

  Note also what this column does NOT do: when a cooldown expires, no row
  changes, so Postgres emits no realtime event. Clients derive "is resting"
  themselves from next_due_at against a local ticker.
*/
create or replace function compute_next_due() returns trigger
language plpgsql as $$
declare
  step int;
  candidate timestamptz;
begin
  if new.is_recurring and new.last_completed_at is not null then
    if new.recurrence_unit = 'weekdays' then
      -- Walk forward at most 7 days to the next one that falls on a selected
      -- weekday. A loop rather than arithmetic: "next Tuesday or Wednesday,
      -- whichever comes first, from an arbitrary weekday" has no closed form
      -- worth the complexity at 7 iterations.
      new.next_due_at := null;
      for step in 1..7 loop
        candidate := new.last_completed_at + (step || ' days')::interval;
        if extract(dow from candidate)::int = any(new.recurrence_days) then
          new.next_due_at := candidate;
          exit;
        end if;
      end loop;
    else
      new.next_due_at := new.last_completed_at + make_interval(
        hours  => case when new.recurrence_unit = 'hours'  then new.recurrence_count else 0 end,
        days   => case when new.recurrence_unit = 'days'   then new.recurrence_count else 0 end,
        weeks  => case when new.recurrence_unit = 'weeks'  then new.recurrence_count else 0 end,
        months => case when new.recurrence_unit = 'months' then new.recurrence_count else 0 end,
        years  => case when new.recurrence_unit = 'years'  then new.recurrence_count else 0 end
      );
    end if;
  else
    new.next_due_at := null;
  end if;
  new.updated_at := now();
  return new;
end $$;

drop trigger if exists chores_next_due on chores;
create trigger chores_next_due
  before insert or update on chores
  for each row execute function compute_next_due();

do $$
declare t text;
begin
  foreach t in array array[
    'todos','shopping_items','stores','wishlist_items',
    'profile_settings','household_settings'
  ] loop
    execute format('drop trigger if exists %I_updated_at on %I', t, t);
    execute format(
      'create trigger %I_updated_at before update on %I
         for each row execute function set_updated_at()', t, t);
  end loop;
end $$;

/*
  The activity log's trigger. Deliberately does its own transition detection
  in plpgsql rather than sharing code with the Edge Function's classify() —
  different runtime, different job: classify() decides who to push to and
  what the notification says, this just decides what sentence goes in the
  in-app feed. Keeping them separate means a change to push copy can't
  accidentally break the log or vice versa.
*/
create or replace function log_activity() returns trigger
language plpgsql as $$
declare
  evt text;
  actor uuid;
  item_title text;
  item_id uuid;
begin
  if tg_op = 'INSERT' then
    evt := 'added';
    actor := new.created_by;
    item_title := new.title;
    item_id := new.id;

  elsif tg_op = 'DELETE' then
    evt := 'deleted';
    item_title := old.title;
    item_id := old.id;
    -- No session identity survives a delete — best-effort attribution to
    -- whoever last touched the row. claimed_by only exists on three of the
    -- four tables this trigger runs on, so it has to sit behind its own
    -- table check rather than in one coalesce() that assumes every row
    -- shares the same columns.
    actor := old.updated_by;
    if actor is null and tg_table_name in ('todos','chores','shopping_items') then
      actor := old.claimed_by;
    end if;
    if actor is null then
      actor := old.created_by;
    end if;

  elsif tg_op = 'UPDATE' then
    item_title := new.title;
    item_id := new.id;

    /*
      Every table-specific field access sits inside a nested IF whose OWN
      condition references only tg_table_name/evt, with the field access
      strictly in the body. That distinction matters and it's not stylistic:
      old/new are the generic trigger RECORD type here, not a fixed row type,
      and PL/pgSQL resolves a record field reference by preparing the whole
      boolean expression it appears in as a single SPI query before any
      short-circuiting happens. That means `tg_table_name = 'chores' and
      old.last_completed_by is distinct from new.last_completed_by` throws
      "record has no field" on a todos row EVEN THOUGH the first operand is
      false — folding the table check and the field access into one
      condition (as an earlier version of this function did) reproduces
      exactly the bug this comment is warning about. Only an outer IF whose
      condition is table-check-only, wrapping an inner statement that
      references the field, is genuine control flow that skips evaluating it.
    */

    -- Completion checks run before the claimed/unclaimed check below,
    -- deliberately: completeChore() sets last_completed_by AND clears
    -- claimed_by in the same UPDATE (see the cooldown design above), so if
    -- claimed/unclaimed were checked first every chore completion would log
    -- as "unclaimed" instead of "completed". Checking completion first means
    -- an event that changes both is reported as the more informative one.

    if evt is null and tg_table_name in ('todos','shopping_items') then
      if old.is_done is distinct from new.is_done then
        evt := case when new.is_done then 'completed' else 'uncompleted' end;
        actor := new.updated_by;
        if actor is null and tg_table_name in ('todos','chores','shopping_items') then
          actor := new.claimed_by;
        end if;
        if actor is null then
          actor := new.created_by;
        end if;
      end if;
    end if;

    if evt is null and tg_table_name = 'chores' then
      if old.last_completed_by is distinct from new.last_completed_by
        and new.last_completed_by is not null then
        evt := 'completed';
        actor := new.last_completed_by;
      end if;
    end if;

    if evt is null and tg_table_name = 'wishlist_items' then
      if old.is_purchased is distinct from new.is_purchased then
        evt := case when new.is_purchased then 'completed' else 'uncompleted' end;
        actor := coalesce(new.updated_by, new.created_by);
      end if;
    end if;

    if evt is null and tg_table_name in ('todos','chores','shopping_items') then
      if (old.claimed_by is null) <> (new.claimed_by is null) then
        if new.claimed_by is not null then
          evt := 'claimed';
          actor := new.claimed_by;
        else
          evt := 'unclaimed';
          actor := old.claimed_by;
        end if;
      end if;
    end if;

    if evt is null and new.updated_by is not null
      and old.updated_by is distinct from new.updated_by then
      evt := 'edited';
      actor := new.updated_by;
    end if;

    if evt is null then
      -- Nothing log-worthy — e.g. sort_order shuffling from a drag, or the
      -- ticker touching next_due_at. Silently skip rather than logging noise.
      return coalesce(new, old);
    end if;
  end if;

  insert into activity_log (table_name, row_id, title, event, actor_id)
  values (tg_table_name, item_id, item_title, evt, actor);

  return coalesce(new, old);
end $$;

do $$
declare t text;
begin
  foreach t in array array['todos','chores','shopping_items','wishlist_items'] loop
    execute format('drop trigger if exists %I_activity on %I', t, t);
    execute format(
      'create trigger %I_activity after insert or update or delete on %I
         for each row execute function log_activity()', t, t);
  end loop;
end $$;

-- ---------------------------------------------------------------------------
-- Indices
-- ---------------------------------------------------------------------------
create index if not exists todos_active_idx    on todos (is_done, urgency desc, sort_order);
create index if not exists chores_due_idx      on chores (next_due_at nulls first);
create index if not exists chores_active_idx   on chores (is_done, urgency desc, sort_order);
create index if not exists shopping_store_idx  on shopping_items (store_id, is_done, sort_order);
create index if not exists shopping_active_idx on shopping_items (is_done, urgency desc);
create index if not exists wishlist_desire_idx on wishlist_items (is_purchased, desire_level desc);
create index if not exists stores_routable_idx on stores (is_online, sort_order);
create index if not exists push_profile_idx    on push_subscriptions (profile_id);


-- ==========================================================================
-- 006_avatars.sql, 007_list_settings.sql, 008_calendar.sql, 009_weekday_recurrence.sql, 010_fix_push_upsert.sql, 011_activity_and_edits.sql, 012_voice_token.sql, 013_ios_haptics.sql, 014_todo_deadlines.sql
-- ==========================================================================

-- Things — profile photos
--
-- Run this once in the SQL Editor if your database was created before this
-- feature existed. Safe to run more than once.
--
-- The photo is stored as a data URI rather than in a storage bucket: two users
-- do not justify configuring buckets and policies, and the app downscales the
-- image to a small square before saving, so the row stays modest.

alter table profiles add column if not exists avatar_url text;


-- Things — later additions
--
-- Run once in the SQL Editor if your database predates these features.
-- Safe to run more than once.

-- How long finished to-dos and bought shopping items stick around before the
-- app clears them. 0 disables clearing. Shared, because it changes the data
-- both of you see rather than just how it looks.
alter table household_settings
  add column if not exists auto_clear_days integer not null default 7;

-- Which recurrence presets each person wants as quick picks, by label.
-- An empty array means "show the built-in set".
alter table profile_settings
  add column if not exists recurrence_presets jsonb not null default '[]'::jsonb;

-- Yearly recurrence. Without these two, Supabase rejects a chore set to
-- repeat in years: the CHECK refuses the value, and the trigger would compute
-- a null next_due_at even if it got through.
alter table chores drop constraint if exists chores_recurrence_unit_check;
alter table chores add constraint chores_recurrence_unit_check
  check (recurrence_unit in ('hours','days','weeks','months','years'));

create or replace function compute_next_due() returns trigger
language plpgsql as $$
begin
  if new.is_recurring and new.last_completed_at is not null then
    new.next_due_at := new.last_completed_at + make_interval(
      hours  => case when new.recurrence_unit = 'hours'  then new.recurrence_count else 0 end,
      days   => case when new.recurrence_unit = 'days'   then new.recurrence_count else 0 end,
      weeks  => case when new.recurrence_unit = 'weeks'  then new.recurrence_count else 0 end,
      months => case when new.recurrence_unit = 'months' then new.recurrence_count else 0 end,
      years  => case when new.recurrence_unit = 'years'  then new.recurrence_count else 0 end
    );
  else
    new.next_due_at := null;
  end if;
  new.updated_at := now();
  return new;
end $$;


-- Things — Google Calendar sync for recurring chores
--
-- Run once in the SQL Editor. Safe to run more than once.
--
-- The app publishes recurring chores as an iCalendar feed that Google Calendar
-- subscribes to by URL. There is no OAuth and no Google account linking: the
-- feed is a plain HTTPS URL, and the only thing protecting it is the random
-- token below. That is why the token is a column rather than a fixed secret —
-- if the URL ever leaks, regenerating it here revokes the old one instantly.
--
-- null token = sync switched off. The Edge Function refuses every request in
-- that state, so turning it off in Settings genuinely turns the feed off.

alter table household_settings
  add column if not exists calendar_token text;

-- How long before a chore is due Google should remind you, in minutes.
-- 0 means no reminder — the event still appears, it just doesn't alert.
alter table household_settings
  add column if not exists calendar_alarm_minutes integer not null default 0;

-- The token is looked up on every calendar poll, and Google polls a feed for
-- as long as the subscription exists.
create index if not exists household_settings_calendar_token_idx
  on household_settings (calendar_token)
  where calendar_token is not null;


-- Things — day-of-week recurrence for chores
--
-- Adds a second recurrence mode alongside "every N hours/days/weeks/months/
-- years": specific days of the week, e.g. laundry every Tuesday and
-- Wednesday, or trash every Sunday, Thursday and Friday. The interval model
-- (count + unit) cannot express that — "every 2 days" and "every Tue + Wed"
-- are genuinely different shapes, not two phrasings of the same rule.
--
-- Run once in the SQL Editor if your database predates this feature. Safe to
-- run more than once. Already folded into setup.sql for anyone re-pasting
-- that file.

-- 0 (Sunday) .. 6 (Saturday), matching both JS Date.getDay() and Postgres's
-- own extract(dow from ...) — no conversion table needed on either side.
alter table chores add column if not exists recurrence_days smallint[];

alter table chores drop constraint if exists chores_recurrence_unit_check;
alter table chores add constraint chores_recurrence_unit_check
  check (recurrence_unit in ('hours','days','weeks','months','years','weekdays'));

-- A weekday-mode chore has no meaningful count, and every other mode has no
-- meaningful day set — enforced so the two shapes can never be set together
-- or left half-filled.
alter table chores drop constraint if exists recurrence_complete;
alter table chores add constraint recurrence_complete check (
  (not is_recurring
    and recurrence_count is null and recurrence_unit is null and recurrence_days is null)
  or (is_recurring and recurrence_unit = 'weekdays'
    and recurrence_count is null
    and recurrence_days is not null and cardinality(recurrence_days) > 0)
  or (is_recurring and recurrence_unit <> 'weekdays'
    and recurrence_count is not null and recurrence_days is null)
);

-- The trigger picks up a second branch: given the days just completed on,
-- walk forward at most 7 days to the next one that falls on a selected
-- weekday. A loop rather than arithmetic because "next Tuesday or Wednesday,
-- whichever comes first, from an arbitrary weekday" has no closed form worth
-- the complexity at 7 iterations.
create or replace function compute_next_due() returns trigger
language plpgsql as $$
declare
  step int;
  candidate timestamptz;
begin
  if new.is_recurring and new.last_completed_at is not null then
    if new.recurrence_unit = 'weekdays' then
      new.next_due_at := null;
      for step in 1..7 loop
        candidate := new.last_completed_at + (step || ' days')::interval;
        if extract(dow from candidate)::int = any(new.recurrence_days) then
          new.next_due_at := candidate;
          exit;
        end if;
      end loop;
    else
      new.next_due_at := new.last_completed_at + make_interval(
        hours  => case when new.recurrence_unit = 'hours'  then new.recurrence_count else 0 end,
        days   => case when new.recurrence_unit = 'days'   then new.recurrence_count else 0 end,
        weeks  => case when new.recurrence_unit = 'weeks'  then new.recurrence_count else 0 end,
        months => case when new.recurrence_unit = 'months' then new.recurrence_count else 0 end,
        years  => case when new.recurrence_unit = 'years'  then new.recurrence_count else 0 end
      );
    end if;
  else
    new.next_due_at := null;
  end if;
  new.updated_at := now();
  return new;
end $$;


-- Things — fix push subscriptions never actually saving
--
-- Run once in the SQL Editor if your database predates this fix. Safe to run
-- more than once.
--
-- The two indexes below were PARTIAL (`where platform = 'fcm'` / `'webpush'`).
-- Postgres will not plan `insert ... on conflict (token) do update ...`
-- against a partial index unless the ON CONFLICT clause repeats that exact
-- predicate — and the Supabase JS client's `.upsert({ onConflict: 'token' })`
-- has no option to do that. The result: every single push registration
-- failed at the database level, on every device, from the very first one.
-- Nothing surfaced it because the client code never checked the returned
-- error either (fixed separately, in src/lib/notifications.ts) — so
-- Settings showed "Notifications are on" while push_subscriptions stayed
-- empty the whole time.
--
-- A plain (non-partial) index works identically here: NULL is never equal to
-- NULL under a unique index, so the many webpush rows — every one of them
-- with token = null — never collide with each other, and the same holds for
-- fcm rows on endpoint. Nothing about the actual uniqueness guarantee
-- changes; only ON CONFLICT's ability to target the index does.

drop index if exists push_fcm_token_idx;
drop index if exists push_webpush_endpoint_idx;

create unique index if not exists push_fcm_token_idx
  on push_subscriptions (token);
create unique index if not exists push_webpush_endpoint_idx
  on push_subscriptions (endpoint);


-- Things — edit tracking, online-store links, and the activity log
--
-- Run once in the SQL Editor if your database predates these features. Safe
-- to run more than once.

-- ---------------------------------------------------------------------------
-- Who last edited a row, so an edit can notify the other person and the
-- activity log can attribute it. Separate from created_by/claimed_by/
-- last_completed_by, which each mean something more specific already.
-- ---------------------------------------------------------------------------
alter table todos           add column if not exists updated_by uuid references profiles(id) on delete set null;
alter table chores          add column if not exists updated_by uuid references profiles(id) on delete set null;
alter table shopping_items  add column if not exists updated_by uuid references profiles(id) on delete set null;
alter table wishlist_items  add column if not exists updated_by uuid references profiles(id) on delete set null;

-- ---------------------------------------------------------------------------
-- Online-store shopping items can now carry a link, the same way wishlist
-- items already do — paste a product URL and the unfurl function fills in
-- the title, photo and price.
-- ---------------------------------------------------------------------------
alter table shopping_items add column if not exists url text;
alter table shopping_items add column if not exists image_url text;
alter table shopping_items add column if not exists price_cents integer;
alter table shopping_items drop constraint if exists shopping_items_price_cents_check;
alter table shopping_items add constraint shopping_items_price_cents_check
  check (price_cents is null or price_cents >= 0);

-- ---------------------------------------------------------------------------
-- Activity log — a plain-language feed of what changed, independent of push
-- delivery. A push can be missed, throttled, or never registered correctly
-- (see 010_fix_push_upsert.sql for exactly that); this is a record either of
-- you can open in-app and scroll, not something that has to arrive to exist.
-- ---------------------------------------------------------------------------
create table if not exists activity_log (
  id         uuid primary key default gen_random_uuid(),
  table_name text not null check (table_name in ('todos','chores','shopping_items','wishlist_items')),
  row_id     uuid not null,
  title      text not null,
  -- What happened, in the household's own words rather than a raw DB verb.
  event      text not null check (event in
    ('added','edited','completed','uncompleted','claimed','unclaimed','deleted')),
  actor_id   uuid references profiles(id) on delete set null,
  created_at timestamptz not null default now()
);

create index if not exists activity_log_created_idx on activity_log (created_at desc);

-- ---------------------------------------------------------------------------
-- The trigger that actually writes the log. Deliberately does its own
-- transition detection in plpgsql rather than sharing code with the Edge
-- Function's classify() — different runtime, different job: classify()
-- decides who to push to and what the notification says, this just decides
-- what sentence goes in the feed. Keeping them separate means a change to
-- push copy can't accidentally break the log or vice versa.
-- ---------------------------------------------------------------------------
create or replace function log_activity() returns trigger
language plpgsql as $$
declare
  evt text;
  actor uuid;
  item_title text;
  item_id uuid;
begin
  if tg_op = 'INSERT' then
    evt := 'added';
    actor := new.created_by;
    item_title := new.title;
    item_id := new.id;

  elsif tg_op = 'DELETE' then
    evt := 'deleted';
    item_title := old.title;
    item_id := old.id;
    -- No session identity survives a delete — best-effort attribution to
    -- whoever last touched the row. claimed_by only exists on three of the
    -- four tables this trigger runs on, so it has to sit behind its own
    -- table check rather than in one coalesce() that assumes every row
    -- shares the same columns.
    actor := old.updated_by;
    if actor is null and tg_table_name in ('todos','chores','shopping_items') then
      actor := old.claimed_by;
    end if;
    if actor is null then
      actor := old.created_by;
    end if;

  elsif tg_op = 'UPDATE' then
    item_title := new.title;
    item_id := new.id;

    /*
      Every table-specific field access sits inside a nested IF whose OWN
      condition references only tg_table_name/evt, with the field access
      strictly in the body. That distinction matters and it's not stylistic:
      old/new are the generic trigger RECORD type here, not a fixed row type,
      and PL/pgSQL resolves a record field reference by preparing the whole
      boolean expression it appears in as a single SPI query before any
      short-circuiting happens. That means `tg_table_name = 'chores' and
      old.last_completed_by is distinct from new.last_completed_by` throws
      "record has no field" on a todos row EVEN THOUGH the first operand is
      false — folding the table check and the field access into one
      condition (as an earlier version of this function did) reproduces
      exactly the bug this comment is warning about. Only an outer IF whose
      condition is table-check-only, wrapping an inner statement that
      references the field, is genuine control flow that skips evaluating it.
    */

    -- Completion checks run before the claimed/unclaimed check below,
    -- deliberately: completeChore() sets last_completed_by AND clears
    -- claimed_by in the same UPDATE (see the cooldown design above), so if
    -- claimed/unclaimed were checked first every chore completion would log
    -- as "unclaimed" instead of "completed". Checking completion first means
    -- an event that changes both is reported as the more informative one.

    if evt is null and tg_table_name in ('todos','shopping_items') then
      if old.is_done is distinct from new.is_done then
        evt := case when new.is_done then 'completed' else 'uncompleted' end;
        actor := new.updated_by;
        if actor is null and tg_table_name in ('todos','chores','shopping_items') then
          actor := new.claimed_by;
        end if;
        if actor is null then
          actor := new.created_by;
        end if;
      end if;
    end if;

    if evt is null and tg_table_name = 'chores' then
      if old.last_completed_by is distinct from new.last_completed_by
        and new.last_completed_by is not null then
        evt := 'completed';
        actor := new.last_completed_by;
      end if;
    end if;

    if evt is null and tg_table_name = 'wishlist_items' then
      if old.is_purchased is distinct from new.is_purchased then
        evt := case when new.is_purchased then 'completed' else 'uncompleted' end;
        actor := coalesce(new.updated_by, new.created_by);
      end if;
    end if;

    if evt is null and tg_table_name in ('todos','chores','shopping_items') then
      if (old.claimed_by is null) <> (new.claimed_by is null) then
        if new.claimed_by is not null then
          evt := 'claimed';
          actor := new.claimed_by;
        else
          evt := 'unclaimed';
          actor := old.claimed_by;
        end if;
      end if;
    end if;

    if evt is null and new.updated_by is not null
      and old.updated_by is distinct from new.updated_by then
      evt := 'edited';
      actor := new.updated_by;
    end if;

    if evt is null then
      -- Nothing log-worthy — e.g. sort_order shuffling from a drag, or the
      -- ticker touching next_due_at. Silently skip rather than logging noise.
      return coalesce(new, old);
    end if;
  end if;

  insert into activity_log (table_name, row_id, title, event, actor_id)
  values (tg_table_name, item_id, item_title, evt, actor);

  return coalesce(new, old);
end $$;

do $$
declare t text;
begin
  foreach t in array array['todos','chores','shopping_items','wishlist_items'] loop
    execute format('drop trigger if exists %I_activity on %I', t, t);
    execute format(
      'create trigger %I_activity after insert or update or delete on %I
         for each row execute function log_activity()', t, t);
  end loop;
end $$;

-- RLS: same posture as everything else — authenticated only.
alter table activity_log enable row level security;
drop policy if exists household_rw on activity_log;
create policy household_rw on activity_log for all
  to authenticated using (true) with check (true);

-- Realtime, so the bell badge updates live rather than on next refetch.
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'activity_log'
  ) then
    execute 'alter publication supabase_realtime add table activity_log';
  end if;
end $$;

alter table activity_log replica identity full;


-- Things — voice adding (Siri / Google Assistant)
--
-- Run once in the SQL Editor if your database predates this feature. Safe to
-- run more than once.

-- ---------------------------------------------------------------------------
-- Secret in the voice-add URL. null means voice adding is off — the Edge
-- Function refuses every request in that state, so this is a real off switch
-- and not just a hidden button. Kept separate from calendar_token so
-- regenerating one doesn't revoke the other.
-- ---------------------------------------------------------------------------
alter table household_settings add column if not exists voice_token text;


-- Things — iOS haptics on by default
--
-- Run once in the SQL Editor if your database predates this. Safe to run more
-- than once.

-- ---------------------------------------------------------------------------
-- `ios_native_switch` now means "use Apple's switch control to produce a real
-- haptic", which is the only way an iPhone gets any haptic feedback at all —
-- iOS has never shipped the Vibration API. It previously described a narrower
-- idea (render the completion checkbox as a native switch) that was never
-- actually implemented: nothing outside the Settings toggle ever read the
-- column, so no stored value carries a real preference.
--
-- That is what makes the backfill safe rather than presumptuous. Changing the
-- column default alone would only affect brand new rows, so the two profiles
-- that already exist would keep the dead `false` and the feature would never
-- reach the phone it was built for.
-- ---------------------------------------------------------------------------
alter table profile_settings alter column ios_native_switch set default true;
update profile_settings set ios_native_switch = true where ios_native_switch = false;


-- Things — deadlines on to-dos
--
-- Run once in the SQL Editor if your database predates this. Safe to run more
-- than once.

-- ---------------------------------------------------------------------------
-- When a to-do is actually due. Null means no deadline, which stays the normal
-- case — most things on the list are "sometime", and forcing a date on them
-- would make the list read as a wall of obligations.
--
-- Deliberately NOT reusing the chores machinery: next_due_at there is derived
-- by a trigger from a recurrence rule and is not something a person sets. This
-- is the opposite — a date someone chose, that nothing recomputes.
-- ---------------------------------------------------------------------------
alter table todos add column if not exists due_at timestamptz;

-- Sorting and "what's overdue" both scan this, and only rows that have one
-- matter, so the index skips the majority that don't.
create index if not exists todos_due_idx on todos (due_at) where due_at is not null;


-- ==========================================================================
-- 002_rls.sql
-- ==========================================================================

-- Things — row level security
--
-- The posture, stated plainly:
--
-- The anon key is NOT a secret. It ships inside the JS bundle, which GitHub
-- Pages serves publicly, so anyone who opens DevTools has it. The only real
-- question is what that key is ALLOWED to do.
--
-- Answer: nothing. Every policy below grants `authenticated` only, and `anon`
-- gets no policy at all. The two phones sign in once each to a single shared
-- household account (unlocked by the PIN), and supabase-js persists and
-- refreshes that session indefinitely — so day to day it is still just
-- "tap your name", and the database is not world-writable.
--
-- IMPORTANT companion step, in the Supabase dashboard:
--   Authentication → Providers → Email → turn OFF "Enable email signups".
-- Otherwise the public anon key can create brand new accounts, and those
-- accounts would then satisfy `to authenticated` and walk straight past the
-- PIN. That toggle is what makes this posture actually hold.

do $$
declare t text;
begin
  foreach t in array array[
    'profiles','profile_settings','household_settings',
    'todos','chores','stores','shopping_items','wishlist_items',
    'geocode_cache','shopping_trips','push_subscriptions','activity_log'
  ] loop
    execute format('alter table %I enable row level security', t);
    execute format('drop policy if exists household_rw on %I', t);
    execute format(
      'create policy household_rw on %I for all
         to authenticated using (true) with check (true)', t);
  end loop;
end $$;


-- ==========================================================================
-- 003_realtime.sql
-- ==========================================================================

-- Things — realtime

/*
  ALTER PUBLICATION ... ADD TABLE has no IF NOT EXISTS form, and re-adding a
  table raises 42710 ("already member of publication"). That aborts the whole
  script, which is why this is a loop with a guard rather than eight bare
  statements — running the setup twice has to be harmless.
*/
do $$
declare t text;
begin
  foreach t in array array[
    'todos','chores','shopping_items','stores','wishlist_items',
    -- profiles belongs here because the client subscribes to it (see TABLES in
    -- src/data/adapter.ts). Without it, changing a name, colour or photo never
    -- reached the other phone until it was backgrounded and reopened.
    'profiles','profile_settings','household_settings','shopping_trips','activity_log'
  ] loop
    if not exists (
      select 1 from pg_publication_tables
      where pubname = 'supabase_realtime'
        and schemaname = 'public'
        and tablename = t
    ) then
      execute format('alter publication supabase_realtime add table %I', t);
    end if;
  end loop;
end $$;

/*
  REPLICA IDENTITY FULL is required, not optional, and specifically because RLS
  is enabled.

  On DELETE, Realtime has to evaluate the row-level policy against the row that
  just disappeared. With the default (primary-key-only) replica identity it has
  too little of the row to do that, so it silently drops the event: inserts and
  updates sync fine, deletes never arrive on the other phone. That is the
  classic "deletes don't sync" bug, and this is the fix.
*/
alter table todos           replica identity full;
alter table chores          replica identity full;
alter table shopping_items  replica identity full;
alter table stores          replica identity full;
alter table wishlist_items  replica identity full;
alter table profile_settings replica identity full;
alter table household_settings replica identity full;
alter table activity_log      replica identity full;
alter table profiles          replica identity full;


-- ==========================================================================
-- 004_seed.sql
-- ==========================================================================

-- Things — seed
--
-- Profile IDs are fixed constants, matching src/store/useProfile.ts. That way
-- claimed_by / created_by references made while the app was running purely on
-- the local adapter still resolve after the switch to Supabase.

insert into profiles (id, slug, display_name, avatar_emoji, color_hex) values
  ('11111111-1111-4111-8111-111111111111', 'avi',    'Avi',    '🦊', '#7c5cff'),
  ('22222222-2222-4222-8222-222222222222', 'jackie', 'Jackie', '🦋', '#ff6ea9')
on conflict (id) do nothing;

-- Jackie navigates with Waze, Avi with Google Maps. Both changeable in-app.
insert into profile_settings (profile_id, accent_hex, nav_app) values
  ('11111111-1111-4111-8111-111111111111', '#7c5cff', 'google'),
  ('22222222-2222-4222-8222-222222222222', '#ff6ea9', 'waze')
on conflict (profile_id) do nothing;

insert into household_settings (singleton, home_label) values (true, 'Home')
on conflict (singleton) do nothing;

-- ==========================================================================
-- 015_launcher.sql
-- ==========================================================================

-- Household Launcher — members, per-app access, notifications
--
-- Safe to run more than once. Run it after 001–014.
--
-- ---------------------------------------------------------------------------
-- What changes about identity
--
-- Things had exactly two people, so "who am I" was a tap on a name and the
-- database only ever saw one shared account unlocked by one shared PIN. The
-- launcher has to hold guests — people who get the Owe list and nothing else —
-- and a client-side "you may not see this" is not access control, it is a
-- suggestion that survives until someone opens DevTools.
--
-- So identity moves into the database. Every member gets their own auth user,
-- their household code is the credential that mints that user's session, and
-- RLS answers "may this session read this table" from the member row the
-- session actually belongs to. `profiles` is extended in place rather than
-- replaced: every claimed_by / created_by / completed_by column in Things
-- already points at it, and a parallel members table would mean either
-- rewriting all of them or keeping two identity tables honest forever.
-- ---------------------------------------------------------------------------

create extension if not exists pgcrypto;

-- ---------------------------------------------------------------------------
-- Profiles, extended
-- ---------------------------------------------------------------------------

-- The slug CHECK pinned the table to exactly ('avi','jackie'). Adding a third
-- person fails outright while it stands, so it goes. The column stays as a
-- stable human-readable handle and keeps its UNIQUE.
alter table profiles drop constraint if exists profiles_slug_check;

alter table profiles
  add column if not exists role text not null default 'member',
  -- Deactivating rather than deleting: a guest who is no longer welcome must
  -- stop being able to sign in WITHOUT taking their name off the four months
  -- of "Jordan paid $40" history that references this row.
  add column if not exists is_active boolean not null default true,
  -- The auth.users row this member signs in as. Null means "not provisioned
  -- yet" — the admin function fills it in when a code is first assigned.
  add column if not exists auth_user_id uuid;

do $$ begin
  alter table profiles add constraint profiles_role_check
    check (role in ('owner', 'member', 'guest'));
exception when duplicate_object then null; end $$;

create unique index if not exists profiles_auth_user_idx
  on profiles (auth_user_id) where auth_user_id is not null;

-- Avi and Jackie run the household: they manage people, codes and grants.
update profiles set role = 'owner' where slug in ('avi', 'jackie');

-- ---------------------------------------------------------------------------
-- Credentials
--
-- Deliberately a separate table with RLS enabled and NO policies at all. That
-- combination denies every client role outright — `service_role` bypasses RLS
-- entirely, so the Edge Functions can still read it and nothing else can. The
-- same columns hanging off `profiles` would be readable by any signed-in
-- member, because a policy grants a ROW, not a subset of its columns.
-- ---------------------------------------------------------------------------
create table if not exists member_credentials (
  profile_id  uuid primary key references profiles(id) on delete cascade,
  -- sha256(pepper || ':' || upper(trim(code))). The pepper is an Edge Function
  -- secret and never reaches the database, so a dump of this table does not
  -- let anyone brute-force short codes offline.
  code_hash   text not null unique,
  -- Credentials for this member's auth.users row. Generated, never shown to
  -- anyone: the household code is the only thing a person ever types.
  auth_email    text not null,
  auth_password text not null,
  updated_at  timestamptz not null default now()
);

alter table member_credentials enable row level security;
-- Intentionally empty. See the comment above before adding a policy here.

-- ---------------------------------------------------------------------------
-- Identity helpers
--
-- SECURITY DEFINER so a policy on one table can look up the caller's profile
-- without that caller needing their own read access to profiles — otherwise
-- the profiles policy would have to call these functions to answer itself.
-- STABLE lets the planner call them once per statement instead of per row.
-- ---------------------------------------------------------------------------

create or replace function current_profile_id() returns uuid
language sql stable security definer set search_path = public as $$
  select id from profiles
   where auth_user_id = auth.uid() and is_active
   limit 1
$$;

create or replace function is_member() returns boolean
language sql stable security definer set search_path = public as $$
  select current_profile_id() is not null
$$;

create or replace function is_owner() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from profiles
     where auth_user_id = auth.uid() and is_active and role = 'owner'
  )
$$;

/*
  The migration escape hatch.

  Both phones are currently signed in as the one shared Things account, which
  is linked to no profile at all. The moment these policies start demanding a
  member row, that session reads as a stranger — so switching this on without
  a bridge logs both of you out of your own house and there is no code to sign
  back in with yet, because codes are handed out by a function that requires
  an owner session to call.

  So legacy sessions keep working until someone turns this off, which is the
  actual hardening step and belongs in the launcher's own settings screen
  rather than in a migration that runs before anyone has a code.
*/
alter table household_settings
  add column if not exists legacy_auth_enabled boolean not null default true;

create or replace function legacy_session_ok() returns boolean
language sql stable security definer set search_path = public as $$
  select auth.uid() is not null
     and coalesce((select legacy_auth_enabled from household_settings limit 1), true)
$$;

-- What every Things table now asks. Reads as: a real member, or the shared
-- account while the hatch is still open.
create or replace function household_access() returns boolean
language sql stable security definer set search_path = public as $$
  select is_member() or legacy_session_ok()
$$;

-- ---------------------------------------------------------------------------
-- Apps: who may use them, and who wants to see them
--
-- Two separate tables because they answer different questions and one of them
-- is enforceable. `app_access` is permission — the database consults it and a
-- guest without a grant cannot read the rows however they ask. `app_prefs` is
-- taste: hiding an app you are allowed to use, so the home screen stays short.
-- Folding them into one column would mean a member hiding an icon and a guest
-- being denied entry were the same state, and only one of those should survive
-- someone else editing your settings.
-- ---------------------------------------------------------------------------
create table if not exists app_access (
  profile_id uuid not null references profiles(id) on delete cascade,
  app_id     text not null,
  granted    boolean not null default true,
  granted_by uuid references profiles(id) on delete set null,
  updated_at timestamptz not null default now(),
  primary key (profile_id, app_id)
);

create table if not exists app_prefs (
  profile_id uuid not null references profiles(id) on delete cascade,
  app_id     text not null,
  hidden     boolean not null default false,
  -- Home screen ordering. Fractional so a drag between two icons is one write
  -- of the midpoint rather than a renumbering of the whole grid.
  sort_order double precision not null default extract(epoch from now()),
  updated_at timestamptz not null default now(),
  primary key (profile_id, app_id)
);

/*
  Per-app notification behaviour, which is the point of routing them through
  the launcher rather than letting each app talk to the OS directly: a chore
  going overdue and someone marking a $200 debt paid should not arrive looking
  the same. `push` is separate from `enabled` on purpose — "show me the badge
  and the notification centre entry, but do not buzz my phone at work" is the
  common ask, and one boolean cannot express it.
*/
create table if not exists app_notify_prefs (
  profile_id uuid not null references profiles(id) on delete cascade,
  app_id     text not null,
  enabled    boolean not null default true,
  push       boolean not null default true,
  sound      text,
  haptic     text not null default 'normal'
               check (haptic in ('off', 'subtle', 'normal', 'heavy')),
  -- Per-event opt-outs within one app, e.g. {"debt_added": false}. An absent
  -- key means enabled, matching how profile_settings.haptic_events reads.
  events     jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now(),
  primary key (profile_id, app_id)
);

/*
  The permission question, asked by every app-scoped policy below.

  Owners are unconditional — they are the people who hand out access, so a
  missing grant row for an owner is a bookkeeping gap, not a denial. Everyone
  else needs an explicit granted row: the default is no, so an app added next
  month is invisible to guests until someone decides otherwise rather than
  silently appearing on their home screen.
*/
create or replace function has_app(app text) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1
      from profiles p
      left join app_access a
        on a.profile_id = p.id and a.app_id = app
     where p.auth_user_id = auth.uid()
       and p.is_active
       and (p.role = 'owner' or coalesce(a.granted, false))
  ) or legacy_session_ok()
$$;

-- ---------------------------------------------------------------------------
-- Notifications
--
-- One row per recipient rather than one row per event with a fan-out join.
-- Read state, which is the whole basis of the badge counts, is per person; a
-- shared row would need a side table to record that anyway, and this way the
-- notification centre is a single indexed read of "mine, newest first".
-- ---------------------------------------------------------------------------
create table if not exists notifications (
  id         uuid primary key default gen_random_uuid(),
  profile_id uuid not null references profiles(id) on delete cascade,
  app_id     text not null,
  -- Lets one app distinguish its own kinds, so per-event mutes and the
  -- notification centre's icons don't have to pattern-match on the title.
  event      text not null default 'generic',
  title      text not null,
  body       text,
  -- Where tapping it should land, e.g. {"tab":"chores","id":"…"}. Opaque to
  -- the launcher and interpreted by the app it belongs to.
  deep_link  jsonb,
  actor_id   uuid references profiles(id) on delete set null,
  read_at    timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists notifications_inbox_idx
  on notifications (profile_id, created_at desc);

-- Powers the per-app badge counts, which are the most frequent read in the
-- app: every launcher render asks for them. Partial, so it only carries the
-- unread rows and stays small even after a year of history.
create index if not exists notifications_unread_idx
  on notifications (profile_id, app_id) where read_at is null;

-- ---------------------------------------------------------------------------
-- Owe / Owed
--
-- `direction` rather than two tables: the two lists are the same shape, the
-- same swipe and the same summary, and splitting them would duplicate every
-- policy and index to encode one boolean.
--
-- `counterparty` is free text, not a foreign key. The people on this list are
-- mostly not launcher members — they are a cousin, a landlord, the friend who
-- covered dinner — and forcing a profile row for each would mean creating an
-- account for someone who will never sign in. `counterparty_key` is the
-- normalised form the summary groups on, maintained by a trigger so that
-- "Sam", "sam" and " Sam " total up as one person.
-- ---------------------------------------------------------------------------
create table if not exists debts (
  id           uuid primary key,
  direction    text not null check (direction in ('owed_to_us', 'we_owe')),
  counterparty text not null check (length(trim(counterparty)) > 0),
  counterparty_key text not null default '',
  -- Integer cents. Money in floating point is how you end up owing someone
  -- $19.999999999999998.
  amount_cents integer not null check (amount_cents > 0),
  reason       text,
  notes        text,
  is_paid      boolean not null default false,
  paid_at      timestamptz,
  paid_by      uuid references profiles(id) on delete set null,
  created_by   uuid references profiles(id) on delete set null,
  updated_by   uuid references profiles(id) on delete set null,
  sort_order   double precision not null default extract(epoch from now()),
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),

  -- A paid row must carry its timestamp and an unpaid row must not, so the
  -- history section can never show an entry with no date against it.
  constraint paid_has_timestamp check (is_paid = (paid_at is not null))
);

create or replace function debts_normalise() returns trigger
language plpgsql as $$
begin
  -- Collapse runs of whitespace too, so "Mary  Jane" and "Mary Jane" group.
  new.counterparty_key := lower(regexp_replace(trim(new.counterparty), '\s+', ' ', 'g'));
  new.updated_at := now();
  return new;
end $$;

drop trigger if exists debts_normalise_trg on debts;
create trigger debts_normalise_trg
  before insert or update on debts
  for each row execute function debts_normalise();

-- Backfill for anything inserted before the trigger existed.
update debts set counterparty = counterparty where counterparty_key = '';

create index if not exists debts_open_idx
  on debts (direction, is_paid, sort_order);
create index if not exists debts_counterparty_idx
  on debts (counterparty_key, is_paid);
create index if not exists debts_history_idx
  on debts (paid_at desc) where is_paid;

-- ---------------------------------------------------------------------------
-- Row level security
-- ---------------------------------------------------------------------------

do $$
declare t text;
begin
  foreach t in array array[
    'app_access', 'app_prefs', 'app_notify_prefs', 'notifications', 'debts'
  ] loop
    execute format('alter table %I enable row level security', t);
  end loop;
end $$;

-- Things' own tables: unchanged in effect today, but now asking a question
-- that has a real answer once the legacy hatch closes.
do $$
declare t text;
begin
  foreach t in array array[
    'profiles', 'profile_settings', 'household_settings',
    'todos', 'chores', 'stores', 'shopping_items', 'wishlist_items',
    'geocode_cache', 'shopping_trips', 'push_subscriptions', 'activity_log'
  ] loop
    execute format('drop policy if exists household_rw on %I', t);
    execute format(
      'create policy household_rw on %I for all
         to authenticated using (household_access()) with check (household_access())', t);
  end loop;
end $$;

-- Everyone reads the roster — the launcher shows who else is in the household,
-- and Things attributes rows to names. Writes are narrower: you may edit your
-- own row, owners may edit anyone's. Role, code and active state are changed
-- only through the admin Edge Function, never by a direct table write, so a
-- member cannot promote themselves by patching their own row.
drop policy if exists app_access_read on app_access;
create policy app_access_read on app_access for select
  to authenticated using (household_access());

drop policy if exists app_access_write on app_access;
create policy app_access_write on app_access for all
  to authenticated using (is_owner()) with check (is_owner());

-- Preferences are personal: you see and set your own, nobody else's.
drop policy if exists app_prefs_own on app_prefs;
create policy app_prefs_own on app_prefs for all
  to authenticated
  using (profile_id = current_profile_id())
  with check (profile_id = current_profile_id());

drop policy if exists app_notify_prefs_own on app_notify_prefs;
create policy app_notify_prefs_own on app_notify_prefs for all
  to authenticated
  using (profile_id = current_profile_id())
  with check (profile_id = current_profile_id());

-- Your inbox is yours. Notifications are written by the sender function under
-- the service role, so there is no client insert policy to abuse: a member
-- cannot post a notification into someone else's centre.
drop policy if exists notifications_own on notifications;
create policy notifications_own on notifications for select
  to authenticated using (profile_id = current_profile_id());

drop policy if exists notifications_mark on notifications;
create policy notifications_mark on notifications for update
  to authenticated
  using (profile_id = current_profile_id())
  with check (profile_id = current_profile_id());

drop policy if exists notifications_clear on notifications;
create policy notifications_clear on notifications for delete
  to authenticated using (profile_id = current_profile_id());

-- The Owe list is app-scoped: a guest without the grant cannot read a single
-- row, whatever the client shows them.
drop policy if exists debts_rw on debts;
create policy debts_rw on debts for all
  to authenticated using (has_app('owe')) with check (has_app('owe'));

-- ---------------------------------------------------------------------------
-- Realtime
-- ---------------------------------------------------------------------------
do $$
declare t text;
begin
  foreach t in array array['debts', 'notifications', 'app_access', 'app_prefs'] loop
    -- REPLICA IDENTITY FULL is what makes DELETE events carry the old row;
    -- without it a deletion arrives with nothing but an id the client may
    -- never have seen, and the row lingers on the other phone until reload.
    execute format('alter table %I replica identity full', t);
    begin
      execute format('alter publication supabase_realtime add table %I', t);
    exception when duplicate_object then null;
    end;
  end loop;
end $$;

-- ---------------------------------------------------------------------------
-- Notifications for the Owe list
--
-- Reuses notify_change() from 005_notifications.sql, which posts the row to
-- the `notify` Edge Function. Guarded because 005 is optional: without it
-- there is no function to attach, and the whole launcher still works — you
-- just don't get told about anything until it's run.
--
-- Only INSERT and UPDATE, matching Things' tables. A deleted debt announces
-- nothing: removing an entry is usually a correction, and "$40 from Sam was
-- deleted" is a worse notification than silence.
-- ---------------------------------------------------------------------------
do $$
begin
  if exists (select 1 from pg_proc where proname = 'notify_change') then
    drop trigger if exists debts_notify on debts;
    create trigger debts_notify
      after insert or update on debts
      for each row execute function notify_change();
  else
    raise notice
      'notify_change() not found — run 005_notifications.sql to get notifications.';
  end if;
end $$;
