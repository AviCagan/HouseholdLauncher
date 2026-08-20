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
