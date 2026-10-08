-- APPLIED 2026-09-18 against the production `weather` DB (both sensor_data
-- and cansat_data) — see the backup at
-- /root/db-backups/weather_backup_pre_tz_20260918_145355.sql on the host.
-- Verified afterward: `\d sensor_data`/`\d cansat_data` show
-- `timestamp with time zone` with `DEFAULT now()`, a spot-checked row's
-- wall-clock value was unchanged (just gained an explicit +00), and the
-- API's latest/history/aggregate endpoints all read correctly post-migration
-- while the room device kept writing every 5s straight through the lock.
-- Do not run this again — it's kept here as a record, not a runbook step.
--
-- Manual, one-time migration: convert naive `timestamp` columns to `timestamptz`.
--
-- Context: the old FastAPI backend wrote timestamps with Python's
-- `datetime.utcnow()` — a naive instant with no tz attached, stored by
-- Postgres as `timestamp without time zone`. The new Drizzle schema
-- (apps/api/src/db/schema.ts) declares `timestamptz` for both tables, so
-- existing rows must be REINTERPRETED as UTC, not converted from server
-- local time — `AT TIME ZONE 'UTC'` below does exactly that (attaches the
-- UTC offset without shifting the wall-clock value).
--
-- Not run against any live database by Claude — this is a script for you
-- to run by hand against the `weather-db` container before cutover.
--
-- Steps:
--   1. Back up first:
--        docker exec weather-db pg_dump -U <user> <db> > weather_backup_$(date +%F).sql
--   2. Stop the old FastAPI container (or otherwise pause writes) —
--      ALTER COLUMN ... TYPE rewrites the table under an ACCESS EXCLUSIVE
--      lock, so nothing should be writing to sensor_data/cansat_data while
--      this runs. On a table with months of ~10s-interval readings this can
--      take anywhere from a couple seconds to a few minutes; size it up
--      first with `SELECT count(*) FROM sensor_data;`.
--   3. Run this script:
--        docker exec -i weather-db psql -U <user> -d <db> < 0001_convert_timestamp_to_timestamptz.sql
--   4. Only after this succeeds, point the new API's DATABASE_URL at this
--      same database and start it.
--
-- After this runs, `pnpm --filter @weather/api db:migrate` is safe to run
-- against the same DB: 0000_little_yellow_claw.sql only does
-- `CREATE TABLE IF NOT EXISTS` (no-op — tables already exist) and
-- `CREATE INDEX IF NOT EXISTS` for the two indexes the new schema adds.
-- It never touches the timestamp columns, so there's no ordering conflict
-- with this script and no manual "baselining" of Drizzle's migration
-- history required.

BEGIN;

ALTER TABLE sensor_data
  ALTER COLUMN "timestamp" TYPE timestamptz
  USING "timestamp" AT TIME ZONE 'UTC';

ALTER TABLE cansat_data
  ALTER COLUMN "timestamp" TYPE timestamptz
  USING "timestamp" AT TIME ZONE 'UTC';

COMMIT;
