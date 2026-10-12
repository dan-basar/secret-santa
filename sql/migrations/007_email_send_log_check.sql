-- Read-only check for 007_email_send_log.sql. Run right after the migration.
-- Expected: one row with tableExists = 1, and emailsInLast24Hours equal to today's
-- DailyEmailLog count (0 if nothing was sent today).

SELECT
     (
          SELECT COUNT(*)
          FROM information_schema.tables as tables
          WHERE tables.table_name = 'emailsendlog' --unquoted EmailSendLog folds to lowercase
     ) as tableExists
    ,(
          SELECT COALESCE(SUM(emailSendLog.emails_sent), 0)
          FROM EmailSendLog as emailSendLog
          WHERE emailSendLog.hour_start > now() - interval '25 hours'
     ) as emailsInLast24Hours
