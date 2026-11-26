-- Household Launcher — pairing Nano like a TV
--
-- Settings › People › Nano › Pair Nano shows a 6-digit code that works once
-- and runs out after ten minutes. Avi texts it to Nano ("pair launcher
-- 123456"); her app catches the message before her chat sees it and sends
-- it to the household function's `pair` action, which hands the brain her
-- long code and a session. A spent code is harmless left in a chat.
--
-- One pending pairing at a time: asking again replaces it. Only the household
-- function reads or writes this table, with the service role: row-level
-- security on with no policies, on purpose. It holds a peppered hash, never
-- the code.

create table if not exists nano_pairing (
  singleton   boolean primary key default true check (singleton),
  code_hash   text not null,
  expires_at  timestamptz not null,
  created_by  uuid references profiles(id) on delete set null,
  created_at  timestamptz not null default now()
);

alter table nano_pairing enable row level security;
-- Intentionally empty. See the comment above before adding a policy here.

revoke all on nano_pairing from anon, authenticated;

comment on table nano_pairing is
  'The one pending Pair Nano code (hash, ten-minute expiry, single use). Household function only; RLS on with no policies on purpose.';
