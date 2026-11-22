-- Household Launcher — Mikvah Calendar
--
-- Safe to run more than once. Run it after 015_launcher.sql and
-- 005_notifications.sql. Before running, replace <PROJECT_REF> in the cron
-- job at the bottom with the project's ref, as in 005.
--
-- The most private data in the launcher, so the access rules are stricter
-- than anywhere else and live here, in the database, not in the app:
--
--   * Her records (mk_events, mk_settings, mk_trips, mk_memos, mk_contacts,
--     mk_source_notes) are readable and writable only by the member they
--     belong to: owner_id = current_profile_id(). No has_app(), no owner
--     override, and no legacy shared-account bypass — a phone still signed in
--     as the old shared account reads nothing here at all.
--   * When she turns sharing on (mk_shared.share_details), the partner she
--     named can READ them too. Never write.
--   * His view reads one row, mk_shared, which her phone publishes after
--     every recompute: status, onot perishah with times, mikvah night, the
--     beinonit tick. Nothing else.
--   * His inputs (away dates, shiva, reminder choices) are mk_partner: he
--     writes, she reads.
--   * mk_reminders is the queue the notify function sends from, one row per
--     recipient, worded neutrally unless she turns detail on.
--   * Only a member explicitly granted the app (app_access, never the owner
--     default) can start a calendar or be named as its partner, so nobody
--     else can point reminders at either of them.
--
-- Raw events only. Every status and date is recomputed from them; a mistaken
-- entry is voided (voided_at), never deleted, so nothing here is lost.
-- Nothing personal goes in this file: the repository is public.
-- ---------------------------------------------------------------------------

create table if not exists mk_shared (
  -- Her profile: one row per calendar.
  id             uuid primary key references profiles(id) on delete cascade,
  partner_id     uuid references profiles(id) on delete set null,
  -- What his phone shows. Derived; replaced on every publish.
  snapshot       jsonb not null default '{}'::jsonb,
  share_details  boolean not null default false,
  published_at   timestamptz,
  updated_at     timestamptz not null default now()
);

-- Who may read an owner's private rows: the owner, or the partner she shares with.
create or replace function mk_can_read(owner uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select owner is not null and (
    owner = current_profile_id()
    or exists (
      select 1 from mk_shared s
       where s.id = owner
         and s.share_details
         and s.partner_id is not null
         and s.partner_id = current_profile_id()
    )
  )
$$;

-- Granted the app explicitly. Not has_app(): that lets owners and the old
-- shared account through, and this app is shown to nobody by default.
create or replace function mk_granted(who uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select who is not null and exists (
    select 1 from app_access a where a.profile_id = who and a.app_id = 'mikvah' and a.granted
  )
$$;

create table if not exists mk_events (
  id          uuid primary key,
  owner_id    uuid not null references profiles(id) on delete cascade,
  kind        text not null check (kind in (
                'flow', 'hefsek', 'moch', 'bedikah', 'stain', 'immersion',
                'pregnancy', 'birth', 'miscarriage', 'kallah', 'medication',
                'symptom', 'menopause', 'seed', 'kavua', 'ruling', 'nursing')),
  at          timestamptz not null,
  result      text check (result is null or result in ('clean', 'not_clean', 'question')),
  -- Kind-specific details: a ruling's flag and outcome, a moch forgotten, a note.
  data        jsonb not null default '{}'::jsonb,
  voided_at   timestamptz,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create index if not exists mk_events_owner_at_idx on mk_events (owner_id, at);

-- Settings are versioned: a new row per change, never an update, so a past
-- date can be explained under the settings in force then.
create table if not exists mk_settings (
  id              uuid primary key,
  owner_id        uuid not null references profiles(id) on delete cascade,
  settings        jsonb not null,
  effective_from  timestamptz not null default now(),
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);
create index if not exists mk_settings_owner_idx on mk_settings (owner_id, effective_from);

create table if not exists mk_trips (
  id          uuid primary key,
  owner_id    uuid not null references profiles(id) on delete cascade,
  name        text not null default '',
  lat         double precision not null check (lat between -90 and 90),
  lng         double precision not null check (lng between -180 and 180),
  tz          text not null,
  from_day    date not null,
  to_day      date not null check (to_day >= from_day),
  voided_at   timestamptz,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create table if not exists mk_memos (
  id          uuid primary key,
  owner_id    uuid not null references profiles(id) on delete cascade,
  day         date not null,
  body        text not null default '',
  voided_at   timestamptz,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create table if not exists mk_contacts (
  id          uuid primary key,
  owner_id    uuid not null references profiles(id) on delete cascade,
  name        text not null,
  phone       text,
  note        text,
  sort        double precision not null default extract(epoch from now()),
  voided_at   timestamptz,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

-- Corrections to the rule registry's citations: flip `checked`, fix a ref.
create table if not exists mk_source_notes (
  -- owner:rule:index, so the same correction made twice is one row.
  id          text primary key,
  owner_id    uuid not null references profiles(id) on delete cascade,
  rule_id     text not null,
  idx         integer not null check (idx >= 0),
  ref         text,
  checked     boolean,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create table if not exists mk_partner (
  -- His profile.
  id          uuid primary key references profiles(id) on delete cascade,
  -- Her profile: whose calendar these inputs belong to.
  owner_id    uuid not null references profiles(id) on delete cascade,
  -- [{"from": "YYYY-MM-DD", "to": "YYYY-MM-DD"}, ...]
  away        jsonb not null default '[]'::jsonb,
  shiva       jsonb not null default '[]'::jsonb,
  -- Which reminders he wants.
  prefs       jsonb not null default '{}'::jsonb,
  updated_at  timestamptz not null default now()
);

create table if not exists mk_reminders (
  -- The reminder's stable key and its recipient, so a recompute updates in place.
  id          text primary key,
  owner_id    uuid not null references profiles(id) on delete cascade,
  target_id   uuid not null references profiles(id) on delete cascade,
  fire_at     timestamptz not null,
  title       text not null,
  body        text not null,
  rule_id     text,
  cancelled   boolean not null default false,
  sent_at     timestamptz,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create index if not exists mk_reminders_due_idx on mk_reminders (fire_at) where sent_at is null and not cancelled;

-- updated_at, kept by the database.
create or replace function mk_touch() returns trigger
language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end $$;

do $$
declare t text;
begin
  foreach t in array array['mk_shared', 'mk_events', 'mk_settings', 'mk_trips', 'mk_memos', 'mk_contacts',
                           'mk_source_notes', 'mk_partner', 'mk_reminders'] loop
    execute format('drop trigger if exists %I_touch on %I', t, t);
    execute format('create trigger %I_touch before update on %I for each row execute function mk_touch()', t, t);
  end loop;
end $$;

-- ---------------------------------------------------------------------------
-- Row level security
-- ---------------------------------------------------------------------------
do $$
declare t text;
begin
  foreach t in array array['mk_shared', 'mk_events', 'mk_settings', 'mk_trips', 'mk_memos', 'mk_contacts',
                           'mk_source_notes', 'mk_partner', 'mk_reminders'] loop
    execute format('alter table %I enable row level security', t);
    execute format('drop policy if exists %I_rw on %I', t, t);
    execute format('drop policy if exists %I_read on %I', t, t);
    execute format('drop policy if exists %I_write on %I', t, t);
    execute format('drop policy if exists %I_update on %I', t, t);
    execute format('drop policy if exists %I_delete on %I', t, t);
  end loop;
end $$;

-- Her private records: she reads and writes; he reads only when she shares.
do $$
declare t text;
begin
  foreach t in array array['mk_events', 'mk_settings', 'mk_trips', 'mk_memos', 'mk_contacts', 'mk_source_notes'] loop
    execute format('create policy %I_read on %I for select to authenticated using (mk_can_read(owner_id))', t, t);
    execute format('create policy %I_write on %I for insert to authenticated with check (owner_id = current_profile_id())', t, t);
    execute format('create policy %I_update on %I for update to authenticated
                      using (owner_id = current_profile_id()) with check (owner_id = current_profile_id())', t, t);
  end loop;
end $$;
-- Settings are history: no updates, ever. (Deleting anything is left out on purpose.)
drop policy if exists mk_settings_update on mk_settings;

-- The published view: she writes her row; she and her partner read it.
create policy mk_shared_read on mk_shared for select to authenticated
  using (id = current_profile_id() or (partner_id is not null and partner_id = current_profile_id()));
create policy mk_shared_write on mk_shared for insert to authenticated
  with check (id = current_profile_id() and mk_granted(id) and (partner_id is null or mk_granted(partner_id)));
create policy mk_shared_update on mk_shared for update to authenticated
  using (id = current_profile_id())
  with check (id = current_profile_id() and mk_granted(id) and (partner_id is null or mk_granted(partner_id)));

-- His inputs: he writes his row, for the calendar that names him; she reads it.
create policy mk_partner_read on mk_partner for select to authenticated
  using (id = current_profile_id() or owner_id = current_profile_id());
create policy mk_partner_write on mk_partner for insert to authenticated
  with check (
    id = current_profile_id()
    and exists (select 1 from mk_shared s where s.id = owner_id and s.partner_id = current_profile_id())
  );
create policy mk_partner_update on mk_partner for update to authenticated
  using (id = current_profile_id())
  with check (
    id = current_profile_id()
    and exists (select 1 from mk_shared s where s.id = owner_id and s.partner_id = current_profile_id())
  );

-- The reminder queue: written by her phone for both of them; each reads their own.
create policy mk_reminders_read on mk_reminders for select to authenticated
  using (owner_id = current_profile_id() or target_id = current_profile_id());
create policy mk_reminders_write on mk_reminders for insert to authenticated
  with check (
    owner_id = current_profile_id()
    and (target_id = current_profile_id()
         or exists (select 1 from mk_shared s where s.id = current_profile_id() and s.partner_id = target_id))
  );
create policy mk_reminders_update on mk_reminders for update to authenticated
  using (owner_id = current_profile_id())
  with check (
    owner_id = current_profile_id()
    and (target_id = current_profile_id()
         or exists (select 1 from mk_shared s where s.id = current_profile_id() and s.partner_id = target_id))
  );

-- ---------------------------------------------------------------------------
-- Realtime, so his phone hears her publish without a reload. Realtime checks
-- these same policies per subscriber. REPLICA IDENTITY FULL lets deletes sync.
-- No notify_change() trigger on any of these: nothing here is announced.
-- ---------------------------------------------------------------------------
do $$
declare t text;
begin
  foreach t in array array['mk_shared', 'mk_events', 'mk_settings', 'mk_trips', 'mk_memos', 'mk_contacts',
                           'mk_source_notes', 'mk_partner', 'mk_reminders'] loop
    execute format('alter table %I replica identity full', t);
    begin
      execute format('alter publication supabase_realtime add table %I', t);
    exception when duplicate_object then null;
    end;
  end loop;
end $$;

-- ---------------------------------------------------------------------------
-- Reminders to the minute: a job every minute that calls the notify function
-- only when something is due, so an idle minute costs one indexed query.
-- ---------------------------------------------------------------------------
select cron.unschedule('mikvah-reminders')
where exists (select 1 from cron.job where jobname = 'mikvah-reminders');

select cron.schedule(
  'mikvah-reminders',
  '* * * * *',
  $$
  select net.http_post(
    url     := 'https://<PROJECT_REF>.supabase.co/functions/v1/notify',
    headers := jsonb_build_object('Content-Type', 'application/json'),
    body    := '{"mode":"sweep_mikvah"}'::jsonb
  )
  where exists (
    select 1 from public.mk_reminders
     where sent_at is null and not cancelled
       and fire_at <= now() and fire_at > now() - interval '2 hours'
  );
  $$
);
