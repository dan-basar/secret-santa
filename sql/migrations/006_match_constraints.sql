-- Schema tidy-ups (review item T17):
-- 1. Draws.admin_key becomes NOT NULL. It was nullable only for draws made before
--    admin keys existed, and those were all deleted. A deleted draw that still has no
--    key gets a random one nobody knows, which changes nothing for it (it stays
--    deleted). If any draw that is NOT deleted still has no key, the ALTER fails and
--    the whole migration rolls back; look at that draw before going further.
-- 2. Matches gets UNIQUE on giver_participant_id and on receiver_participant_id, so
--    the database itself guarantees one gift given and one received per person. The
--    giver constraint's index also serves the reveal lookup (review item E4), which
--    joined Matches on giver_participant_id without one.
-- Preview before running (read-only); expect activeWithoutKey = 0 and both duplicate counts 0:
--   SELECT
--        (SELECT COUNT(*) FROM Draws WHERE admin_key IS NULL AND deleted_at IS NULL) as activeWithoutKey
--       ,(SELECT COUNT(*) FROM Draws WHERE admin_key IS NULL AND deleted_at IS NOT NULL) as deletedWithoutKey
--       ,(SELECT COUNT(*) - COUNT(DISTINCT giver_participant_id) FROM Matches) as duplicateGivers
--       ,(SELECT COUNT(*) - COUNT(DISTINCT receiver_participant_id) FROM Matches) as duplicateReceivers
-- Run once against each database (Neon dev branch first, then production).

BEGIN;

UPDATE Draws
SET admin_key = gen_random_uuid()::text
WHERE admin_key IS NULL
     AND deleted_at IS NOT NULL;

ALTER TABLE Draws ALTER COLUMN admin_key SET NOT NULL;

ALTER TABLE Matches ADD CONSTRAINT UQ_Matches_Giver UNIQUE (giver_participant_id);
ALTER TABLE Matches ADD CONSTRAINT UQ_Matches_Receiver UNIQUE (receiver_participant_id);

COMMIT;
