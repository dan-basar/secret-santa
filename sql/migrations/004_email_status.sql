-- Adds Participants.email_sent_at: when that participant's match email went out.
-- send-emails.ts claims it per participant before sending and clears it again if
-- the send fails, so the organizer can see who wasn't reached and resend to them.
-- Draws already sent before this change are assumed delivered (backfilled from
-- Draws.emails_sent_at).
-- Run once against each database (Neon dev branch first, then production).

BEGIN;

ALTER TABLE Participants ADD COLUMN email_sent_at timestamptz NULL;

UPDATE Participants as participants
SET email_sent_at = draws.emails_sent_at
FROM Draws as draws
WHERE participants.draw_id = draws.id
     AND draws.emails_sent_at IS NOT NULL
     AND participants.email IS NOT NULL;

COMMIT;
