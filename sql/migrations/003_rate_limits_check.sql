-- Read-only check for 003_rate_limits.sql. Run after the migration.
-- Expected: three rows, bucket (character varying), window_start
-- (timestamp with time zone) and hits (integer).

SELECT
     columns.column_name as columnName
    ,columns.data_type as dataType
    ,columns.is_nullable as isNullable
FROM information_schema.columns as columns
WHERE columns.table_name = 'ratelimits' --unquoted RateLimits folds to lowercase
ORDER BY columns.ordinal_position
