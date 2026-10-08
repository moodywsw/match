-- Applied to pkpdheytmbwvqhpcaigm as "pg_net_schema_and_locations_policy".
-- pg_net does not support ALTER EXTENSION ... SET SCHEMA; recreate it in `extensions`.
-- Its functions live in schema `net` either way, so the cleanup-story-media cron job keeps working.
drop extension if exists pg_net;
create extension if not exists pg_net with schema extensions;

-- private.user_locations is only touched by SECURITY DEFINER functions; make the
-- "no direct access" intent explicit (no grants exist either).
drop policy if exists "no direct access" on private.user_locations;
create policy "no direct access" on private.user_locations as restrictive for all to public using (false) with check (false);
