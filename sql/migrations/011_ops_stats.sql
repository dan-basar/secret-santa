-- Usage stats (O4): when each person first opened their personal link, and one
-- row of counts per day written by the daily check job (src/pages/api/ops-check.ts).
-- * Participants.revealed_at: set by reveal.ts the first time the link shows a
--   match; NULL = not opened (yet). Existing participants stay NULL
-- * DailyStats: one row per UTC day, written once the day is over. Counts only,
--   no names or emails. Re-running the job for a day overwrites that day's row
-- Run once against each database (Neon dev branch first, then production).

BEGIN;

ALTER TABLE Participants
     ADD COLUMN revealed_at timestamptz NULL;

CREATE TABLE DailyStats (
     stat_date date PRIMARY KEY
    ,draws_created integer NOT NULL
    ,draws_emailed integer NOT NULL
    ,participants_created integer NOT NULL
    ,emails_sent integer NOT NULL
    ,links_opened integer NOT NULL
    ,unsent_emails integer NOT NULL
    ,recorded_at timestamptz NOT NULL DEFAULT now()
);

COMMIT;
