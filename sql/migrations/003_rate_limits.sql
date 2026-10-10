-- Adds the RateLimits table: one hit counter per hashed IP + route per hour, shared
-- by every Vercel instance (src/proxy.ts). Rows are counters, not people's data,
-- and the proxy hard-deletes rows older than 2 days (a documented exception to
-- the soft-delete rule in CLAUDE.md).
-- Run once against each database (Neon dev branch first, then production).

CREATE TABLE RateLimits (
     bucket varchar(200) NOT NULL        -- SHA-256 hex of IP + route; raw IPs are never stored
    ,window_start timestamptz NOT NULL   -- start of the hour the hits fall in
    ,hits integer NOT NULL DEFAULT 1
    ,PRIMARY KEY (bucket, window_start)
);
