-- Run this script once in your Neon Postgres database to set up the schema.
-- Unquoted identifiers fold to lowercase in Postgres (Draws -> draws), so the
-- app's queries can keep using the original mixed-case names.

CREATE TABLE Draws (
     -- uuid prevents sequential ID enumeration and allows the ID to be
     -- generated client-side before the DB insert (create-draw.ts does this)
     id uuid PRIMARY KEY DEFAULT gen_random_uuid()
    ,created_at timestamptz NOT NULL DEFAULT now()
     -- Nullable timestamps double as boolean flags: NULL = event hasn't occurred;
     -- non-NULL = when it did. Avoids a separate boolean column.
    ,emails_sent_at timestamptz NULL
    ,deleted_at timestamptz NULL
     -- Organizer fields are populated when emails are sent, not at draw creation
    ,organizer_name varchar(200) NULL
    ,organizer_email varchar(320) NULL
     -- Secret key included in the organizer's URL; required to send emails or delete
     -- (NOT NULL since migrations/006_match_constraints.sql)
    ,admin_key varchar(100) NOT NULL
);

CREATE TABLE Participants (
     id integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY
    ,draw_id uuid NOT NULL REFERENCES Draws(id)
     -- 1..n order of the participant within its draw, as submitted. create-draw.ts
     -- uses (draw_id, position) to link matches to participants, so duplicate
     -- names within a draw can't be confused with each other.
    ,position integer NOT NULL
    ,name varchar(200) NOT NULL
     -- NULL when not provided; the API filters out empty emails before sending
    ,email varchar(320) NULL
    ,group_name varchar(200) NULL
     -- Secret token in the participant's private /reveal/<token> link; shows only
     -- their own match (added by migrations/002_reveal_tokens.sql)
    ,reveal_token uuid NOT NULL DEFAULT gen_random_uuid()
     -- When this participant's match email went out; NULL = not sent (yet), so the
     -- organizer can resend to just those people (added by migrations/004_email_status.sql)
    ,email_sent_at timestamptz NULL
     -- When a send-emails request took this participant to email them; cleared as soon
     -- as that email settles. A claim older than 5 minutes is from a request that died
     -- mid-send and can be taken again (added by migrations/005_email_claims.sql)
    ,email_claimed_at timestamptz NULL
    ,UNIQUE (draw_id, position)
    ,CONSTRAINT UQ_Participants_RevealToken UNIQUE (reveal_token)
);

CREATE TABLE Matches (
     id integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY
     -- draw_id is denormalised here so matches can be fetched in a single
     -- indexed query without joining Draws
    ,draw_id uuid NOT NULL REFERENCES Draws(id)
    ,giver_participant_id integer NOT NULL REFERENCES Participants(id)
    ,receiver_participant_id integer NOT NULL REFERENCES Participants(id)
     -- One gift given and one received per person (added by
     -- migrations/006_match_constraints.sql). The giver index also serves reveal.ts,
     -- which looks a match up by its giver
    ,CONSTRAINT UQ_Matches_Giver UNIQUE (giver_participant_id)
    ,CONSTRAINT UQ_Matches_Receiver UNIQUE (receiver_participant_id)
);

-- Indexes on draw_id support the common query pattern: fetch all participants /
-- matches for a given draw
CREATE INDEX IX_Participants_DrawId ON Participants(draw_id);
CREATE INDEX IX_Matches_DrawId ON Matches(draw_id);

-- Emails sent per hour, across all draws. send-emails.ts sums the rows from the last
-- 24 hours against Gmail's rolling daily limit, reserving a send's count before it
-- sends. The primary key lets it upsert atomically with ON CONFLICT (added by
-- migrations/007_email_send_log.sql, replacing the per-day DailyEmailLog).
CREATE TABLE EmailSendLog (
     hour_start timestamptz PRIMARY KEY
    ,emails_sent integer NOT NULL DEFAULT 0
);

-- One hit counter per hashed IP + route per hour, shared by every Vercel instance
-- (src/proxy.ts). Counter rows older than 2 days are hard-deleted by the proxy: they
-- hold no one's data, so they're an exception to the soft-delete rule.
CREATE TABLE RateLimits (
     bucket varchar(200) NOT NULL        -- SHA-256 hex of IP + route; raw IPs are never stored
    ,window_start timestamptz NOT NULL   -- start of the hour the hits fall in
    ,hits integer NOT NULL DEFAULT 1
    ,PRIMARY KEY (bucket, window_start)
);
