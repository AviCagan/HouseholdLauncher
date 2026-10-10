-- Household Launcher — Watched (working title)
--
-- Safe to run more than once. Run it after 015_launcher.sql.
--
-- Four tables:
--
--   watch_shows     every show the household has an opinion about, wherever it
--                   sits: on someone's shelf, in the lineup, playing now,
--                   watched, or dropped. One row per show for its whole life,
--                   so its ratings and history never scatter across copies.
--   watch_seasons   when each season was started and finished. This is what
--                   the pace is measured from, and so every estimated date.
--   watch_ratings   one score per person per season, or per show (season 0).
--   watch_settings  the household's pace setting, one row.
--
-- Show data (seasons, episode runtimes, air dates) comes from TVmaze and is
-- cached on the row, so the estimates work offline and the app doesn't ask
-- TVmaze about every show on every launch.
-- ---------------------------------------------------------------------------

create table if not exists watch_shows (
  id               uuid primary key,
  -- Null for a show typed in by hand because TVmaze doesn't have it.
  tvmaze_id        integer,
  title            text not null check (length(trim(title)) > 0),
  premiered        date,
  ended            date,
  -- TVmaze's own words: Running, Ended, To Be Determined, In Development.
  status           text,
  network          text,
  genres           text[] not null default '{}',
  summary          text,
  -- The chosen picture. Swappable, so it is a column, not derived.
  poster_url       text,
  avg_runtime      integer check (avg_runtime is null or avg_runtime > 0),
  -- [[season, number, runtime_minutes | null, airdate | null], ...] — compact
  -- on purpose: a long-running sitcom is hundreds of episodes.
  episodes         jsonb not null default '[]'::jsonb,
  -- [{"n": 1, "eps": 9, "premiere": "2022-02-18", "end": "2022-04-08"}, ...]
  -- Includes announced seasons with no episodes yet.
  seasons          jsonb not null default '[]'::jsonb,
  next_airdate     date,
  data_updated_at  timestamptz,

  stage            text not null default 'shelf'
                     check (stage in ('shelf', 'lineup', 'watching', 'watched', 'dropped')),
  -- Whose shelf it is on. Null is the shared shelf. Kept after it leaves the
  -- shelf, so the lineup can still say whose idea it was.
  shelf_owner      uuid references profiles(id) on delete set null,
  -- Fractional orders, so a drag is one write of a midpoint rather than a
  -- renumbering of the whole list.
  shelf_order      double precision not null default extract(epoch from now()),
  lineup_order     double precision not null default extract(epoch from now()),
  -- Watch it as it airs (alongside whatever else is on) rather than in turn.
  live             boolean not null default false,
  -- The seasons this lineup slot covers, inclusive. Null means "from where
  -- we are" and "through the last season there is".
  plan_from        integer check (plan_from is null or plan_from >= 1),
  plan_to          integer check (plan_to is null or plan_to >= 1),
  current_season   integer check (current_season is null or current_season >= 1),
  -- Episodes finished within current_season, when someone said so. Null
  -- progress_at means nobody did, and the app estimates it from the pace.
  current_episode  integer not null default 0 check (current_episode >= 0),
  progress_at      timestamptz,
  started_at       timestamptz,
  finished_at      timestamptz,
  -- Added after the fact to rate it. No dates, so it never skews the pace.
  watched_before   boolean not null default false,

  created_by       uuid references profiles(id) on delete set null,
  updated_by       uuid references profiles(id) on delete set null,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),

  constraint watch_plan_order
    check (plan_from is null or plan_to is null or plan_from <= plan_to),
  -- Playing means playing something: the season is what every estimate of
  -- "where are we" starts from.
  constraint watch_watching_has_season
    check (stage <> 'watching' or current_season is not null)
);

-- One row per show. Two phones adding the same show at once is a real race,
-- and the loser should be told it's already there rather than make a twin
-- with its own ratings.
create unique index if not exists watch_shows_tvmaze_uniq
  on watch_shows (tvmaze_id) where tvmaze_id is not null;
create index if not exists watch_shows_stage_idx on watch_shows (stage);

create table if not exists watch_seasons (
  -- Derived from (show, season) on the client, so both phones finishing the
  -- same season write the same row instead of racing to create two.
  id             uuid primary key,
  show_id        uuid not null references watch_shows(id) on delete cascade,
  season         integer not null check (season >= 1),
  -- Copied from the show when the row is made, so a "season finished"
  -- notification can name it without the sender looking anything up.
  show_title     text,
  started_at     timestamptz,
  finished_at    timestamptz,
  watched_before boolean not null default false,
  created_by     uuid references profiles(id) on delete set null,
  updated_by     uuid references profiles(id) on delete set null,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  constraint watch_season_once unique (show_id, season)
);

-- For a database that ran an earlier copy of this file.
alter table watch_seasons add column if not exists show_title text;

create table if not exists watch_ratings (
  -- Derived from (show, season, person), for the same reason as above.
  id          uuid primary key,
  show_id     uuid not null references watch_shows(id) on delete cascade,
  -- 0 is the show as a whole; 1+ is that season.
  season      integer not null default 0 check (season >= 0),
  profile_id  uuid not null references profiles(id) on delete cascade,
  -- The score doubled, so half points are whole numbers: 17 is 8.5 out of 10.
  -- An integer rather than numeric because numeric can arrive as a string in
  -- a realtime payload and as a number from the REST API.
  score_x2    smallint not null check (score_x2 between 1 and 20),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  constraint watch_rating_once unique (show_id, season, profile_id)
);

create table if not exists watch_settings (
  singleton     boolean primary key default true check (singleton),
  -- auto: measured from finished seasons; manual: whatever was dialled in.
  pace_mode     text not null default 'auto' check (pace_mode in ('auto', 'manual')),
  -- Minutes of TV a week. 240 is four hours, about an episode a night.
  pace_minutes  integer not null default 240 check (pace_minutes between 15 and 10080),
  updated_by    uuid references profiles(id) on delete set null,
  updated_at    timestamptz not null default now()
);

insert into watch_settings (singleton) values (true) on conflict (singleton) do nothing;

-- updated_at, kept honest by the database rather than by every caller.
create or replace function watch_touch() returns trigger
language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end $$;

do $$
declare t text;
begin
  foreach t in array array['watch_shows', 'watch_seasons', 'watch_ratings', 'watch_settings'] loop
    execute format('drop trigger if exists %I_touch on %I', t, t);
    execute format(
      'create trigger %I_touch before update on %I
         for each row execute function watch_touch()', t, t);
  end loop;
end $$;

-- ---------------------------------------------------------------------------
-- Row level security: app-scoped on 'watched'. Not granted to everyone by
-- default (see the registry): what two people are watching is theirs.
-- ---------------------------------------------------------------------------
do $$
declare t text;
begin
  foreach t in array array['watch_shows', 'watch_seasons', 'watch_ratings', 'watch_settings'] loop
    execute format('alter table %I enable row level security', t);
    execute format('drop policy if exists %I_rw on %I', t, t);
    execute format(
      'create policy %I_rw on %I for all to authenticated
         using (has_app(''watched'')) with check (has_app(''watched''))', t, t);
  end loop;
end $$;

-- ---------------------------------------------------------------------------
-- Realtime, so a show Jackie shelves appears on Avi's phone without a reload.
-- REPLICA IDENTITY FULL is what lets deletes sync under RLS.
-- ---------------------------------------------------------------------------
do $$
declare t text;
begin
  foreach t in array array['watch_shows', 'watch_seasons', 'watch_ratings', 'watch_settings'] loop
    execute format('alter table %I replica identity full', t);
    begin
      execute format('alter publication supabase_realtime add table %I', t);
    exception when duplicate_object then null;
    end;
  end loop;
end $$;

-- ---------------------------------------------------------------------------
-- Notifications: a show going on a shelf or into the lineup, a season
-- finished, a show finished — the last two so whoever wasn't holding the
-- phone gets asked for their rating.
--
-- Column-scoped on purpose. `update of stage` fires only when an update
-- actually sets the stage, so ticking off an episode, dragging the lineup or
-- refreshing a show's episode list from TVmaze never reaches the function.
-- ---------------------------------------------------------------------------
do $$
begin
  if exists (select 1 from pg_proc where proname = 'notify_change') then
    drop trigger if exists watch_shows_notify on watch_shows;
    create trigger watch_shows_notify
      after insert or update of stage on watch_shows
      for each row execute function notify_change();

    -- Insert too: a season finished from a phone that never saw it start is
    -- written in one go. The classifier ignores starts and backfills.
    drop trigger if exists watch_seasons_notify on watch_seasons;
    create trigger watch_seasons_notify
      after insert or update of finished_at on watch_seasons
      for each row execute function notify_change();
  else
    raise notice
      'notify_change() not found — run 005_notifications.sql to get notifications.';
  end if;
end $$;
