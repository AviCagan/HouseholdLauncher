-- Things — voice adding (Siri / Google Assistant)
--
-- Run once in the SQL Editor if your database predates this feature. Safe to
-- run more than once.

-- ---------------------------------------------------------------------------
-- Secret in the voice-add URL. null means voice adding is off — the Edge
-- Function refuses every request in that state, so this is a real off switch
-- and not just a hidden button. Kept separate from calendar_token so
-- regenerating one doesn't revoke the other.
-- ---------------------------------------------------------------------------
alter table household_settings add column if not exists voice_token text;
