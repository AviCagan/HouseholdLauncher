-- Things — realtime

/*
  ALTER PUBLICATION ... ADD TABLE has no IF NOT EXISTS form, and re-adding a
  table raises 42710 ("already member of publication"). That aborts the whole
  script, which is why this is a loop with a guard rather than eight bare
  statements — running the setup twice has to be harmless.
*/
do $$
declare t text;
begin
  foreach t in array array[
    'todos','chores','shopping_items','stores','wishlist_items',
    -- profiles belongs here because the client subscribes to it (see TABLES in
    -- src/data/adapter.ts). Without it, changing a name, colour or photo never
    -- reached the other phone until it was backgrounded and reopened.
    'profiles','profile_settings','household_settings','shopping_trips','activity_log'
  ] loop
    if not exists (
      select 1 from pg_publication_tables
      where pubname = 'supabase_realtime'
        and schemaname = 'public'
        and tablename = t
    ) then
      execute format('alter publication supabase_realtime add table %I', t);
    end if;
  end loop;
end $$;

/*
  REPLICA IDENTITY FULL is required, not optional, and specifically because RLS
  is enabled.

  On DELETE, Realtime has to evaluate the row-level policy against the row that
  just disappeared. With the default (primary-key-only) replica identity it has
  too little of the row to do that, so it silently drops the event: inserts and
  updates sync fine, deletes never arrive on the other phone. That is the
  classic "deletes don't sync" bug, and this is the fix.
*/
alter table todos           replica identity full;
alter table chores          replica identity full;
alter table shopping_items  replica identity full;
alter table stores          replica identity full;
alter table wishlist_items  replica identity full;
alter table profile_settings replica identity full;
alter table household_settings replica identity full;
alter table activity_log      replica identity full;
alter table profiles          replica identity full;
