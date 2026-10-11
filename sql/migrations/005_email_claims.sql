-- Adds Participants.email_claimed_at: when a send-emails request took this
-- participant to email them. send-emails.ts sets it before sending and clears it as
-- soon as that one email settles, setting email_sent_at only if the email went out.
-- A claim left behind by a request that died mid-send (timeout or crash) expires
-- after 5 minutes, so those people show as not delivered and can be resent to.
-- email_sent_at keeps meaning "this person's email actually went out"; nothing to backfill.
-- Run once against each database (Neon dev branch first, then production).

ALTER TABLE Participants ADD COLUMN email_claimed_at timestamptz NULL;
