-- Things — Google Calendar sync for recurring chores
--
-- Run once in the SQL Editor. Safe to run more than once.
--
-- The app publishes recurring chores as an iCalendar feed that Google Calendar
-- subscribes to by URL. There is no OAuth and no Google account linking: the
-- feed is a plain HTTPS URL, and the only thing protecting it is the random
-- token below. That is why the token is a column rather than a fixed secret —
-- if the URL ever leaks, regenerating it here revokes the old one instantly.
--
-- null token = sync switched off. The Edge Function refuses every request in
-- that state, so turning it off in Settings genuinely turns the feed off.

alter table household_settings
  add column if not exists calendar_token text;

-- How long before a chore is due Google should remind you, in minutes.
-- 0 means no reminder — the event still appears, it just doesn't alert.
alter table household_settings
  add column if not exists calendar_alarm_minutes integer not null default 0;

-- The token is looked up on every calendar poll, and Google polls a feed for
-- as long as the subscription exists.
create index if not exists household_settings_calendar_token_idx
  on household_settings (calendar_token)
  where calendar_token is not null;
