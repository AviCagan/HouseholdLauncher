-- Household Launcher — Med School 2028
--
-- Safe to run more than once. Run it after 015_launcher.sql.
--
-- ---------------------------------------------------------------------------
-- One person's plan for getting into medical school: the MCAT date and the
-- study phases hung off it, the college's pre-health committee file (hours,
-- letters, the eligibility checklist), the academic record the application
-- GPAs come from, and every deadline in between.
--
-- Schema only. The plan itself goes in through the app's Import, never
-- through this file — the repository is public and the plan is personal.
--
--   ms_settings      the test date and the plan's settings, one row, plus
--                    the reference material that only ever gets read (the
--                    MCAT calendar, fees, committee rules, contacts …)
--   ms_tasks         every dated thing to do, built-in or added
--   ms_counters      shadowing hours, service hours, club meetings
--   ms_counter_logs  one dated entry towards a counter
--   ms_eligibility   the committee's checklist
--   ms_letters       each letter of recommendation and how far along it is
--   ms_courses       the academic record, one row per course per term
--   ms_practice      practice MCAT scores
--   ms_questions     things to ask the advisor
--
-- Ids are text: the built-in rows keep the ids the plan was written with
-- ("m-test", "l-research"), so importing the same plan twice updates rather
-- than duplicates. Rows made in the app get a UUID string.
-- ---------------------------------------------------------------------------

create table if not exists ms_settings (
  singleton      boolean primary key default true check (singleton),
  -- The MCAT date everything anchored is worked out from. One of the dates
  -- in reference->'mcatCalendar2027'.
  test_date      date,
  booked         boolean not null default false,
  order_number   text,
  target_score   integer check (target_score is null or target_score between 472 and 528),
  -- Off hides the tasks whose dates are only estimates.
  show_estimated boolean not null default true,
  -- Everything from the plan that the app reads but never edits. Kept whole
  -- so an Export gives back what an Import was given.
  reference      jsonb not null default '{}'::jsonb,
  updated_by     uuid references profiles(id) on delete set null,
  updated_at     timestamptz not null default now()
);

insert into ms_settings (singleton) values (true) on conflict (singleton) do nothing;

create table if not exists ms_tasks (
  id          text primary key,
  title       text not null check (length(trim(title)) > 0),
  -- MCAT, CSI, Letters, Hours, Apply, AMCAS, AACOMAS, School.
  area        text not null,
  -- A task is due either on a fixed date, or a number of days from an
  -- anchor worked out from the test date ("T", "score", "csiInterview" …).
  due_fixed   date,
  due_anchor  text,
  due_offset  integer not null default 0,
  -- The due date as of the current test date. Derived — the app keeps it
  -- current whenever the test date or the task changes — and stored only so
  -- the reminder sweep can find what is due without the date logic.
  due_on      date,
  hard        boolean not null default false,
  estimated   boolean not null default false,
  note        text,
  -- Came with the plan: can be edited and hidden, not deleted.
  builtin     boolean not null default false,
  hidden      boolean not null default false,
  done_at     timestamptz,
  done_by     uuid references profiles(id) on delete set null,
  -- The due date each reminder was sent for, so a reminder goes out once per
  -- date — and again if the date moves.
  reminded_early_for date,
  reminded_day_for   date,
  created_by  uuid references profiles(id) on delete set null,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  constraint ms_tasks_has_due check (due_fixed is not null or due_anchor is not null)
);

create index if not exists ms_tasks_due_idx on ms_tasks (due_on) where done_at is null;

create table if not exists ms_counters (
  id          text primary key,
  label       text not null,
  -- "h" or "meetings".
  unit        text not null default 'h',
  target      numeric(8, 2) not null check (target > 0),
  -- Counted before anything was logged with a date. The total is this plus
  -- the log.
  undated     numeric(8, 2) not null default 0 check (undated >= 0),
  note        text,
  -- A limit on how much of the total one source may supply (an observer
  -- program's cap), shown as a warning, never enforced.
  cap         numeric(8, 2) check (cap is null or cap > 0),
  cap_note    text,
  sort        integer not null default 0,
  updated_at  timestamptz not null default now()
);

create table if not exists ms_counter_logs (
  id          text primary key,
  counter_id  text not null references ms_counters(id) on delete cascade,
  on_date     date not null,
  -- Hours, or 1 for a meeting.
  amount      numeric(8, 2) not null check (amount > 0),
  note        text,
  created_by  uuid references profiles(id) on delete set null,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create index if not exists ms_counter_logs_counter_idx on ms_counter_logs (counter_id, on_date);

create table if not exists ms_eligibility (
  id          text primary key,
  title       text not null,
  note        text,
  met         boolean not null default false,
  -- Some items are the same thing as a task ("met with the advisor"). Then
  -- the task's done state is the answer and `met` is not used.
  task_id     text references ms_tasks(id) on delete set null,
  sort        integer not null default 0,
  updated_at  timestamptz not null default now()
);

create table if not exists ms_letters (
  id          text primary key,
  title       text not null,
  note        text,
  status      text not null default 'not_asked'
              check (status in ('not_asked', 'asked', 'agreed', 'received')),
  asked_on    date,
  agreed_on   date,
  received_on date,
  sort        integer not null default 0,
  updated_at  timestamptz not null default now()
);

create table if not exists ms_courses (
  id               text primary key,
  -- "Fall 2026", "Winter 2027".
  term             text not null,
  code             text not null,
  title            text,
  -- A–F with +/-, or IP, W, P. Only letter grades count towards a GPA.
  grade            text,
  credits          numeric(4, 1) not null default 0 check (credits >= 0),
  -- Drives the science GPAs: bio, chem, phys and math are AMCAS science
  -- (BCPM); AACOMAS leaves math out.
  category         text not null check (category in ('bio', 'chem', 'phys', 'math', 'other')),
  category_note    text,
  -- Classified as science here but might not be by the application service,
  -- so the science GPAs are shown as a range.
  maybe_nonscience boolean not null default false,
  -- Came with the plan rather than added in the app.
  imported         boolean not null default false,
  sort             integer not null default 0,
  updated_at       timestamptz not null default now()
);

create table if not exists ms_practice (
  id          text primary key,
  taken_on    date not null,
  -- "AAMC FL1", "Blueprint FL2".
  source      text,
  total       integer check (total is null or total between 472 and 528),
  cp          integer check (cp is null or cp between 118 and 132),
  cars        integer check (cars is null or cars between 118 and 132),
  bb          integer check (bb is null or bb between 118 and 132),
  ps          integer check (ps is null or ps between 118 and 132),
  note        text,
  created_by  uuid references profiles(id) on delete set null,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create table if not exists ms_questions (
  id          text primary key,
  text        text not null check (length(trim(text)) > 0),
  done        boolean not null default false,
  done_at     timestamptz,
  sort        integer not null default 0,
  updated_at  timestamptz not null default now()
);

-- updated_at, kept honest by the database rather than by every caller.
create or replace function ms_touch() returns trigger
language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end $$;

do $$
declare t text;
begin
  foreach t in array array['ms_settings', 'ms_tasks', 'ms_counters', 'ms_counter_logs', 'ms_eligibility',
                           'ms_letters', 'ms_courses', 'ms_practice', 'ms_questions'] loop
    execute format('drop trigger if exists %I_touch on %I', t, t);
    execute format(
      'create trigger %I_touch before update on %I
         for each row execute function ms_touch()', t, t);
  end loop;
end $$;

-- ---------------------------------------------------------------------------
-- Row level security: app-scoped on 'medschool', like every other app. Not
-- for everyone by default — and the launcher only shows the tile to someone
-- with an explicit grant, owners included (see `explicitGrant` in the
-- registry).
-- ---------------------------------------------------------------------------
do $$
declare t text;
begin
  foreach t in array array['ms_settings', 'ms_tasks', 'ms_counters', 'ms_counter_logs', 'ms_eligibility',
                           'ms_letters', 'ms_courses', 'ms_practice', 'ms_questions'] loop
    execute format('alter table %I enable row level security', t);
    execute format('drop policy if exists %I_rw on %I', t, t);
    execute format(
      'create policy %I_rw on %I for all to authenticated
         using (has_app(''medschool'')) with check (has_app(''medschool''))', t, t);
  end loop;
end $$;

-- ---------------------------------------------------------------------------
-- Realtime, so a box ticked on the phone is ticked on the laptop.
-- REPLICA IDENTITY FULL is what lets deletes sync under RLS.
-- ---------------------------------------------------------------------------
do $$
declare t text;
begin
  foreach t in array array['ms_settings', 'ms_tasks', 'ms_counters', 'ms_counter_logs', 'ms_eligibility',
                           'ms_letters', 'ms_courses', 'ms_practice', 'ms_questions'] loop
    execute format('alter table %I replica identity full', t);
    begin
      execute format('alter publication supabase_realtime add table %I', t);
    exception when duplicate_object then null;
    end;
  end loop;
end $$;

-- ---------------------------------------------------------------------------
-- Reminders for hard deadlines, three days before and on the day, come from
-- the `notify` function's existing five-minute sweep (the one that announces
-- chores coming off cooldown), so there is no schedule to add here. It reads
-- ms_tasks.due_on and writes reminded_*_for with the service role.
-- ---------------------------------------------------------------------------
