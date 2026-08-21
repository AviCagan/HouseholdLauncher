-- Household Launcher — stolen claims
--
-- Safe to run more than once. Run it after 015_launcher.sql.
--
-- ---------------------------------------------------------------------------
-- What this adds
--
-- Claiming used to be first-come-first-served and final: the database refused
-- a claim on anything already spoken for, and the app said "Jackie got there
-- first". That is the right rule for the race between two phones tapping at
-- once, and the wrong rule for the far more common case — one person claims
-- the shopping, the other is actually going past the shop.
--
-- So a claim can now be taken over, and because taking one is a small act of
-- domestic theft it gets counted. `stolen` is a new activity_log event, which
-- means it lands in the same feed as everything else and the scoreboard can
-- count it without a second source of truth to keep in step.
-- ---------------------------------------------------------------------------

-- The event vocabulary is a CHECK rather than an enum, so widening it is an
-- ordinary constraint swap and not a migration that can't run in a transaction.
alter table activity_log drop constraint if exists activity_log_event_check;
alter table activity_log add constraint activity_log_event_check
  check (event in (
    'added', 'edited', 'completed', 'uncompleted',
    'claimed', 'unclaimed', 'deleted', 'stolen'
  ));

/*
  Record who lost the claim, not just who took it.

  `actor_id` already says who did it, and every other event needs nothing more.
  A theft has two people in it, and "3 stolen from you this week" is the half
  that makes the metric worth showing — recoverable only if the victim is
  written down at the time. Nullable because every other event leaves it empty.
*/
alter table activity_log
  add column if not exists subject_id uuid references profiles(id) on delete set null;

/*
  Teach the activity trigger to tell a steal from a claim.

  The existing claimed/unclaimed branch only fires when claimed_by crosses
  null — `(old.claimed_by is null) <> (new.claimed_by is null)` — so one person
  replacing another was invisible to it, and fell through to the generic
  'edited' branch or to nothing at all. This adds the missing transition ahead
  of that check, since a steal is also a change of claim and would otherwise be
  reported as the less specific event.

  Everything else in log_activity() is unchanged; it is restated in full
  because Postgres has no way to patch one branch of a function body.
*/
create or replace function log_activity() returns trigger
language plpgsql as $$
declare
  evt text;
  actor uuid;
  subject uuid;
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
      strictly in the body. old/new are the generic trigger RECORD type here,
      and PL/pgSQL resolves a record field reference by preparing the whole
      boolean expression it appears in as a single SPI query before any
      short-circuiting happens — so folding a table check and a field access
      into one condition throws "record has no field" on the wrong table even
      though the first operand is false.
    */

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

    -- The new branch. Checked BEFORE claimed/unclaimed: a steal changes
    -- claimed_by without crossing null, so the older check misses it entirely,
    -- but ordering it first also keeps the intent obvious to anyone reading.
    if evt is null and tg_table_name in ('todos','chores','shopping_items') then
      if old.claimed_by is not null
        and new.claimed_by is not null
        and old.claimed_by <> new.claimed_by then
        evt := 'stolen';
        actor := new.claimed_by;
        subject := old.claimed_by;
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
      -- Nothing log-worthy — sort_order shuffling from a drag, or the ticker
      -- touching next_due_at. Silently skip rather than logging noise.
      return coalesce(new, old);
    end if;
  end if;

  insert into activity_log (table_name, row_id, title, event, actor_id, subject_id)
  values (tg_table_name, item_id, item_title, evt, actor, subject);

  return coalesce(new, old);
end $$;

-- Counting "how many were taken off me" scans by victim, which nothing else
-- does. Partial, so it stays small — thefts are rare next to everything else
-- the log holds.
create index if not exists activity_log_stolen_idx
  on activity_log (subject_id, created_at desc) where event = 'stolen';
