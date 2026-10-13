-- Household Launcher — Watched: when each episode was watched
--
-- Safe to run more than once. Run it after 021_watched.sql.
--
-- One row per episode watched, stamped with when. This is what the pace
-- learns from: "four episodes in two days" is four rows two days apart, so
-- every tap of + (or a batch logged with dates) moves the estimate, instead
-- of waiting for a whole season to be finished.
--
-- The id is derived on the phone from (show, season, episode), so both
-- phones logging the same episode write the same row, and un-ticking an
-- episode removes exactly that row.
-- ---------------------------------------------------------------------------

create table if not exists watch_views (
  id          uuid primary key,
  show_id     uuid not null references watch_shows(id) on delete cascade,
  season      integer not null check (season >= 1),
  episode     integer not null check (episode >= 1),
  watched_at  timestamptz not null,
  -- The episode's length when it was logged, so the pace doesn't change if
  -- TVmaze later corrects a runtime. Null when nobody knows.
  minutes     integer check (minutes is null or minutes > 0),
  created_by  uuid references profiles(id) on delete set null,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  constraint watch_view_once unique (show_id, season, episode)
);

create index if not exists watch_views_watched_at_idx on watch_views (watched_at);

drop trigger if exists watch_views_touch on watch_views;
create trigger watch_views_touch before update on watch_views
  for each row execute function watch_touch();

alter table watch_views enable row level security;
drop policy if exists watch_views_rw on watch_views;
create policy watch_views_rw on watch_views for all to authenticated
  using (has_app('watched')) with check (has_app('watched'));

-- Realtime, so the other phone's estimates move when an episode is ticked.
alter table watch_views replica identity full;
do $$
begin
  alter publication supabase_realtime add table watch_views;
exception when duplicate_object then null;
end $$;

-- No notification trigger: an episode ticked is not news.
