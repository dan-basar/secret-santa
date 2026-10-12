-- Short links: personal links become /reveal/<8 letters and digits> and organizer
-- links /draw#<14 letters and digits>, replacing UUIDs.
-- * Participants.reveal_code holds the new 8-character personal link token. It is
--   a new column rather than a change to reveal_token, so the code deployed until
--   this PR merges (and any rollback to it) keeps working: that code still fills
--   and reads the uuid reveal_token, which stays until old draws are purged.
--   Existing rows get no reveal_code; links from before this change stop working.
-- * Draws.admin_key gets a unique constraint, because get-draw now finds a draw
--   by its key alone (and create-draw retries if a new key ever repeats one).
--   The column is already varchar(100), so it holds the new 14-character keys.
-- Run once against each database (Neon dev branch first, then production).

BEGIN;

ALTER TABLE Participants
     ADD COLUMN reveal_code varchar(8) NULL
    ,ADD CONSTRAINT UQ_Participants_RevealCode UNIQUE (reveal_code);

ALTER TABLE Draws
     ADD CONSTRAINT UQ_Draws_AdminKey UNIQUE (admin_key);

COMMIT;
