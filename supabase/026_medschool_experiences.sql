-- Household Launcher — Med School 2028: experiences
--
-- Safe to run more than once. Run it after 025_medschool.sql.
--
-- ---------------------------------------------------------------------------
-- Everything that counts towards the committee file or the application, one
-- record each: shadowing, community service, clinical work paid or volunteer,
-- research, clubs, jobs, leadership. A record carries its own dated log and,
-- for an opportunity still being set up, an onboarding checklist.
--
-- The committee's targets stay in ms_counters (hours of shadowing, hours of
-- service, club meetings); an experience says which one it counts towards
-- and the totals roll up from there. ms_counter_logs is no longer read — its
-- entries were copied into ms_experience_logs — and is left in place.
--
-- Schema only, like 025: the records themselves are personal and never go in
-- the repository.
--
--   ms_experiences       one per experience
--   ms_experience_logs   one dated entry: hours, or a club meeting
--   ms_experience_steps  an onboarding checklist item, optionally dated
-- ---------------------------------------------------------------------------

create table if not exists ms_experiences (
  id              text primary key,
  kind            text not null check (kind in ('shadowing', 'service', 'clinical_volunteer', 'clinical_paid',
                                                'research', 'club', 'employment', 'leadership', 'other')),
  -- The organization, or the person or program's name.
  name            text not null check (length(trim(name)) > 0),
  role            text,
  contact         text,
  location        text,
  -- "2021", "2021-03" or "2021-03-05": an application asks for the month,
  -- and a job from five years ago may only be known to the year. No end
  -- means it's still going.
  start_on        text check (start_on is null or start_on ~ '^\d{4}(-(0[1-9]|1[0-2])(-(0[1-9]|[12]\d|3[01]))?)?$'),
  end_on          text check (end_on is null or end_on ~ '^\d{4}(-(0[1-9]|1[0-2])(-(0[1-9]|[12]\d|3[01]))?)?$'),
  status          text not null default 'prospect'
                  check (status in ('prospect', 'reached_out', 'onboarding', 'active', 'done', 'declined')),
  notes           text,
  -- What the application's description box gets.
  description     text,
  -- Shadowing.
  specialty       text,
  physician_type  text check (physician_type is null or physician_type in ('MD', 'DO')),
  -- An observer program's limit: so many hours, by a date. Warned about,
  -- never enforced.
  cap_hours       numeric(6, 2) check (cap_hours is null or cap_hours > 0),
  cap_until       date,
  -- Hours (or meetings, for a club) not in the log: counted before dates were
  -- kept, or a paid job's estimate. The total is this plus the log.
  prior           numeric(8, 2) not null default 0 check (prior >= 0),
  prior_as_of     date,
  -- Which committee target the total counts towards, if any.
  counts_toward   text references ms_counters(id) on delete set null,
  letter_id       text references ms_letters(id) on delete set null,
  sort            integer not null default 0,
  created_by      uuid references profiles(id) on delete set null,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

create table if not exists ms_experience_logs (
  id             text primary key,
  experience_id  text not null references ms_experiences(id) on delete cascade,
  on_date        date not null,
  start_time     time,
  end_time       time,
  -- Required for hours; a club meeting is one meeting and may leave it out.
  hours          numeric(6, 2) check (hours is null or hours > 0),
  note           text,
  created_by     uuid references profiles(id) on delete set null,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);

create index if not exists ms_experience_logs_exp_idx on ms_experience_logs (experience_id, on_date);

create table if not exists ms_experience_steps (
  id             text primary key,
  experience_id  text not null references ms_experiences(id) on delete cascade,
  title          text not null check (length(trim(title)) > 0),
  -- A dated step also shows in the timeline.
  due_on         date,
  done_at        timestamptz,
  done_by        uuid references profiles(id) on delete set null,
  sort           integer not null default 0,
  updated_at     timestamptz not null default now()
);

create index if not exists ms_experience_steps_exp_idx on ms_experience_steps (experience_id, sort);

-- updated_at, by the same trigger as the rest of Med School (025).
do $$
declare t text;
begin
  foreach t in array array['ms_experiences', 'ms_experience_logs', 'ms_experience_steps'] loop
    execute format('drop trigger if exists %I_touch on %I', t, t);
    execute format(
      'create trigger %I_touch before update on %I
         for each row execute function ms_touch()', t, t);
  end loop;
end $$;

-- Row level security: app-scoped on 'medschool', exactly as in 025.
do $$
declare t text;
begin
  foreach t in array array['ms_experiences', 'ms_experience_logs', 'ms_experience_steps'] loop
    execute format('alter table %I enable row level security', t);
    execute format('drop policy if exists %I_rw on %I', t, t);
    execute format(
      'create policy %I_rw on %I for all to authenticated
         using (has_app(''medschool'')) with check (has_app(''medschool''))', t, t);
  end loop;
end $$;

-- Realtime, with REPLICA IDENTITY FULL so deletes sync under RLS.
do $$
declare t text;
begin
  foreach t in array array['ms_experiences', 'ms_experience_logs', 'ms_experience_steps'] loop
    execute format('alter table %I replica identity full', t);
    begin
      execute format('alter publication supabase_realtime add table %I', t);
    exception when duplicate_object then null;
    end;
  end loop;
end $$;
