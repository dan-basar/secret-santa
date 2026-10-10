-- Adds a private reveal token to each participant, used by /reveal/<token> links.
-- Run once against each database (Neon branch first, then production).
-- gen_random_uuid() is volatile, so Postgres evaluates it per existing row:
-- every current participant gets its own token when the column is added.

BEGIN;

ALTER TABLE Participants
     ADD COLUMN reveal_token uuid NOT NULL DEFAULT gen_random_uuid();

ALTER TABLE Participants
     ADD CONSTRAINT UQ_Participants_RevealToken UNIQUE (reveal_token);

COMMIT;
