-- Read-only check for 005_email_claims.sql. Run right after the migration.
-- Expected: one row with columnExists = 1 and claimedNow = 0 (no claims exist until
-- the new send-emails code runs, and each one is cleared within seconds after that).

SELECT
     (
          SELECT COUNT(*)
          FROM information_schema.columns as columns
          WHERE columns.table_name = 'participants' --unquoted Participants folds to lowercase
               AND columns.column_name = 'email_claimed_at'
     ) as columnExists
    ,(
          SELECT COUNT(*)
          FROM Participants as participants
          WHERE participants.email_claimed_at IS NOT NULL
     ) as claimedNow
