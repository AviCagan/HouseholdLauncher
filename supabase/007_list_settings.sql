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
