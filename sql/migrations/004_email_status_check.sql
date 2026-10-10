-- Read-only check for 004_email_status.sql. Run right after the migration.
-- Expected: one row with columnExists = 1 and missedBackfill = 0 (later, a failed
-- send can legitimately leave someone unsent). sentEmails
-- should equal the number of participants with an email in already-sent draws.

SELECT
     (
          SELECT COUNT(*)
          FROM information_schema.columns as columns
          WHERE columns.table_name = 'participants' --unquoted Participants folds to lowercase
               AND columns.column_name = 'email_sent_at'
     ) as columnExists
    ,COUNT(participants.email_sent_at) as sentEmails
    ,COUNT(*) FILTER (WHERE participants.email_sent_at IS NULL) as missedBackfill
FROM Participants as participants
     INNER JOIN Draws as draws ON participants.draw_id = draws.id
WHERE draws.emails_sent_at IS NOT NULL
     AND participants.email IS NOT NULL
