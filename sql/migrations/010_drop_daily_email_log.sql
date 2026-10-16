-- Drops DailyEmailLog, the old per-UTC-day email count. Migration 007 replaced it
-- with EmailSendLog and left it in place only while the code before that PR was
-- still deployed; nothing has read or written it since, and setup.sql doesn't
-- create it, so databases made before 007 still differ from a fresh one.
-- Its rows are daily totals, not people's data, so dropping it loses nothing.
-- Run once against each database (Neon dev branch first, then production).
-- IF EXISTS makes a second run, or a database that never had it, a no-op.

DROP TABLE IF EXISTS DailyEmailLog;
