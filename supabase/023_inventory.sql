-- Household Launcher — Inventory
--
-- Safe to run more than once. Run it after 015_launcher.sql.
--
-- ---------------------------------------------------------------------------
-- The things the household has bought and wants to keep track of: what it
-- is, where it came from, what it cost, how long it's covered, where it
-- lives — and its paperwork, its spare parts and a photo of the whole lot.
--
-- The files themselves are NOT stored here. Each item is a folder in Google
-- Drive (Joint Stuff › Warranties, manuals, extra parts › <item>), and that
-- folder is the record: photos, the manual, the warranty, a notes doc. This
-- table holds the details the app sorts and searches by, which file is which
-- (overall photo, extra part, paperwork), and one small thumbnail so the list
-- draws without asking Drive for anything. Lose this table and the folders
-- are still all there; lose the app and so is everything that mattered.
-- ---------------------------------------------------------------------------
create table if not exists inventory_items (
  id              uuid primary key,
  name            text not null check (length(trim(name)) > 0),
  brand           text,
  model           text,
  category        text,
  -- Where it came from, free text: "Home Depot", "Amazon".
  store           text,
  -- Integer cents, as everywhere else in the app.
  price_cents     integer check (price_cents is null or price_cents >= 0),
  -- Free text rather than a member: "bubby" paid for the cooler, and bubby
  -- is not going to get a household code.
  paid_by         text,
  purchased_on    date,
  warranty_until  date,
  -- Where it's kept: "garage, top shelf".
  location        text,
  notes           text,

  -- Google Drive. All null until the household connects Drive; the item
  -- works without them, it just has nowhere to put photos yet.
  drive_folder_id text,
  drive_folder_url text,
  -- The Google Doc the details and notes are written to, so the folder
  -- explains itself without the app.
  notes_doc_id    text,
  -- The overall photo: one of `files`, by Drive id.
  cover_file_id   text,
  -- A small data: URI of the overall photo (~10–20 KB). The only image data
  -- kept here, so the list never waits on Drive.
  cover_thumb     text,
  -- [{ id, kind: 'photo'|'part'|'doc', name, mime, url, size, added_at }]
  -- Which file is which. The folder is the truth about which files exist;
  -- this is the app's note of what each one is for.
  files           jsonb not null default '[]'::jsonb,

  created_by      uuid references profiles(id) on delete set null,
  updated_by      uuid references profiles(id) on delete set null,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

create index if not exists inventory_items_name_idx on inventory_items (lower(name));

create or replace function inventory_touch() returns trigger
language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end $$;

drop trigger if exists inventory_items_touch on inventory_items;
create trigger inventory_items_touch before update on inventory_items
  for each row execute function inventory_touch();

-- ---------------------------------------------------------------------------
-- Row level security: app-scoped on 'inventory', like every other app. Not
-- granted to everyone by default (see the registry) — what the household
-- owns and what it paid is nobody else's business until an owner says so.
-- ---------------------------------------------------------------------------
alter table inventory_items enable row level security;
drop policy if exists inventory_items_rw on inventory_items;
create policy inventory_items_rw on inventory_items for all
  to authenticated
  using (has_app('inventory')) with check (has_app('inventory'));

alter table inventory_items replica identity full;
do $$
begin
  alter publication supabase_realtime add table inventory_items;
exception when duplicate_object then
  null;
end $$;

-- ---------------------------------------------------------------------------
-- How to reach the household's Drive. Server-only.
--
-- The `inventory` Edge Function talks to a small Google Apps Script that runs
-- as whoever set it up, inside their own Drive. Its address and the secret it
-- checks are kept here, where only that function can read them: row level
-- security is on and there are deliberately NO policies, and the table is
-- revoked from every client role, so the publishable key and a member's
-- session alike read nothing. The service role bypasses both.
-- ---------------------------------------------------------------------------
create table if not exists inventory_drive (
  singleton    boolean primary key default true check (singleton),
  secret       text not null,
  script_url   text,
  account      text,
  root_id      text,
  root_url     text,
  connected_at timestamptz,
  updated_at   timestamptz not null default now()
);

alter table inventory_drive enable row level security;
revoke all on inventory_drive from anon, authenticated;
