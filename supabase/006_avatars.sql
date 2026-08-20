-- Things — profile photos
--
-- Run this once in the SQL Editor if your database was created before this
-- feature existed. Safe to run more than once.
--
-- The photo is stored as a data URI rather than in a storage bucket: two users
-- do not justify configuring buckets and policies, and the app downscales the
-- image to a small square before saving, so the row stays modest.

alter table profiles add column if not exists avatar_url text;
