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
    ,admin_key varchar(100) NULL
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
);

-- Indexes on draw_id support the common query pattern: fetch all participants /
-- matches for a given draw
CREATE INDEX IX_Participants_DrawId ON Participants(draw_id);
CREATE INDEX IX_Matches_DrawId ON Matches(draw_id);

-- One row per UTC date; tracks aggregate emails sent against Gmail's daily limit.
-- date primary key lets send-emails.ts upsert atomically with ON CONFLICT.
CREATE TABLE DailyEmailLog (
     log_date date PRIMARY KEY
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
