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
