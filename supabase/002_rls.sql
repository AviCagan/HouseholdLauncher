-- Things — row level security
--
-- The posture, stated plainly:
--
-- The anon key is NOT a secret. It ships inside the JS bundle, which GitHub
-- Pages serves publicly, so anyone who opens DevTools has it. The only real
-- question is what that key is ALLOWED to do.
--
-- Answer: nothing. Every policy below grants `authenticated` only, and `anon`
-- gets no policy at all. The two phones sign in once each to a single shared
-- household account (unlocked by the PIN), and supabase-js persists and
-- refreshes that session indefinitely — so day to day it is still just
-- "tap your name", and the database is not world-writable.
--
-- IMPORTANT companion step, in the Supabase dashboard:
--   Authentication → Providers → Email → turn OFF "Enable email signups".
-- Otherwise the public anon key can create brand new accounts, and those
-- accounts would then satisfy `to authenticated` and walk straight past the
-- PIN. That toggle is what makes this posture actually hold.

do $$
declare t text;
begin
  foreach t in array array[
    'profiles','profile_settings','household_settings',
    'todos','chores','stores','shopping_items','wishlist_items',
    'geocode_cache','shopping_trips','push_subscriptions','activity_log'
  ] loop
    execute format('alter table %I enable row level security', t);
    execute format('drop policy if exists household_rw on %I', t);
    execute format(
      'create policy household_rw on %I for all
         to authenticated using (true) with check (true)', t);
  end loop;
end $$;
