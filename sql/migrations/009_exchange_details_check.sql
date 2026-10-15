-- Read-only check for 009_exchange_details.sql. Run right after the migration.
-- Expected: one row with detailColumns = 3 and budgetCheck = 1.

SELECT
     (
          SELECT COUNT(*)
          FROM information_schema.columns as columns
          WHERE columns.table_name = 'draws' --unquoted names fold to lowercase
               AND columns.column_name IN ('organizer_note', 'budget_cents', 'exchange_date')
     ) as detailColumns
    ,(
          SELECT COUNT(*)
          FROM information_schema.table_constraints as constraints
          WHERE constraints.table_name = 'draws'
               AND constraints.constraint_name = 'ck_draws_budgetcents'
               AND constraints.constraint_type = 'CHECK'
     ) as budgetCheck
