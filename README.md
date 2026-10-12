<p align="center"><img src="public/logo.svg" alt="Secret Santa Picker logo" width="120" height="140"></p>

# Secret Santa Picker

[![CI](https://github.com/dan-basar/secret-santa/actions/workflows/ci.yml/badge.svg?branch=main)](https://github.com/dan-basar/secret-santa/actions/workflows/ci.yml?query=branch%3Amain)

**Live app:** <https://www.baseworkshop.app/secret-santa>

A full-stack web application for running Secret Santa gift exchanges. Create a draw, assign participants to groups to prevent unwanted pairings, share a results link, and optionally send everyone an email revealing their match.

Built with **Next.js**, **TypeScript**, and **Neon Postgres**, deployed on **Vercel**.

More detail:
- [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) — which link unlocks what, the draw lifecycle, the request path, tables and the data we keep
- [docs/OPERATIONS.md](docs/OPERATIONS.md) — runbook: migrations, environment variables, key rotation, email trouble, rollback, health check

---

## Features

- **Conflict-free matching** — participants in the same group (e.g. families, teams) are never paired together
- **Up to 50 participants** across up to 20 groups per draw
- **Private reveal links** — each participant gets a personal link that shows only who they drew, behind a tap-to-reveal
- **Shareable link** — public view lists participant names only; pairings stay private
- **Email notifications** — one-click emails to all participants, protected by Cloudflare Turnstile CAPTCHA; anyone whose email failed can be resent to later
- **Admin access** — the creator gets a private link to see matches, emails and personal links, send emails, delete the draw, or edit and redraw
- **Soft-delete** — draws are hidden, not destroyed
- **Rate limiting** — per-IP hourly limits on creating, emailing and deleting draws

---

## Tech Stack

| Layer | Technology |
|---|---|
| Framework | Next.js (pages router), React 18, TypeScript 5 |
| Database | Neon Postgres via `@neondatabase/serverless` (HTTP driver) |
| Email | Nodemailer + Gmail SMTP |
| CAPTCHA | Cloudflare Turnstile |
| Deployment | Vercel |
| Tests | Vitest, React Testing Library |

---

## Getting Started

### Prerequisites

- Node.js 24 and npm
- A [Neon](https://neon.tech) Postgres database (on Vercel, connect it through the Neon integration so `DATABASE_URL` is set for you)
- A Gmail account with an [app-specific password](https://support.google.com/accounts/answer/185833)
- A [Cloudflare Turnstile](https://www.cloudflare.com/products/turnstile/) site/secret key pair

### Environment Variables

Copy [`.env.example`](.env.example) to `.env.local` and fill in the values (or run `vercel env pull .env.local` to fetch them from the linked Vercel project). Every variable is required except `RATE_LIMIT_IP_WHITELIST`; `NEXT_PUBLIC_BASE_URL` is the site origin without the `/secret-santa` basePath.

```bash
cp .env.example .env.local
```

**Local development never uses the production database.** Point `DATABASE_URL` in `.env.local` at the Neon `dev` branch (an empty copy of the schema, with no real participants); the production connection string lives only in Vercel. `vercel env pull` writes the production value, so swap `DATABASE_URL` back to the dev branch after running it.

The real Turnstile keys don't accept `localhost`. For `npm run dev`, put Cloudflare's [published test keys](https://developers.cloudflare.com/turnstile/troubleshooting/testing/) in `.env.development.local`, which overrides `.env.local` only in development:

```dotenv
NEXT_PUBLIC_TURNSTILE_SITE_KEY=1x00000000000000000000AA
TURNSTILE_SECRET_KEY=1x0000000000000000000000000000000AA
```

### Database Setup

Run the schema script once to create all required tables (`Draws`, `Participants`, `Matches`, `EmailSendLog`, `RateLimits`):

```bash
psql "$DATABASE_URL" -f sql/setup.sql
```

You can also paste the script into the SQL Editor in the Neon console. See [`sql/setup.sql`](sql/setup.sql) for the full schema.

`setup.sql` already includes every migration, so a new database needs nothing else. [`sql/migrations/`](sql/migrations) holds the one-off changes for databases created before them, each with a read-only `_check.sql` to run afterwards:

| Migration | Adds |
|---|---|
| `002_reveal_tokens.sql` | `Participants.reveal_token`, for personal reveal links |
| `003_rate_limits.sql` | The `RateLimits` table |
| `004_email_status.sql` | `Participants.email_sent_at`, for per-person email tracking and resend |
| `005_email_claims.sql` | `Participants.email_claimed_at`, so a send that dies midway leaves nobody wrongly marked as emailed |
| `006_match_constraints.sql` | `Draws.admin_key` becomes `NOT NULL`; `UNIQUE` on each of `Matches.giver_participant_id` and `receiver_participant_id` |
| `007_email_send_log.sql` | The `EmailSendLog` table, for the rolling 24-hour email cap (replaces `DailyEmailLog`, which is no longer read) |

Numbering starts at 002 because 001 was the original Azure SQL schema, which was replaced by `setup.sql` when the app moved to Neon. How to apply one safely is in [docs/OPERATIONS.md](docs/OPERATIONS.md#applying-a-migration).

### Running

```bash
npm install
npm run dev        # → http://localhost:3000/secret-santa
npm run typecheck  # tsc --noEmit
npm test           # Vitest tests in tests/
npm run build && npm start  # production
```

CI (`.github/workflows/ci.yml`) runs typecheck, tests and build on every pull request.

---

## How It Works

### Matching Algorithm

No participant can draw themselves or anyone in their group. Group names are compared trimmed and case-insensitively, so "Family" and "family " are one group. Before writing to the DB, the algorithm checks feasibility: if any single group holds more than 50% of participants, a valid assignment is impossible and the draw is rejected.

Matching runs in two phases:
1. **Random shuffle** — up to 1,000 attempts pairing givers with a uniformly shuffled receiver list
2. **Feasibility-checked fallback** — assigns receivers one giver at a time, only taking a receiver that leaves the rest still matchable, so it never dead-ends

### Email Flow

The organizer provides their name and email, completes a Turnstile CAPTCHA, and sends. Each participant with an email address gets their match and their personal reveal link.

Sending is tracked per person. Each person is claimed in the database (`Participants.email_claimed_at`) before their email goes out, so two clicks can never email anyone twice. As soon as their own email settles, `email_sent_at` is set and the daily count goes up if it went out, or the claim is released if it failed. A request that dies midway (the function's time limit, or a stalled SMTP connection) leaves only the emails still in flight claimed; a claim older than 5 minutes can be taken again, so those people show as not delivered and can be resent to. SMTP connect, greeting and socket timeouts are 15 seconds, so a stalled send fails well within the 60-second function limit. The organizer then sees who wasn't reached and can **resend to just those people** (`retryFailed: true`), or share their personal links another way. A second full send is rejected with `409 Conflict`. If every email in a first send fails, the draw is reopened so the organizer can start over.

A cap of 495 emails in any 24 hours, across all draws, is enforced via `EmailSendLog` to stay within Gmail's rolling SMTP limit. Each send checks the cap, claims the draw and its people, and reserves its count in one database transaction before any email goes out.

### Admin Access

Draw creation returns a `drawId` and a random `adminKey`. The creator is redirected to `/draw/<id>#key=<adminKey>`. The key sits in the URL fragment, which browsers never send to the server, and the page passes it to `get-draw` in an `X-Admin-Key` header, so it stays out of request logs. Older `?key=` links still work: the page reads the key and rewrites the address to the `#key=` form. Anyone with just the draw ID sees participant names only. The admin key unlocks the matches, email addresses, groups and personal reveal links, plus sending emails, deletion and the edit-and-redraw flow. Pairings are visible only to the organizer and, one at a time, to each person through their own reveal link. See [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) for the full picture.

### Rate Limiting

[`src/proxy.ts`](src/proxy.ts) limits each IP per hour: 10 for `create-draw`, 5 for `send-emails` and 10 for `delete-draw`; over the limit it returns `429`. Counts live in the Neon `RateLimits` table, so every Vercel instance shares them: one row per SHA-256 hash of IP + route per hour (raw IPs are never stored). Rows older than 2 days are deleted on roughly 1 in 100 limited requests. If the database check fails, the request is allowed through (fails open). IPs in `RATE_LIMIT_IP_WHITELIST` are never limited.

---

## Project Structure

```
src/
  lib/
    db.ts             # Neon serverless SQL client, isUuid()
    matching.ts       # Matching algorithm (shuffle + feasibility-checked fallback)
    email.ts          # Nodemailer email service
    email-address.ts  # isValidEmail(): the one address check, used by the forms and the API
    sanitize.ts       # HTML tag and web-address checks, escaping for emails
    base-path.json    # The /secret-santa basePath, read by next.config.js and site.ts
    site.ts           # BASE_PATH, and siteUrl(): public URLs with the basePath
    turnstile.ts      # verifyTurnstile(): server-side CAPTCHA check, 5s timeout, never throws
    groups.ts         # Home page form state: groups by id, Edit & Redraw draft
  pages/
    api/
      create-draw.ts  # POST: validate, match, persist in a transaction
      get-draw.ts     # GET: fetch draw; matches and reveal links for the organizer only
      reveal.ts       # GET: one participant's own match, by reveal token
      send-emails.ts  # POST: CAPTCHA + 24-hour cap + per-person claimed send / resend
      delete-draw.ts  # POST: soft-delete
      health.ts       # GET: DB health check
    _app.tsx          # App wrapper: global styles and icons
    index.tsx         # Home page — participant form
    draw/[id].tsx     # Results page — names for everyone; matches, personal links, email, admin actions for the organizer
    reveal/[token].tsx  # Participant's private tap-to-reveal page
  components/
    draw/             # The results page's sections (share bar, matches table, personal links, email, delete); state stays in the page.
                      # TurnstileWidget.tsx loads the CAPTCHA script, only where the send/resend form renders
  proxy.ts            # Per-IP hourly rate limits (RateLimits table)
  styles/             # globals.css design tokens + CSS Modules per page
  types/
    api.ts            # JSON response types, shared by the API routes and the pages
    turnstile.d.ts    # Types for Cloudflare Turnstile's window.turnstile
tests/                # Vitest tests: lib, every API route, and the home form (React Testing Library, jsdom)
public/               # Logo, favicons, app icons and link-preview image
sql/
  setup.sql           # Database schema (Postgres)
  migrations/         # One-off schema changes for existing databases, each with a _check.sql
docs/                 # Architecture and operations notes
```

---

## API Reference

All endpoints are under `/secret-santa/api/`. Errors always return `{ "error": "<message>" }`: `400` for a missing draw id, `405` (with an `Allow` header) for a wrong HTTP method, and the codes listed per route. Routes marked *rate limited* return `429` when an IP goes over its hourly limit.

| Method | Path | Description |
|---|---|---|
| `POST` | `/api/create-draw` | *Rate limited (10/h).* Validate 2–50 participants (`{ name, email?, group? }`; names may not contain HTML or a web address, since they go into the emails), generate matches, persist in a transaction. Returns `{ drawId, adminKey }`. `400` bad input, `422` no valid matching. Edit & Redraw also sends `replacesDrawId` + `replacesKey` to soft-delete the old draw in the same transaction. |
| `GET` | `/api/get-draw?id=<uuid>` | Fetch a draw. Optional header `X-Admin-Key: <adminKey>` (a `key` in the query string is ignored). Without a valid admin key: participant names only. With it: emails, groups, reveal tokens, per-person email status and matches, each match as `{ giver, receiver }` indexes into `participants`. Requests without a key never run the matches query. `410` for deleted draws. |
| `GET` | `/api/reveal?token=<uuid>` | One participant's name, their match, the draw date and the organizer (once emails are sent). `404` for unknown tokens, `410` for deleted draws. |
| `POST` | `/api/send-emails` | *Admin key required. Rate limited (5/h).* Body `{ id, key, turnstileToken, organizerName, organizerEmail }`, or `{ id, key, turnstileToken, retryFailed: true }` to resend only to people whose email failed. Returns `{ success, totalSent, totalFailed, failedNames }`. `403` wrong key or failed CAPTCHA (including when Cloudflare can't be reached), `409` already sent (or nothing to resend), `410` deleted, `503` cap of 495 emails in 24 hours reached. |
| `POST` | `/api/delete-draw` | *Admin key required. Rate limited (10/h).* Body `{ id, key }`. Soft-delete a draw. Idempotent. `403` wrong key. |
| `GET` | `/api/health` | `{ ok: true }` if DB reachable; `503 { ok: false, error }` otherwise. |

---

## Deployment

Import the repository into Vercel and add all environment variables under **Project Settings → Environment Variables**.

Key configuration notes:
- All routes are served under `/secret-santa` (`basePath` in `next.config.js`, read from `src/lib/base-path.json`) — do not remove this. To change the prefix, edit only that JSON file
- `DATABASE_URL` is provided by the Neon integration on Vercel
- `vercel.json` gives each API route file its own entry (no globs, so no file matches two patterns): all run in the `cle1` region with a 10s timeout, except `send-emails`, which gets 60s so a 50-person draw has time to send. A new API route needs its own entry; `tests/vercel-config.test.ts` fails until it has one

Day-to-day operations (migrations, key rotation, rollback) are in [docs/OPERATIONS.md](docs/OPERATIONS.md).

---

## Contributing

Pull requests are welcome. A few conventions to follow:

- TypeScript strict mode — avoid `any`
- Run `npm run typecheck` and `npm test` before opening a PR; CI runs both plus the build
- Always use parameterized SQL queries; never interpolate user input
- Multi-step writes must use transactions with rollback on error
- Open PRs against `main`; use descriptive kebab-case branch names

---

## License

[MIT](LICENSE) © 2026 Dan Basar
