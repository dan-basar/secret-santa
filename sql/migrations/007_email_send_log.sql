-- Adds EmailSendLog: emails sent per hour, across all draws. send-emails.ts now caps
-- sends over a rolling 24 hours (Gmail's rule) by summing these rows, instead of per
-- UTC calendar day in DailyEmailLog, and reserves a send's count before sending.
-- Today's DailyEmailLog count is copied into the current hour so sends made earlier
-- today still count (erring on the safe side: they may be up to a day old).
-- DailyEmailLog is left in place, because the code deployed until this PR merges
-- still writes to it; nothing reads it after that.
-- Run once against each database (Neon dev branch first, then production).

BEGIN;

CREATE TABLE EmailSendLog (
     hour_start timestamptz PRIMARY KEY
    ,emails_sent integer NOT NULL DEFAULT 0
);

INSERT INTO EmailSendLog (hour_start, emails_sent)
SELECT
     date_trunc('hour', now())
    ,dailyEmailLog.emails_sent
FROM DailyEmailLog as dailyEmailLog
WHERE dailyEmailLog.log_date = (now() at time zone 'utc')::date
     AND dailyEmailLog.emails_sent > 0;

COMMIT;
