-- Read-only check for 008_short_links.sql. Run right after the migration.
-- Expected: one row with revealCodeColumn = 1, revealCodeUnique = 1 and
-- adminKeyUnique = 1.

SELECT
     (
          SELECT COUNT(*)
          FROM information_schema.columns as columns
          WHERE columns.table_name = 'participants' --unquoted names fold to lowercase
               AND columns.column_name = 'reveal_code'
     ) as revealCodeColumn
    ,(
          SELECT COUNT(*)
          FROM information_schema.table_constraints as constraints
          WHERE constraints.table_name = 'participants'
               AND constraints.constraint_name = 'uq_participants_revealcode'
               AND constraints.constraint_type = 'UNIQUE'
     ) as revealCodeUnique
    ,(
          SELECT COUNT(*)
          FROM information_schema.table_constraints as constraints
          WHERE constraints.table_name = 'draws'
               AND constraints.constraint_name = 'uq_draws_adminkey'
               AND constraints.constraint_type = 'UNIQUE'
     ) as adminKeyUnique
