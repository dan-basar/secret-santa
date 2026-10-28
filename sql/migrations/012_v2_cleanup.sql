-- V2 cleanup (review items T5 and T6), run as one transaction:
-- * Purge: every draw created before 17 October 2026 (midnight US Eastern) is
--   removed for good, with its participants and matches. A one-time exception to
--   the soft-delete rule, at the owner's request; DailyStats keeps its counts.
--   It also removes the last draws from before 008_short_links.sql, which makes
--   the next two changes possible
-- * Participants.reveal_token, the retired uuid, is dropped with its unique
--   constraint, and reveal_code becomes NOT NULL
-- * Draws.replaced_by: the draw Edit & Redraw saved in this one's place, so the
--   usage stats can leave replaced draws out. Deferrable, because create-draw marks
--   the old draw before inserting the new one in the same transaction
-- Before running it on production, create a Neon branch from production named
-- before-v2-purge (docs/OPERATIONS.md, Restoring data).
-- Run once against each database (Neon dev branch first, then production).

BEGIN;

DELETE FROM Matches
WHERE draw_id IN (SELECT id FROM Draws WHERE created_at < '2026-10-17 00:00:00 America/New_York');

DELETE FROM Participants
WHERE draw_id IN (SELECT id FROM Draws WHERE created_at < '2026-10-17 00:00:00 America/New_York');

DELETE FROM Draws
WHERE created_at < '2026-10-17 00:00:00 America/New_York';

ALTER TABLE Participants
     DROP COLUMN reveal_token;

ALTER TABLE Participants
     ALTER COLUMN reveal_code SET NOT NULL;

ALTER TABLE Draws
     ADD COLUMN replaced_by uuid NULL REFERENCES Draws(id) DEFERRABLE INITIALLY DEFERRED;

COMMIT;
