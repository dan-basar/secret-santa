-- Read-only check for 010_drop_daily_email_log.sql. Run right after the migration.
-- Expected: one row with dailyEmailLogTables = 0 and emailSendLogTables = 1.

SELECT
     (
          SELECT COUNT(*)
          FROM information_schema.tables as tables
          WHERE tables.table_schema = 'public'
               AND tables.table_name = 'dailyemaillog' --unquoted names fold to lowercase
     ) as dailyEmailLogTables
    ,(
          SELECT COUNT(*)
          FROM information_schema.tables as tables
          WHERE tables.table_schema = 'public'
               AND tables.table_name = 'emailsendlog'
     ) as emailSendLogTables
