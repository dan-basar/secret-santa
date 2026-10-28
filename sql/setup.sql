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
     -- Exchange details the organizer can add on the organizer page: they go into each
     -- match email and show on each personal link page (added by
     -- migrations/009_exchange_details.sql). The note is plain text, up to 150
     -- characters and no links. The budget is in cents; NULL = no budget set, and 0
     -- shows as "No limit set". The date is the day of the exchange
    ,organizer_note varchar(150) NULL
    ,budget_cents integer NULL
    ,exchange_date date NULL
     -- Secret key in the organizer's /draw#<admin_key> link: 14 letters and digits
     -- (src/lib/tokens.ts). get-draw finds the draw by it, so it is unique (NOT NULL
     -- since migrations/006_match_constraints.sql, unique since 008_short_links.sql)
    ,admin_key varchar(100) NOT NULL
     -- The draw Edit & Redraw saved in this one's place (which also sets deleted_at
     -- here), so the usage stats can leave replaced draws out. Deferred, because
     -- create-draw marks this draw before inserting its replacement in the same
     -- transaction (added by migrations/012_v2_cleanup.sql)
    ,replaced_by uuid NULL REFERENCES Draws(id) DEFERRABLE INITIALLY DEFERRED
    ,CONSTRAINT UQ_Draws_AdminKey UNIQUE (admin_key)
    ,CONSTRAINT CK_Draws_BudgetCents CHECK (budget_cents BETWEEN 0 AND 1000000)
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
     -- Secret in the participant's private /reveal/<reveal_code> link: 8 letters and
     -- digits (src/lib/tokens.ts); shows only their own match (added by
     -- migrations/008_short_links.sql, NOT NULL since 012_v2_cleanup.sql)
    ,reveal_code varchar(8) NOT NULL
     -- When this participant's match email went out; NULL = not sent (yet), so the
     -- organizer can resend to just those people (added by migrations/004_email_status.sql)
    ,email_sent_at timestamptz NULL
     -- When a send-emails request took this participant to email them; cleared as soon
     -- as that email settles. A claim older than 5 minutes is from a request that died
     -- mid-send and can be taken again (added by migrations/005_email_claims.sql)
    ,email_claimed_at timestamptz NULL
     -- When this participant first opened their personal link and saw their match;
     -- NULL = not opened (yet). Set by reveal.ts, for the usage stats (added by
     -- migrations/011_ops_stats.sql)
    ,revealed_at timestamptz NULL
    ,UNIQUE (draw_id, position)
    ,CONSTRAINT UQ_Participants_RevealCode UNIQUE (reveal_code)
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
-- migrations/007_email_send_log.sql, replacing the per-day DailyEmailLog, which
-- migrations/010_drop_daily_email_log.sql drops).
CREATE TABLE EmailSendLog (
     hour_start timestamptz PRIMARY KEY
    ,emails_sent integer NOT NULL DEFAULT 0
);

-- One hit counter per hashed client + route per hour, shared by every Vercel instance
-- (src/proxy.ts). send-emails also counts emails per hashed client per hour here, under
-- its own 'email-budget' scope, for the 100-in-24-hours budget. A bucket is the
-- HMAC-SHA-256 hex, keyed with RATE_LIMIT_HASH_SECRET, of the client (an IPv4 address
-- or IPv6 /64) and the scope (src/lib/rate-limit.ts). Counter rows older than 2 days
-- are hard-deleted by the proxy: they hold no one's data, so they're an exception to
-- the soft-delete rule.
CREATE TABLE RateLimits (
     bucket varchar(200) NOT NULL        -- the hash above; raw IPs are never stored
    ,window_start timestamptz NOT NULL   -- start of the hour the hits fall in
    ,hits integer NOT NULL DEFAULT 1
    ,PRIMARY KEY (bucket, window_start)
);

-- One row of counts per UTC day, written once the day is over by the daily check job
-- (src/pages/api/ops-check.ts). Counts only, no names or emails. unsent_emails is
-- how many people on sent draws still hadn't been emailed when the row was written
-- (added by migrations/011_ops_stats.sql)
CREATE TABLE DailyStats (
     stat_date date PRIMARY KEY
    ,draws_created integer NOT NULL
    ,draws_emailed integer NOT NULL
    ,participants_created integer NOT NULL
    ,emails_sent integer NOT NULL
    ,links_opened integer NOT NULL
    ,unsent_emails integer NOT NULL
    ,recorded_at timestamptz NOT NULL DEFAULT now()
);
