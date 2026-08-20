-- Things — fix push subscriptions never actually saving
--
-- Run once in the SQL Editor if your database predates this fix. Safe to run
-- more than once.
--
-- The two indexes below were PARTIAL (`where platform = 'fcm'` / `'webpush'`).
-- Postgres will not plan `insert ... on conflict (token) do update ...`
-- against a partial index unless the ON CONFLICT clause repeats that exact
-- predicate — and the Supabase JS client's `.upsert({ onConflict: 'token' })`
-- has no option to do that. The result: every single push registration
-- failed at the database level, on every device, from the very first one.
-- Nothing surfaced it because the client code never checked the returned
-- error either (fixed separately, in src/lib/notifications.ts) — so
-- Settings showed "Notifications are on" while push_subscriptions stayed
-- empty the whole time.
--
-- A plain (non-partial) index works identically here: NULL is never equal to
-- NULL under a unique index, so the many webpush rows — every one of them
-- with token = null — never collide with each other, and the same holds for
-- fcm rows on endpoint. Nothing about the actual uniqueness guarantee
-- changes; only ON CONFLICT's ability to target the index does.

drop index if exists push_fcm_token_idx;
drop index if exists push_webpush_endpoint_idx;

create unique index if not exists push_fcm_token_idx
  on push_subscriptions (token);
create unique index if not exists push_webpush_endpoint_idx
  on push_subscriptions (endpoint);
