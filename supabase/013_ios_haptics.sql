-- Things — iOS haptics on by default
--
-- Run once in the SQL Editor if your database predates this. Safe to run more
-- than once.

-- ---------------------------------------------------------------------------
-- `ios_native_switch` now means "use Apple's switch control to produce a real
-- haptic", which is the only way an iPhone gets any haptic feedback at all —
-- iOS has never shipped the Vibration API. It previously described a narrower
-- idea (render the completion checkbox as a native switch) that was never
-- actually implemented: nothing outside the Settings toggle ever read the
-- column, so no stored value carries a real preference.
--
-- That is what makes the backfill safe rather than presumptuous. Changing the
-- column default alone would only affect brand new rows, so the two profiles
-- that already exist would keep the dead `false` and the feature would never
-- reach the phone it was built for.
-- ---------------------------------------------------------------------------
alter table profile_settings alter column ios_native_switch set default true;
update profile_settings set ios_native_switch = true where ios_native_switch = false;
