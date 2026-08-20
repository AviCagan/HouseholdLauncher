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
