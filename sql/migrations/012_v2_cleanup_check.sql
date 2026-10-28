-- Read-only check for 012_v2_cleanup.sql. Run right after the migration.
-- Expected: one row with oldDraws = 0, orphanParticipants = 0, revealTokenColumns = 0,
-- revealCodeNullable = 'NO' and replacedByColumns = 1.

SELECT
     (SELECT COUNT(*) FROM Draws WHERE created_at < '2026-10-17 00:00:00 America/New_York') as oldDraws
    ,(
          SELECT COUNT(*)
          FROM Participants as participants
               LEFT JOIN Draws as draws ON participants.draw_id = draws.id
          WHERE draws.id IS NULL
     ) as orphanParticipants
    ,(
          SELECT COUNT(*)
          FROM information_schema.columns as columns
          WHERE columns.table_name = 'participants' --unquoted names fold to lowercase
               AND columns.column_name = 'reveal_token'
     ) as revealTokenColumns
    ,(
          SELECT columns.is_nullable
          FROM information_schema.columns as columns
          WHERE columns.table_name = 'participants'
               AND columns.column_name = 'reveal_code'
     ) as revealCodeNullable
    ,(
          SELECT COUNT(*)
          FROM information_schema.columns as columns
          WHERE columns.table_name = 'draws'
               AND columns.column_name = 'replaced_by'
     ) as replacedByColumns
