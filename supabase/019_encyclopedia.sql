-- Household Launcher — A&J Encyclopedia
--
-- Safe to run more than once. Run it after 015_launcher.sql.
--
-- ---------------------------------------------------------------------------
-- One table: the words. An entry is a term with the definition the two of
-- them gave it, laid out the way a dictionary would — part of speech,
-- pronunciation, an example of it in use, and where it came from, which in a
-- private vocabulary is usually a story rather than a language.
--
-- There is no seed. The volume starts empty, and every entry in it is theirs.
-- ---------------------------------------------------------------------------
create table if not exists lexicon_entries (
  id              uuid primary key,
  term            text not null check (length(trim(term)) > 0),
  -- Free text, however they would say it out loud: "SHLUM-pee", "/ʃlʌmpi/".
  pronunciation   text,
  part_of_speech  text not null default 'noun' check (part_of_speech in (
                    'noun', 'verb', 'adjective', 'adverb', 'interjection',
                    'phrase', 'name', 'other')),
  definition      text not null check (length(trim(definition)) > 0),
  -- The word in a sentence, the way a dictionary shows usage.
  example         text,
  -- Etymology. "Coined by Jackie, March 2024, after the incident with the soup."
  origin          text,
  tags            text[] not null default '{}',
  created_by      uuid references profiles(id) on delete set null,
  updated_by      uuid references profiles(id) on delete set null,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

-- The index is alphabetical and case-blind, which is how the app lists them.
create index if not exists lexicon_entries_term_idx on lexicon_entries (lower(term));

-- updated_at, kept honest by the database rather than by every caller.
create or replace function lexicon_touch() returns trigger
language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end $$;

drop trigger if exists lexicon_entries_touch on lexicon_entries;
create trigger lexicon_entries_touch before update on lexicon_entries
  for each row execute function lexicon_touch();

-- ---------------------------------------------------------------------------
-- Row level security: app-scoped on 'encyclopedia', same as Meals is on
-- 'meals'. A private vocabulary is private — it is NOT granted to everyone
-- by default (see the registry), so a guest sees nothing until an owner says.
-- ---------------------------------------------------------------------------
alter table lexicon_entries enable row level security;
drop policy if exists lexicon_entries_rw on lexicon_entries;
create policy lexicon_entries_rw on lexicon_entries for all
  to authenticated
  using (has_app('encyclopedia')) with check (has_app('encyclopedia'));

-- ---------------------------------------------------------------------------
-- Realtime, so a word Jackie adds appears in Avi's volume without a reload.
-- ---------------------------------------------------------------------------
alter table lexicon_entries replica identity full;
do $$
begin
  alter publication supabase_realtime add table lexicon_entries;
exception when duplicate_object then
  null;
end $$;

-- ---------------------------------------------------------------------------
-- Notifications. INSERT only: a new word is news; a corrected definition is
-- not, and neither is a fixed typo in the example.
-- ---------------------------------------------------------------------------
do $$
begin
  if exists (select 1 from pg_proc where proname = 'notify_change') then
    drop trigger if exists lexicon_entries_notify on lexicon_entries;
    create trigger lexicon_entries_notify
      after insert on lexicon_entries
      for each row execute function notify_change();
  else
    raise notice
      'notify_change() not found — run 005_notifications.sql to get notifications.';
  end if;
end $$;
