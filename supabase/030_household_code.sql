-- Household Launcher — one household code, then tap who you are
--
-- Avi's call, Nov 26: signing in is the household code, then "Avi" or
-- "Jackie". Tapping a name signs the phone in as that person (a real session
-- of their own), so everything kept to one person (the Calendar, Nano's
-- "who asked") still knows who is who. Friends keep codes of their own and
-- never see the picker.
--
-- The household code starts as the old shared PIN. The household function
-- checks it once against the old shared account, then keeps only a peppered
-- hash here and checks that instead, with the same guess limit as every
-- other code. When the owners turn off the old sign-in, the shared account's
-- password is scrambled, so the code can't be tried anywhere else.
--
-- Only the household function reads or writes this table, with the service
-- role: row-level security on with no policies, on purpose.

create table if not exists household_code (
  singleton   boolean primary key default true check (singleton),
  code_hash   text not null,
  set_at      timestamptz not null default now(),
  set_by      uuid references profiles(id) on delete set null
);

alter table household_code enable row level security;
-- Intentionally empty. See the comment above before adding a policy here.

revoke all on household_code from anon, authenticated;

comment on table household_code is
  'Hash of the shared household code (then tap your name). Household function only; RLS on with no policies on purpose.';
