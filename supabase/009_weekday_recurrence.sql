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
