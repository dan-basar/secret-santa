-- Read-only check for 006_match_constraints.sql. Run right after the migration.
-- Expected: one row with adminKeyNullable = 'NO', drawsWithoutKey = 0 and
-- matchConstraints = 2.

SELECT
     (
          SELECT columns.is_nullable
          FROM information_schema.columns as columns
          WHERE columns.table_name = 'draws' --unquoted Draws folds to lowercase
               AND columns.column_name = 'admin_key'
     ) as adminKeyNullable
    ,(
          SELECT COUNT(*)
          FROM Draws as draws
          WHERE draws.admin_key IS NULL
     ) as drawsWithoutKey
    ,(
          SELECT COUNT(*)
          FROM information_schema.table_constraints as tableConstraints
          WHERE tableConstraints.table_name = 'matches'
               AND tableConstraints.constraint_name IN ('uq_matches_giver', 'uq_matches_receiver')
     ) as matchConstraints
