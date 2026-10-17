-- Read-only check for 011_ops_stats.sql. Run right after the migration.
-- Expected: one row with revealedAtColumns = 1 and dailyStatsTables = 1.

SELECT
     (
          SELECT COUNT(*)
          FROM information_schema.columns as columns
          WHERE columns.table_name = 'participants' --unquoted names fold to lowercase
               AND columns.column_name = 'revealed_at'
     ) as revealedAtColumns
    ,(
          SELECT COUNT(*)
          FROM information_schema.tables as tables
          WHERE tables.table_schema = 'public'
               AND tables.table_name = 'dailystats'
     ) as dailyStatsTables
