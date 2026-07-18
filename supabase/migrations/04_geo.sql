-- Run this in the Supabase SQL editor
--
-- Dynamic location/timezone: the app auto-detects each user's city, timezone
-- and approximate coordinates on load and keeps these columns up to date, so
-- globe pins and local-time labels reflect where users actually are.
-- The app degrades gracefully if this migration has not been run yet.

ALTER TABLE profiles ADD COLUMN IF NOT EXISTS timezone  text;
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS latitude  double precision;
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS longitude double precision;
