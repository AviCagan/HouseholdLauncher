-- Household Launcher — a limit on guessing household codes
--
-- The `household` Edge Function's `redeem` action is the one thing anyone
-- can call without a session, and it used to check a code as many times as
-- it was asked. It now counts wrong codes here and makes the guesser wait:
-- five in a quarter of an hour from one device, or fifty from anywhere (see
-- supabase/functions/_shared/signin.ts for the numbers and the reasoning).
--
-- Only the function reads or writes this table, with the service role.
-- Row-level security is on with no policies, on purpose, like
-- member_credentials: no member, signed in or not, can see who has been
-- guessing or clear their own count.
--
-- `client_key` is a peppered hash of the guesser's address, so the table
-- never holds an address. Rows older than a day are trimmed by the function.

create table if not exists sign_in_failures (
  id          bigint generated always as identity primary key,
  client_key  text not null,
  at          timestamptz not null default now()
);

create index if not exists sign_in_failures_client_at on sign_in_failures (client_key, at desc);
create index if not exists sign_in_failures_at on sign_in_failures (at desc);

alter table sign_in_failures enable row level security;
-- Intentionally empty. See the comment above before adding a policy here.

revoke all on sign_in_failures from anon, authenticated;

comment on table sign_in_failures is
  'Wrong household codes, counted by the household Edge Function to limit guessing. Service role only; RLS on with no policies on purpose.';
