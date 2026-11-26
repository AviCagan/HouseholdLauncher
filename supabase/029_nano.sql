-- Household Launcher — Nano
--
-- Nano is the household's assistant. She runs on a computer of her own (the
-- "brain") and reaches the launcher's data the way every phone does: signed
-- in with a household code, through the API, under row-level security. Never
-- with the service role.
--
-- This file is the database's half of the contract agreed in the
-- coordination doc. In order:
--
--   1. Who she is: a member with the role `agent`, kept out of every
--      member-only check, with an off switch (profiles.is_active).
--   2. Who she's acting for: the asker of a launcher request (header
--      x-nano-ask), a member the brain names (x-nano-for), or nobody (her own).
--   3. What she can reach, per app, as extra policies next to the members'.
--   4. A change log written by a trigger, and an undo.
--   5. What the database refuses: bulk deletes and changes without an
--      approval, and a dry run that checks a write in full and keeps nothing.
--   6. Approvals, checked against Avi's authenticator here, used once each.
--   7. Her request queue (nano_asks), heartbeat and settings.
--   8. Things stock counts, wishlist hiding, and the Calendar switch.
--
-- Safe to run more than once. Run it after 028_sign_in_hardening.sql.
-- Nothing personal goes in this file: the repository is public.

-- ---------------------------------------------------------------------------
-- 1. Who she is
-- ---------------------------------------------------------------------------

alter table profiles drop constraint if exists profiles_role_check;
alter table profiles add constraint profiles_role_check
  check (role in ('owner', 'member', 'guest', 'agent'));

-- One Nano per household.
create unique index if not exists profiles_one_agent on profiles ((true)) where role = 'agent';

-- A friend's name as Owe & Owed writes it, so Nano can answer them about
-- their own balance and nothing else. Set by an owner in Settings › People.
alter table profiles add column if not exists owe_name text;

/*
  The member checks every existing policy asks now leave Nano out.

  Without this she would be a member like any other — household_access()
  would let her into every Things table, profiles and household settings —
  and none of the rules below would mean anything. Her reach comes only from
  the nano_* policies in section 3.
*/
create or replace function current_profile_id() returns uuid
language sql stable security definer set search_path = public as $$
  select id from profiles
   where auth_user_id = auth.uid() and is_active and role <> 'agent'
   limit 1
$$;

create or replace function has_app(app text) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1
      from profiles p
      left join app_access a
        on a.profile_id = p.id and a.app_id = app
     where p.auth_user_id = auth.uid()
       and p.is_active
       and p.role <> 'agent'
       and (p.role = 'owner' or coalesce(a.granted, false))
  ) or legacy_session_ok()
$$;

/*
  The shared PIN's escape hatch, narrowed to the shared account itself.

  It used to accept any signed-in session while the hatch was open, which
  quietly gave owner reach to a member who had been switched off, and would
  have given it to Nano. The shared account is linked to no profile at all,
  so that is now the test.
*/
create or replace function legacy_session_ok() returns boolean
language sql stable security definer set search_path = public as $$
  select auth.uid() is not null
     and coalesce((select legacy_auth_enabled from household_settings limit 1), true)
     and not exists (select 1 from profiles where auth_user_id = auth.uid())
$$;

/* Nano's profile id when the caller is Nano and she is switched on, else null. */
create or replace function nano_id() returns uuid
language sql stable security definer set search_path = public as $$
  select id from profiles
   where auth_user_id = auth.uid() and role = 'agent' and is_active
   limit 1
$$;

-- ---------------------------------------------------------------------------
-- 7a. Her settings, heartbeat and request queue (needed by section 2)
-- ---------------------------------------------------------------------------

create table if not exists nano_settings (
  singleton         boolean primary key default true check (singleton),
  -- Off until Avi moves the Med School data role to her.
  medschool_writes  boolean not null default false,
  -- Her WhatsApp number, which the Calendar's Nano button opens.
  whatsapp          text,
  updated_by        uuid references profiles(id) on delete set null,
  updated_at        timestamptz not null default now()
);
insert into nano_settings (singleton) values (true) on conflict do nothing;

create table if not exists nano_status (
  singleton     boolean primary key default true check (singleton),
  -- Touched by the brain every 30 seconds. The Nano button calls her away
  -- once this is more than two minutes old.
  last_seen_at  timestamptz,
  version       text,
  updated_at    timestamptz not null default now()
);
insert into nano_status (singleton) values (true) on conflict do nothing;

create table if not exists nano_asks (
  id          uuid primary key,
  -- Written by the database from the session that inserted the row. Never
  -- taken from the client: this is how a request vouches for who asked.
  asked_by    uuid not null references profiles(id) on delete cascade,
  app_id      text not null,
  screen      text,
  item_table  text,
  item_id     text,
  item_title  text,
  body        text not null check (length(body) between 1 and 4000),
  status      text not null default 'waiting'
                check (status in ('waiting', 'working', 'answered', 'failed', 'cancelled', 'expired')),
  answer      text,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  -- Nothing from the Calendar is ever saved as a request.
  constraint nano_asks_not_calendar check (app_id <> 'mikvah')
);
create index if not exists nano_asks_waiting on nano_asks (created_at) where status = 'waiting';
create index if not exists nano_asks_by on nano_asks (asked_by, created_at desc);

-- ---------------------------------------------------------------------------
-- 2. Who she's acting for
-- ---------------------------------------------------------------------------

/* One request header, as PostgREST passes them (names in lower case). */
create or replace function nano_header(name text) returns text
language sql stable as $$
  select nullif(trim(coalesce(nullif(current_setting('request.headers', true), ''), '{}')::json ->> name), '')
$$;

/*
  The member Nano is acting for in this request, or null when she acts on
  her own.

  x-nano-ask: the id of an open launcher request. The database wrote who
  asked when the member's own phone saved it, so this one is vouched for.
  x-nano-for: a member the brain names, for requests from WhatsApp or a
  speaker. The database can't check those; it can still hold her to what
  that member could do.
*/
create or replace function nano_acting_for() returns uuid
language plpgsql stable security definer set search_path = public as $$
declare
  h   text;
  who uuid;
begin
  if nano_id() is null then return null; end if;

  h := nano_header('x-nano-ask');
  if h is not null then
    begin
      select a.asked_by into who
        from nano_asks a
       where a.id = h::uuid
         and a.status in ('waiting', 'working', 'answered')
         and a.created_at > now() - interval '12 hours';
    exception when invalid_text_representation then
      raise exception 'nano: x-nano-ask is not a request id';
    end;
    if who is null then raise exception 'nano: no open request %', h; end if;
    return who;
  end if;

  h := nano_header('x-nano-for');
  if h is not null then
    begin
      select p.id into who from profiles p
       where p.id = h::uuid and p.is_active and p.role in ('owner', 'member', 'guest');
    exception when invalid_text_representation then
      raise exception 'nano: x-nano-for is not a member id';
    end;
    if who is null then raise exception 'nano: x-nano-for names no active member'; end if;
    return who;
  end if;

  return null;
end $$;

-- ---------------------------------------------------------------------------
-- 3. What she can reach
-- ---------------------------------------------------------------------------

/* has_app(), for a named member rather than the caller. */
create or replace function profile_has_app(who uuid, app text) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from profiles p
      left join app_access a on a.profile_id = p.id and a.app_id = app
     where p.id = who and p.is_active
       and (p.role = 'owner' or coalesce(a.granted, false))
  )
$$;

/* The friend an Owe & Owed name belongs to, by the name an owner linked. */
create or replace function nano_owe_member(counterparty_key text) returns uuid
language sql stable security definer set search_path = public as $$
  select id from profiles
   where owe_name is not null
     and role in ('member', 'guest')
     and lower(regexp_replace(trim(owe_name), '\s+', ' ', 'g')) = counterparty_key
   limit 1
$$;

/*
  May Nano read (writing = false) or change (writing = true) a row of this
  app whose owners are `owners`?

  - Acting for Avi or Jackie, or on her own: yes, except that Med School
    writes wait for the switch in nano_settings.
  - Acting for a friend: only in apps that friend was granted (Things counts
    as granted to everyone, as it is today), only rows the friend owns, and
    never in Med School, A&J Encyclopedia, the activity feed or the Calendar.
    `owners` null marks a shared reference table (stores, Watched settings):
    a friend may read it but not change it. Owe & Owed is read-only for them.
  - The Calendar is never reached through here; see section 8.
*/
create or replace function nano_reach(app text, owners uuid[], writing boolean) returns boolean
language plpgsql stable security definer set search_path = public as $$
declare
  who    uuid;
  v_role text;
begin
  if nano_id() is null or app = 'mikvah' then return false; end if;
  who := nano_acting_for();
  if who is not null then
    select p.role into v_role from profiles p where p.id = who;
  end if;

  if who is null or v_role = 'owner' then
    if writing and app = 'medschool' then
      return coalesce((select medschool_writes from nano_settings where singleton), false);
    end if;
    return true;
  end if;

  if app in ('medschool', 'encyclopedia', 'activity') then return false; end if;
  if app <> 'things' and not profile_has_app(who, app) then return false; end if;
  if writing and app = 'owe' then return false; end if;
  if owners is null then return not writing; end if;
  return who = any(owners);
end $$;

/*
  Every app table Nano works in, with its app and the columns that make a
  row someone's own. The registry (src/launcher/registry.ts) names the same
  tables, and a test checks the two agree.
*/
create or replace function nano_tables() returns table (tbl text, app text, owners text)
language sql immutable as $$
  values
    ('todos',              'things',       'array[created_by, claimed_by]'),
    ('chores',             'things',       'array[created_by, claimed_by]'),
    ('shopping_items',     'things',       'array[created_by, claimed_by]'),
    ('stores',             'things',       null),
    ('wishlist_items',     'things',       'array[owner_id, created_by]'),
    ('things_stock',       'things',       'array[created_by]'),
    ('debts',              'owe',          'array[nano_owe_member(counterparty_key)]'),
    ('dishes',             'meals',        'array[created_by]'),
    ('meals',              'meals',        'array[created_by]'),
    ('meal_templates',     'meals',        'array[created_by]'),
    ('lexicon_entries',    'encyclopedia', 'array[created_by]'),
    ('watch_shows',        'watched',      'array[created_by, shelf_owner]'),
    ('watch_seasons',      'watched',      'array[created_by]'),
    ('watch_ratings',      'watched',      'array[profile_id]'),
    ('watch_views',        'watched',      'array[created_by]'),
    ('watch_settings',     'watched',      null),
    ('inventory_items',    'inventory',    'array[created_by]'),
    ('ms_settings',        'medschool',    null),
    ('ms_tasks',           'medschool',    null),
    ('ms_counters',        'medschool',    null),
    ('ms_counter_logs',    'medschool',    null),
    ('ms_eligibility',     'medschool',    null),
    ('ms_letters',         'medschool',    null),
    ('ms_courses',         'medschool',    null),
    ('ms_practice',        'medschool',    null),
    ('ms_questions',       'medschool',    null),
    ('ms_experiences',     'medschool',    null),
    ('ms_experience_logs', 'medschool',    null),
    ('ms_experience_steps','medschool',    null)
$$;

-- ---------------------------------------------------------------------------
-- 8a. New tables for Things and the Calendar (before the policies loop)
-- ---------------------------------------------------------------------------

create table if not exists things_stock (
  id                uuid primary key,
  name              text not null check (length(trim(name)) > 0),
  unit              text,
  on_hand           numeric not null default 0 check (on_hand >= 0),
  -- At or below this, it goes on the shopping list. Null: never by itself.
  low_at            numeric check (low_at is null or low_at >= 0),
  store_id          uuid references stores(id) on delete set null,
  auto_add          boolean not null default true,
  -- The shopping item this count put on the list, so it isn't added twice.
  shopping_item_id  uuid references shopping_items(id) on delete set null,
  sort_order        double precision not null default extract(epoch from now()),
  created_by        uuid references profiles(id) on delete set null,
  updated_by        uuid references profiles(id) on delete set null,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);

-- Someone the item is kept from. Their phone never receives the row.
alter table wishlist_items add column if not exists hidden_from uuid references profiles(id) on delete set null;

create table if not exists mk_nano (
  -- Her profile: one switch per calendar.
  id          uuid primary key references profiles(id) on delete cascade,
  can_read    boolean not null default false,
  updated_at  timestamptz not null default now()
);

-- The members' own policies for the new tables.
alter table things_stock enable row level security;
drop policy if exists household_rw on things_stock;
create policy household_rw on things_stock for all to authenticated
  using (household_access()) with check (household_access());

-- Wishlist: an item hidden from someone never reaches them, even through
-- the API, and they can't change it either.
drop policy if exists household_rw on wishlist_items;
create policy household_rw on wishlist_items for all to authenticated
  using (household_access() and (hidden_from is null or hidden_from is distinct from current_profile_id()))
  with check (household_access() and (hidden_from is null or hidden_from is distinct from current_profile_id()));

/*
  Members read the household's people; only owners change them directly.
  Everyone else's changes go through the household function, which checks
  roles itself. This used to be open to any member, which let one promote
  themselves to owner straight through the API.
*/
drop policy if exists household_rw on profiles;
drop policy if exists profiles_read on profiles;
drop policy if exists profiles_write on profiles;
create policy profiles_read on profiles for select to authenticated using (household_access());
create policy profiles_write on profiles for all to authenticated
  using (is_owner() or legacy_session_ok()) with check (is_owner() or legacy_session_ok());

/*
  The shared PIN can be turned off from the app but never back on: that is
  a decision for whoever holds the database, not for any member's phone.
*/
create or replace function household_settings_guard() returns trigger
language plpgsql as $$
begin
  if auth.uid() is not null
     and old.legacy_auth_enabled = false and new.legacy_auth_enabled = true then
    raise exception 'The old shared PIN can''t be turned back on from the app';
  end if;
  return new;
end $$;
drop trigger if exists household_settings_guard on household_settings;
create trigger household_settings_guard before update on household_settings
  for each row execute function household_settings_guard();

-- ---------------------------------------------------------------------------
-- 3b. Nano's policies, table by table
-- ---------------------------------------------------------------------------
do $$
declare
  r     record;
  own   text;
  extra text;
begin
  for r in select * from nano_tables() loop
    own := coalesce(r.owners, 'null::uuid[]');
    -- A hidden wishlist item stays hidden from the person Nano acts for.
    extra := case when r.tbl = 'wishlist_items'
                  then ' and (hidden_from is null or hidden_from is distinct from nano_acting_for())'
                  else '' end;
    execute format('drop policy if exists nano_read on %I', r.tbl);
    execute format('drop policy if exists nano_insert on %I', r.tbl);
    execute format('drop policy if exists nano_update on %I', r.tbl);
    execute format('drop policy if exists nano_delete on %I', r.tbl);
    execute format('create policy nano_read on %I for select to authenticated
                      using ((select nano_id()) is not null and nano_reach(%L, %s, false)%s)', r.tbl, r.app, own, extra);
    execute format('create policy nano_insert on %I for insert to authenticated
                      with check ((select nano_id()) is not null and nano_reach(%L, %s, true)%s)', r.tbl, r.app, own, extra);
    execute format('create policy nano_update on %I for update to authenticated
                      using ((select nano_id()) is not null and nano_reach(%L, %s, true)%s)
                      with check ((select nano_id()) is not null and nano_reach(%L, %s, true)%s)',
                   r.tbl, r.app, own, extra, r.app, own, extra);
    execute format('create policy nano_delete on %I for delete to authenticated
                      using ((select nano_id()) is not null and nano_reach(%L, %s, true)%s)', r.tbl, r.app, own, extra);
  end loop;
end $$;

-- Reading the household around the apps: who's who, who has what, the home.
drop policy if exists nano_read on profiles;
create policy nano_read on profiles for select to authenticated using ((select nano_id()) is not null);
drop policy if exists nano_read on app_access;
create policy nano_read on app_access for select to authenticated using ((select nano_id()) is not null);
drop policy if exists nano_read on household_settings;
create policy nano_read on household_settings for select to authenticated using ((select nano_id()) is not null);
-- The activity feed, for the evening tally: for Avi or Jackie or on her own, never for a friend.
drop policy if exists nano_read on activity_log;
create policy nano_read on activity_log for select to authenticated
  using ((select nano_id()) is not null and nano_reach('activity', null, false));

/*
  The activity feed is written by a trigger on the Things tables, as
  whoever made the change. Nano has no policy to write it directly, so the
  trigger now writes as its owner: the rows still name the real actor.
*/
alter function log_activity() security definer set search_path = public;

-- ---------------------------------------------------------------------------
-- 4. The change log, and undo
-- ---------------------------------------------------------------------------

create table if not exists nano_changes (
  id          uuid primary key default gen_random_uuid(),
  at          timestamptz not null default now(),
  table_name  text not null,
  row_key     text not null,
  op          text not null check (op in ('insert', 'update', 'delete')),
  before      jsonb,
  after       jsonb,
  -- The member she acted for; null when she acted on her own.
  acting_for  uuid references profiles(id) on delete set null,
  ask_id      uuid references nano_asks(id) on delete set null,
  undone_at   timestamptz,
  undone_by   uuid references profiles(id) on delete set null
);
create index if not exists nano_changes_at on nano_changes (at desc);
create index if not exists nano_changes_for on nano_changes (acting_for, at desc);
create index if not exists nano_changes_deletes on nano_changes (at) where op = 'delete';

/* After every row Nano changes: the row before and after, and for whom. */
create or replace function nano_audit() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  b   jsonb;
  a   jsonb;
  ask uuid;
begin
  if nano_id() is null then return null; end if;
  if tg_op <> 'INSERT' then b := to_jsonb(old); end if;
  if tg_op <> 'DELETE' then a := to_jsonb(new); end if;
  begin
    ask := nano_header('x-nano-ask')::uuid;
  exception when invalid_text_representation then
    ask := null;
  end;
  insert into nano_changes (table_name, row_key, op, before, after, acting_for, ask_id)
  values (tg_table_name, coalesce(a, b) ->> tg_argv[0], lower(tg_op), b, a, nano_acting_for(), ask);
  return null;
end $$;

/*
  Put one change back.

  Refuses rather than overwrite: if the row is not exactly as Nano left it,
  someone has changed it since, and their change wins. Avi and Jackie can
  undo anything; a member can undo what was done for them; Nano can undo
  when one of them asks.
*/
create or replace function nano_undo(change_id uuid) returns void
language plpgsql security definer set search_path = public as $$
declare
  c    nano_changes;
  me   uuid := current_profile_id();
  pk   text;
  cur  jsonb;
  cols text;
  who  uuid;
begin
  select * into c from nano_changes where id = change_id for update;
  if c.id is null then raise exception 'nano: no such change'; end if;
  if c.undone_at is not null then raise exception 'nano: that change was already undone'; end if;

  if nano_id() is not null then
    who := nano_acting_for();
    if not (who is null
            or who = c.acting_for
            or (select role from profiles where id = who) = 'owner') then
      raise exception 'nano: that change wasn''t made for the person asking';
    end if;
  elsif not (is_owner() or (me is not null and c.acting_for = me)) then
    raise exception 'nano: only Avi, Jackie or the person it was for can undo that';
  end if;

  select a.attname into pk
    from pg_index i
    join pg_attribute a on a.attrelid = i.indrelid and a.attnum = any(i.indkey)
   where i.indrelid = format('public.%I', c.table_name)::regclass and i.indisprimary
   limit 1;

  execute format('select to_jsonb(t) from %I t where t.%I::text = $1', c.table_name, pk)
     into cur using c.row_key;

  if c.op = 'insert' then
    if cur is null then raise exception 'nano: it''s already gone'; end if;
    if cur is distinct from c.after then raise exception 'nano: someone has changed it since, so it was left alone'; end if;
    execute format('delete from %I t where t.%I::text = $1', c.table_name, pk) using c.row_key;
  elsif c.op = 'update' then
    if cur is null then raise exception 'nano: it has been deleted since'; end if;
    if cur is distinct from c.after then raise exception 'nano: someone has changed it since, so it was left alone'; end if;
    select string_agg(format('%I', k), ', ') into cols from jsonb_object_keys(c.before) k;
    execute format('update %I t set (%s) = (select %s from jsonb_populate_record(null::%I, $1)) where t.%I::text = $2',
                   c.table_name, cols, cols, c.table_name, pk)
      using c.before, c.row_key;
  else
    if cur is not null then raise exception 'nano: it''s back already'; end if;
    execute format('insert into %I select * from jsonb_populate_record(null::%I, $1)', c.table_name, c.table_name)
      using c.before;
  end if;

  update nano_changes set undone_at = now(), undone_by = coalesce(me, nano_id()) where id = change_id;
end $$;

-- ---------------------------------------------------------------------------
-- 6. Approvals and Avi's authenticator
-- ---------------------------------------------------------------------------

create table if not exists nano_approvals (
  id              uuid primary key default gen_random_uuid(),
  created_at      timestamptz not null default now(),
  -- The owner she was acting for when she asked.
  asked_for       uuid not null references profiles(id) on delete cascade,
  kind            text not null check (kind in ('delete', 'update', 'member', 'access', 'code')),
  -- What it will do, in her words. Shown where Avi approves it, next to the
  -- scope below, which the launcher spells out itself.
  summary         text not null check (length(summary) between 1 and 400),
  table_name      text,
  max_rows        integer check (max_rows is null or max_rows > 0),
  target_profile  uuid references profiles(id) on delete cascade,
  status          text not null default 'waiting' check (status in ('waiting', 'approved', 'used', 'cancelled')),
  approved_at     timestamptz,
  used_at         timestamptz,
  constraint nano_approvals_scope check (
    (kind in ('delete', 'update') and table_name is not null and max_rows is not null)
    or kind in ('member', 'access', 'code')
  )
);

/*
  The authenticator's setup key, so the database can check Avi's codes
  itself. Read by nothing but the functions below: row-level security on
  with no policies, and no grants.

  Swapping it for another entry later (one only the launcher knows) is the
  same function with a current code from the old one: a settings change,
  not a schema change.
*/
create table if not exists nano_authenticator (
  singleton     boolean primary key default true check (singleton),
  secret        text not null,
  -- The last 30-second step a code was accepted for. Each code works once.
  last_step     bigint not null default 0,
  -- Wrong codes, to stop anyone working through all million of them.
  fails         integer not null default 0,
  fails_since   timestamptz,
  set_at        timestamptz not null default now(),
  set_by        uuid references profiles(id) on delete set null
);
alter table nano_authenticator enable row level security;
revoke all on nano_authenticator from anon, authenticated;

/* RFC 4648 base32, as authenticator setup keys are written. */
create or replace function nano_base32(input text) returns bytea
language plpgsql immutable as $$
declare
  alphabet constant text := 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
  s     text := upper(regexp_replace(coalesce(input, ''), '[\s=-]', '', 'g'));
  bits  bigint := 0;
  nbits int := 0;
  out   bytea := ''::bytea;
  v     int;
begin
  for i in 1 .. length(s) loop
    v := strpos(alphabet, substr(s, i, 1)) - 1;
    if v < 0 then raise exception 'nano: that setup key has a character authenticators don''t use'; end if;
    bits := (bits << 5) | v;
    nbits := nbits + 5;
    if nbits >= 8 then
      out := out || set_byte('\x00'::bytea, 0, ((bits >> (nbits - 8)) & 255)::int);
      nbits := nbits - 8;
      bits := bits & ((1::bigint << nbits) - 1);
    end if;
  end loop;
  return out;
end $$;

/* RFC 6238: the 6-digit code for one 30-second step. */
create or replace function nano_totp(secret bytea, step bigint) returns text
language plpgsql immutable as $$
declare
  h    bytea := extensions.hmac(int8send(step), secret, 'sha1');
  off  int := get_byte(h, 19) & 15;
  code bigint;
begin
  code := ((get_byte(h, off) & 127)::bigint << 24)
        | (get_byte(h, off + 1)::bigint << 16)
        | (get_byte(h, off + 2)::bigint << 8)
        |  get_byte(h, off + 3)::bigint;
  return lpad((code % 1000000)::text, 6, '0');
end $$;

/*
  Check a code: the current one or the one before, as the spec says, and
  only if no code at or after that step has been accepted yet. Returns an
  error message, or null when the code is good (and now used).

  Never raises for a wrong code, so the count of wrong codes is kept: an
  exception would roll it back with everything else.
*/
create or replace function nano_spend_code(code text) returns text
language plpgsql volatile security definer set search_path = public as $$
declare
  a     nano_authenticator;
  now_s bigint := floor(extract(epoch from clock_timestamp()) / 30);
  s     bigint;
begin
  select * into a from nano_authenticator where singleton for update;
  if a.singleton is null then
    return 'Avi''s authenticator isn''t set up yet (Settings › General › Security)';
  end if;
  if a.fails >= 5 and a.fails_since > now() - interval '15 minutes' then
    return 'Too many wrong codes. Wait a quarter of an hour and try again.';
  end if;
  foreach s in array array[now_s, now_s - 1] loop
    if s > a.last_step and nano_totp(nano_base32(a.secret), s) = regexp_replace(coalesce(code, ''), '\D', '', 'g') then
      update nano_authenticator set last_step = s, fails = 0, fails_since = null where singleton;
      return null;
    end if;
  end loop;
  update nano_authenticator
     set fails = case when fails_since is null or fails_since < now() - interval '15 minutes' then 1 else fails + 1 end,
         fails_since = case when fails_since is null or fails_since < now() - interval '15 minutes' then now() else fails_since end
   where singleton;
  return 'That code didn''t work. Codes work once, so wait for the next one if you just used it.';
end $$;

/* When the key was set, for Settings. Owners only. */
create or replace function nano_authenticator_set_at() returns timestamptz
language sql stable security definer set search_path = public as $$
  select set_at from nano_authenticator where singleton and is_owner()
$$;

/*
  Store or swap the setup key. Avi or Jackie, signed in with their own
  code; swapping needs a current code from the old key. Returns
  {ok, error}.
*/
create or replace function nano_set_authenticator(setup_key text, current_code text default null) returns jsonb
language plpgsql volatile security definer set search_path = public as $$
declare
  key     text := upper(regexp_replace(coalesce(setup_key, ''), '[\s=-]', '', 'g'));
  problem text;
begin
  if not is_owner() then return jsonb_build_object('ok', false, 'error', 'Only Avi or Jackie, signed in with their own code'); end if;
  if length(key) < 16 or length(nano_base32(key)) < 10 then
    return jsonb_build_object('ok', false, 'error', 'That setup key is too short');
  end if;
  if exists (select 1 from nano_authenticator where singleton) then
    problem := nano_spend_code(current_code);
    if problem is not null then return jsonb_build_object('ok', false, 'error', problem); end if;
    update nano_authenticator
       set secret = key, last_step = 0, fails = 0, fails_since = null, set_at = now(), set_by = current_profile_id()
     where singleton;
  else
    insert into nano_authenticator (singleton, secret, set_by) values (true, key, current_profile_id());
  end if;
  return jsonb_build_object('ok', true);
end $$;

/*
  Nano asks for an approval. She must be acting for Avi or Jackie: only
  they approve. Returns the approval's id, which she shows Avi along with
  her summary, and later sends back with the code (nano_approve) and then
  with the write itself (header x-nano-approval, or `approval` to the
  household function).
*/
create or replace function nano_request_approval(
  kind text,
  summary text,
  table_name text default null,
  max_rows integer default null,
  target_profile uuid default null
) returns uuid
language plpgsql volatile security definer set search_path = public as $$
#variable_conflict use_variable
declare
  who    uuid := nano_acting_for();
  new_id uuid;
begin
  if nano_id() is null then raise exception 'nano: only Nano asks for approvals'; end if;
  if who is null or (select p.role from profiles p where p.id = who) <> 'owner' then
    raise exception 'nano: ask for approvals while acting for Avi or Jackie';
  end if;
  if kind in ('delete', 'update') and (table_name is null or table_name not in (select t.tbl from nano_tables() t)) then
    raise exception 'nano: name the table it covers';
  end if;
  insert into nano_approvals (asked_for, kind, summary, table_name, max_rows, target_profile)
  values (who, kind, trim(summary), table_name, max_rows, target_profile)
  returning nano_approvals.id into new_id;
  return new_id;
end $$;

/*
  Approve one waiting request with a code. Called by Nano, passing the code
  Avi gave her, or by Avi or Jackie in the launcher. Returns {ok, error}.
  An approved request must be used within ten minutes.
*/
create or replace function nano_approve(approval_id uuid, code text) returns jsonb
language plpgsql volatile security definer set search_path = public as $$
declare
  problem text;
begin
  if nano_id() is null and not is_owner() then
    return jsonb_build_object('ok', false, 'error', 'Only Nano, Avi or Jackie can approve');
  end if;
  if not exists (select 1 from nano_approvals where id = approval_id and status = 'waiting') then
    return jsonb_build_object('ok', false, 'error', 'Nothing is waiting under that approval');
  end if;
  problem := nano_spend_code(code);
  if problem is not null then return jsonb_build_object('ok', false, 'error', problem); end if;
  update nano_approvals set status = 'approved', approved_at = now() where id = approval_id and status = 'waiting';
  return jsonb_build_object('ok', true);
end $$;

-- ---------------------------------------------------------------------------
-- 5. What the database refuses, and the dry run
-- ---------------------------------------------------------------------------

/*
  After each statement Nano runs on an app table.

  More than one row deleted, more than twenty changed, or an eleventh
  delete inside ten minutes needs an approval: the statement carries
  x-nano-approval, naming one approved, unused approval of the right kind
  for this table and at least this many rows. It is used up here. The row
  triggers above have already logged this statement, so the ten-minute
  count includes it.
*/
create or replace function nano_guard() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  n       bigint;
  recent  bigint;
  v_kind  text := lower(tg_op);
  h       text;
begin
  if nano_id() is null then return null; end if;
  if tg_op = 'DELETE' then
    select count(*) into n from old_rows;
    select count(*) into recent from nano_changes where op = 'delete' and at > now() - interval '10 minutes';
    if n <= 1 and recent <= 10 then return null; end if;
  else
    select count(*) into n from new_rows;
    if n <= 20 then return null; end if;
  end if;

  h := nano_header('x-nano-approval');
  if h is null then
    raise exception 'nano: that % of % rows in % needs Avi''s code first (nano_request_approval)', v_kind, n, tg_table_name;
  end if;
  update nano_approvals a
     set status = 'used', used_at = now()
   where a.id = h::uuid
     and a.status = 'approved'
     and a.approved_at > now() - interval '10 minutes'
     and a.kind = v_kind
     and a.table_name = tg_table_name
     and a.max_rows >= n;
  if not found then raise exception 'nano: that approval doesn''t cover this (%, % rows in %)', v_kind, n, tg_table_name; end if;
  return null;
end $$;

/*
  A write sent with x-nano-dry-run is checked in full — row-level security,
  constraints, the refusals above — and then thrown away with SQLSTATE
  NANOD, so a self-test proves a rule holds without touching real rows.
  Named to fire last.
*/
create or replace function nano_dry_run() returns trigger
language plpgsql as $$
begin
  if nano_id() is not null and nano_header('x-nano-dry-run') is not null then
    raise exception using errcode = 'NANOD', message = 'nano: dry run passed, nothing was kept';
  end if;
  return null;
end $$;

do $$
declare
  r  record;
  pk text;
begin
  for r in select * from nano_tables() loop
    select a.attname into pk
      from pg_index i
      join pg_attribute a on a.attrelid = i.indrelid and a.attnum = any(i.indkey)
     where i.indrelid = format('public.%I', r.tbl)::regclass and i.indisprimary
     limit 1;
    execute format('drop trigger if exists nano_audit on %I', r.tbl);
    execute format('create trigger nano_audit after insert or update or delete on %I
                      for each row execute function nano_audit(%L)', r.tbl, pk);
    execute format('drop trigger if exists nano_guard_delete on %I', r.tbl);
    execute format('create trigger nano_guard_delete after delete on %I referencing old table as old_rows
                      for each statement execute function nano_guard()', r.tbl);
    execute format('drop trigger if exists nano_guard_update on %I', r.tbl);
    execute format('create trigger nano_guard_update after update on %I referencing new table as new_rows
                      for each statement execute function nano_guard()', r.tbl);
    execute format('drop trigger if exists zz_nano_dry_run on %I', r.tbl);
    execute format('create trigger zz_nano_dry_run after insert or update or delete on %I
                      for each statement execute function nano_dry_run()', r.tbl);
  end loop;
end $$;

-- ---------------------------------------------------------------------------
-- 7b. Policies and guards for her own tables
-- ---------------------------------------------------------------------------

alter table nano_settings enable row level security;
alter table nano_status enable row level security;
alter table nano_asks enable row level security;
alter table nano_changes enable row level security;
alter table nano_approvals enable row level security;
alter table mk_nano enable row level security;

drop policy if exists nano_settings_read on nano_settings;
drop policy if exists nano_settings_write on nano_settings;
create policy nano_settings_read on nano_settings for select to authenticated
  using (household_access() or (select nano_id()) is not null);
create policy nano_settings_write on nano_settings for all to authenticated
  using (is_owner()) with check (is_owner());

-- Anyone in the household reads the heartbeat (the button needs it); only Nano writes it.
drop policy if exists nano_status_read on nano_status;
drop policy if exists nano_status_write on nano_status;
create policy nano_status_read on nano_status for select to authenticated
  using (household_access() or (select nano_id()) is not null);
create policy nano_status_write on nano_status for update to authenticated
  using ((select nano_id()) is not null) with check ((select nano_id()) is not null);

-- Requests: the asker sees and cancels their own; Nano sees and answers all.
drop policy if exists nano_asks_read on nano_asks;
drop policy if exists nano_asks_insert on nano_asks;
drop policy if exists nano_asks_update on nano_asks;
create policy nano_asks_read on nano_asks for select to authenticated
  using (asked_by = current_profile_id() or (select nano_id()) is not null);
create policy nano_asks_insert on nano_asks for insert to authenticated
  with check (asked_by = current_profile_id() and status = 'waiting' and answer is null);
create policy nano_asks_update on nano_asks for update to authenticated
  using (asked_by = current_profile_id() or (select nano_id()) is not null)
  with check (asked_by = current_profile_id() or (select nano_id()) is not null);

/*
  Who asked, and what, never change after the fact. The asker may only
  cancel a request she hasn't picked up; Nano may only move its status and
  write her answer. Scheduled clean-ups (no session) may expire them.
*/
create or replace function nano_asks_guard() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'INSERT' then
    new.asked_by := current_profile_id();
    new.status := 'waiting';
    new.answer := null;
    new.created_at := now();
    new.updated_at := now();
    return new;
  end if;
  if auth.uid() is null then
    new.updated_at := now();
    return new;
  end if;
  if new.asked_by is distinct from old.asked_by or new.body is distinct from old.body
     or new.app_id is distinct from old.app_id or new.screen is distinct from old.screen
     or new.item_table is distinct from old.item_table or new.item_id is distinct from old.item_id
     or new.item_title is distinct from old.item_title or new.created_at is distinct from old.created_at then
    raise exception 'nano: a request can''t be rewritten';
  end if;
  if nano_id() is null then
    if not (old.status = 'waiting' and new.status = 'cancelled' and new.answer is not distinct from old.answer) then
      raise exception 'nano: you can only cancel a request she hasn''t picked up';
    end if;
  elsif new.status = 'cancelled' and old.status <> 'cancelled' then
    raise exception 'nano: only the person who asked can cancel it';
  end if;
  new.updated_at := now();
  return new;
end $$;
drop trigger if exists nano_asks_guard on nano_asks;
create trigger nano_asks_guard before insert or update on nano_asks
  for each row execute function nano_asks_guard();

-- The change log: Avi and Jackie see all of it, others what was done for them.
drop policy if exists nano_changes_read on nano_changes;
create policy nano_changes_read on nano_changes for select to authenticated
  using (is_owner() or acting_for = current_profile_id() or (select nano_id()) is not null);

-- Approvals: Avi, Jackie and Nano see them; any of them can call one off.
drop policy if exists nano_approvals_read on nano_approvals;
drop policy if exists nano_approvals_cancel on nano_approvals;
create policy nano_approvals_read on nano_approvals for select to authenticated
  using (is_owner() or (select nano_id()) is not null);
create policy nano_approvals_cancel on nano_approvals for update to authenticated
  using ((is_owner() or (select nano_id()) is not null) and status = 'waiting')
  with check (status = 'cancelled');

-- ---------------------------------------------------------------------------
-- 8b. The Calendar: her switch, Nano's read, and writes only for her
-- ---------------------------------------------------------------------------

drop policy if exists mk_nano_read on mk_nano;
drop policy if exists mk_nano_write on mk_nano;
create policy mk_nano_read on mk_nano for select to authenticated
  using (id = current_profile_id() or (select nano_id()) is not null);
create policy mk_nano_write on mk_nano for all to authenticated
  using (id = current_profile_id())
  with check (id = current_profile_id() and exists (select 1 from mk_shared s where s.id = current_profile_id()));

/*
  Nano reads a calendar only while its owner's switch is on, and only when
  acting for the owner, her partner, or on her own: never for anyone else.
*/
create or replace function nano_calendar_read(owner uuid) returns boolean
language plpgsql stable security definer set search_path = public as $$
declare
  who uuid;
begin
  if nano_id() is null or owner is null then return false; end if;
  if not coalesce((select can_read from mk_nano where id = owner), false) then return false; end if;
  who := nano_acting_for();
  return who is null
      or who = owner
      or exists (select 1 from mk_shared s where s.id = owner and s.partner_id = who);
end $$;

/* Writes: only while acting for the owner herself, and only with her switch on. */
create or replace function nano_calendar_write(owner uuid) returns boolean
language plpgsql stable security definer set search_path = public as $$
begin
  if nano_id() is null or owner is null then return false; end if;
  if not coalesce((select can_read from mk_nano where id = owner), false) then return false; end if;
  return nano_acting_for() = owner;
end $$;

do $$
declare t text;
begin
  foreach t in array array['mk_events', 'mk_settings', 'mk_trips', 'mk_memos', 'mk_contacts',
                           'mk_source_notes', 'mk_partner', 'mk_reminders'] loop
    execute format('drop policy if exists nano_read on %I', t);
    execute format('create policy nano_read on %I for select to authenticated
                      using ((select nano_id()) is not null and nano_calendar_read(owner_id))', t);
  end loop;
  execute 'drop policy if exists nano_read on mk_shared';
  execute 'create policy nano_read on mk_shared for select to authenticated
             using ((select nano_id()) is not null and nano_calendar_read(id))';
  -- Entries she may save when the owner dictates them. Never the rules
  -- (settings), the shared view, his inputs or the reminder queue.
  foreach t in array array['mk_events', 'mk_trips', 'mk_memos', 'mk_contacts'] loop
    execute format('drop policy if exists nano_insert on %I', t);
    execute format('drop policy if exists nano_update on %I', t);
    execute format('create policy nano_insert on %I for insert to authenticated
                      with check ((select nano_id()) is not null and nano_calendar_write(owner_id))', t);
    execute format('create policy nano_update on %I for update to authenticated
                      using ((select nano_id()) is not null and nano_calendar_write(owner_id))
                      with check ((select nano_id()) is not null and nano_calendar_write(owner_id))', t);
  end loop;
end $$;

-- ---------------------------------------------------------------------------
-- 8c. Things stock: low counts go on the shopping list by themselves
-- ---------------------------------------------------------------------------

/*
  Before each write to a count: if it is at or below its low level and set
  to add itself, and the list doesn't already have it open, add it to the
  shopping list and link the two. Runs as its owner so the shopping item is
  added whoever lowered the count; the item names them as its creator.
*/
create or replace function things_stock_low() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  item uuid;
begin
  new.updated_at := now();
  if not new.auto_add or new.low_at is null or new.on_hand > new.low_at then return new; end if;
  if new.shopping_item_id is not null
     and exists (select 1 from shopping_items where id = new.shopping_item_id and not is_done) then
    return new;
  end if;
  item := gen_random_uuid();
  insert into shopping_items (id, store_id, title, urgency, is_done, created_by, updated_by, sort_order)
  values (item, new.store_id, new.name, 1, false, coalesce(new.updated_by, new.created_by),
          coalesce(new.updated_by, new.created_by), floor(extract(epoch from clock_timestamp()) * 1000));
  new.shopping_item_id := item;
  return new;
end $$;
drop trigger if exists things_stock_low on things_stock;
create trigger things_stock_low before insert or update on things_stock
  for each row execute function things_stock_low();

-- ---------------------------------------------------------------------------
-- Watched ids, the same as the app makes them
-- ---------------------------------------------------------------------------

/* Math.imul for unsigned 32-bit values held in bigints. */
create or replace function nano_imul(a bigint, b bigint) returns bigint
language sql immutable as $$
  select ((a & 4294967295) * (b & 65535) + ((((a & 4294967295) * ((b >> 16) & 65535)) & 65535) << 16)) & 4294967295
$$;

/*
  src/apps/watched/ids.ts's stableId(), in SQL: season, view and rating rows
  are keyed by what they are, so two writers land on the same row. Call it
  with the same parts the app uses, e.g. watch_row_id('season', show_id, '2')
  or watch_row_id('rating', show_id, '0', profile_id).
*/
create or replace function watch_row_id(variadic parts text[]) returns uuid
language plpgsql immutable as $$
declare
  m  constant bigint := 4294967295;
  s  text := array_to_string(parts, '|');
  h1 bigint := 1779033703;
  h2 bigint := 3144134277;
  h3 bigint := 1013904242;
  h4 bigint := 2773480762;
  k  bigint;
  hex text;
  variant text;
begin
  for i in 1 .. length(s) loop
    k := ascii(substr(s, i, 1));
    h1 := h2 # nano_imul(h1 # k, 597399067);
    h2 := h3 # nano_imul(h2 # k, 2869860233);
    h3 := h4 # nano_imul(h3 # k, 951274213);
    h4 := h1 # nano_imul(h4 # k, 2716044179);
  end loop;
  h1 := nano_imul(h3 # (h1 >> 18), 597399067);
  h2 := nano_imul(h4 # (h2 >> 22), 2869860233);
  h3 := nano_imul(h1 # (h3 >> 17), 951274213);
  h4 := nano_imul(h2 # (h4 >> 19), 2716044179);
  h1 := h1 # h2 # h3 # h4;
  h2 := h2 # h1;
  h3 := h3 # h1;
  h4 := h4 # h1;
  hex := lpad(to_hex(h1 & m), 8, '0') || lpad(to_hex(h2 & m), 8, '0')
      || lpad(to_hex(h3 & m), 8, '0') || lpad(to_hex(h4 & m), 8, '0');
  variant := to_hex((('x' || substr(hex, 17, 1))::bit(4)::int & 3) | 8);
  return (substr(hex, 1, 8) || '-' || substr(hex, 9, 4) || '-4' || substr(hex, 14, 3) || '-'
          || variant || substr(hex, 18, 3) || '-' || substr(hex, 21, 12))::uuid;
end $$;

-- ---------------------------------------------------------------------------
-- Realtime, clean-up and grants
-- ---------------------------------------------------------------------------

do $$
declare t text;
begin
  foreach t in array array['nano_asks', 'nano_status', 'nano_settings', 'things_stock', 'mk_nano'] loop
    execute format('alter table %I replica identity full', t);
    begin
      execute format('alter publication supabase_realtime add table %I', t);
    exception when duplicate_object then null;
    end;
  end loop;
end $$;

-- Requests left waiting expire after twelve hours and are cleared after a
-- month; approvals nobody gave a code for lapse after a day.
select cron.unschedule('nano-clean-up')
where exists (select 1 from cron.job where jobname = 'nano-clean-up');
select cron.schedule(
  'nano-clean-up',
  '*/15 * * * *',
  $$
  update public.nano_asks set status = 'expired'
   where status = 'waiting' and created_at < now() - interval '12 hours';
  delete from public.nano_asks where created_at < now() - interval '30 days';
  update public.nano_approvals set status = 'cancelled'
   where status = 'waiting' and created_at < now() - interval '1 day';
  $$
);

-- Internal: never callable through the API.
revoke execute on function nano_spend_code(text) from public, anon, authenticated;
revoke execute on function nano_base32(text) from public, anon, authenticated;
revoke execute on function nano_totp(bytea, bigint) from public, anon, authenticated;
revoke execute on function nano_audit() from public, anon, authenticated;
revoke execute on function nano_guard() from public, anon, authenticated;
revoke execute on function nano_dry_run() from public, anon, authenticated;
revoke execute on function things_stock_low() from public, anon, authenticated;
revoke execute on function nano_asks_guard() from public, anon, authenticated;

-- Signed-in only.
revoke execute on function nano_id() from public, anon;
revoke execute on function nano_header(text) from public, anon;
revoke execute on function nano_acting_for() from public, anon;
revoke execute on function nano_reach(text, uuid[], boolean) from public, anon;
revoke execute on function profile_has_app(uuid, text) from public, anon;
revoke execute on function nano_owe_member(text) from public, anon;
revoke execute on function nano_calendar_read(uuid) from public, anon;
revoke execute on function nano_calendar_write(uuid) from public, anon;
revoke execute on function nano_undo(uuid) from public, anon;
revoke execute on function nano_request_approval(text, text, text, integer, uuid) from public, anon;
revoke execute on function nano_approve(uuid, text) from public, anon;
revoke execute on function nano_set_authenticator(text, text) from public, anon;
revoke execute on function nano_authenticator_set_at() from public, anon;
grant execute on function nano_id(), nano_header(text), nano_acting_for(), nano_reach(text, uuid[], boolean),
  profile_has_app(uuid, text), nano_owe_member(text), nano_calendar_read(uuid), nano_calendar_write(uuid),
  nano_undo(uuid), nano_request_approval(text, text, text, integer, uuid), nano_approve(uuid, text),
  nano_set_authenticator(text, text), nano_authenticator_set_at(), watch_row_id(text[])
  to authenticated;

comment on table nano_changes is 'Every change Nano makes in an app table, written by a trigger, with the row before and after. Undo with nano_undo(). The Calendar is never logged.';
comment on table nano_asks is 'Requests to Nano from the launcher''s Nano button. asked_by is written by the database from the session that saved the row.';
comment on table nano_approvals is 'What Nano asked to do that needs Avi''s code. Each is approved with one code (nano_approve) and used once.';
comment on table nano_authenticator is 'The setup key Avi''s approval codes are checked against. Read only by the nano_* functions; RLS on with no policies on purpose.';

-- Fixed search paths for the helpers above that don't run as their owner.
alter function nano_header(text) set search_path = public;
alter function nano_tables() set search_path = public;
alter function household_settings_guard() set search_path = public;
alter function nano_base32(text) set search_path = public;
alter function nano_totp(bytea, bigint) set search_path = public, extensions;
alter function nano_dry_run() set search_path = public;
alter function nano_imul(bigint, bigint) set search_path = public;
alter function watch_row_id(text[]) set search_path = public;
