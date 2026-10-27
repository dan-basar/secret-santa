<p align="center"><img src="public/logo.svg" alt="Secret Santa Picker logo" width="120" height="140"></p>

# Secret Santa Picker

[![CI](https://github.com/dan-basar/secret-santa/actions/workflows/ci.yml/badge.svg?branch=main)](https://github.com/dan-basar/secret-santa/actions/workflows/ci.yml?query=branch%3Amain)

**Live app:** <https://www.baseworkshop.app/secret-santa>

A full-stack web application for running Secret Santa gift exchanges. Create a draw, assign participants to groups to prevent unwanted pairings, share a results link, and optionally send everyone an email revealing their match.

Built with **Next.js**, **TypeScript**, and **Neon Postgres**, deployed on **Vercel**.

More detail:
- [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) — how it works: which link unlocks what, the draw lifecycle, sending emails, the note, budget and date, matching, the request path, rate limits, tables and the data we keep
- [docs/OPERATIONS.md](docs/OPERATIONS.md) — runbook: migrations, environment variables, key rotation, alerts, email trouble, rollback, health check

---

## Features

- **Conflict-free matching** — participants in the same group (e.g. families, teams) are never paired together
- **Up to 50 participants** across up to 20 groups per draw
- **Form kept as you type** — the home form is saved in the browser tab's session storage, so a refresh or an accidental Back doesn't lose it; a small "Clear form" link appears once there are more than two rows
- **Private reveal links** — each participant gets a personal link that shows only who they drew, behind a tap-to-reveal; on a phone or tablet, a Text button beside each link opens the messages app with "Hi Sam, your Secret Santa match is ready:" and the link filled in
- **Note, budget and date** — the organizer can add a short note (150 characters, no links), a dollar budget and an exchange date; they go into each match email and show on each personal link page, and lock once the emails are sent
- **Email notifications** — one-click emails to all participants, protected by Cloudflare Turnstile CAPTCHA; anyone whose email failed can be resent to later
- **Admin access** — the creator gets a private organizer link, shown with a Copy button at the top of their page, and by email when they send, to see matches (hidden until they ask, so an organizer who is playing isn't spoiled), emails and personal links, send emails, delete the draw, or edit and redraw
- **Share or print your Secret Santa** — once the organizer shows the matches, a card below the personal links offers a CSV download (Secret Santa, Group, Email, Match Name, Match Group, Match Email; the group or email columns are left out when nobody has one), a PDF and a print view with the note, budget and date and each person's email under their name; phones and tablets get Share (the PDF in the share sheet) and Print instead. Everything is made in the browser, so nothing is sent anywhere
- **Soft-delete** — draws are hidden, not destroyed
- **Rate limiting** — per-IP hourly limits on creating and emailing draws, plus a budget of 100 emails per IP in any 24 hours, so one connection can't use up the site's daily email cap

---

## Tech Stack

| Layer | Technology |
|---|---|
| Framework | Next.js (pages router), React 18, TypeScript 5 |
| Database | Neon Postgres via `@neondatabase/serverless` (HTTP driver) |
| Email | Nodemailer + Gmail SMTP |
| CAPTCHA | Cloudflare Turnstile |
| Deployment | Vercel |
| PDF | jsPDF + jspdf-autotable with Noto Sans (Latin, Greek, Cyrillic), loaded in the browser only when the organizer saves or shares a PDF |
| Tests | Vitest, React Testing Library, PGlite (in-memory Postgres) |

---

## Getting Started

### Prerequisites

- Node.js 24 and npm
- A [Neon](https://neon.tech) Postgres database (on Vercel, connect it through the Neon integration so `DATABASE_URL` is set for you)
- A Gmail account with an [app-specific password](https://support.google.com/accounts/answer/185833)
- A [Cloudflare Turnstile](https://www.cloudflare.com/products/turnstile/) site/secret key pair

### Environment Variables

Copy [`.env.example`](.env.example) to `.env.local` and fill in the values (or run `vercel env pull .env.local` to fetch them from the linked Vercel project). The file says what each variable is for and which ones are optional.

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

Run the schema script once to create all required tables (`Draws`, `Participants`, `Matches`, `EmailSendLog`, `RateLimits`, `DailyStats`):

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
| `007_email_send_log.sql` | The `EmailSendLog` table, for the rolling 24-hour email cap (replaces `DailyEmailLog`, dropped by 010) |
| `008_short_links.sql` | `Participants.reveal_code`, the 8-character personal link token (the uuid `reveal_token` is retired), and `UNIQUE` on `Draws.admin_key`, which get-draw now looks draws up by |
| `009_exchange_details.sql` | `Draws.organizer_note`, `budget_cents` and `exchange_date`, the optional details shown in match emails and on personal link pages |
| `010_drop_daily_email_log.sql` | Removes the unused `DailyEmailLog` table that 007 left behind, so older databases match `setup.sql` |
| `011_ops_stats.sql` | `Participants.revealed_at` (when a personal link was first opened) and the `DailyStats` table the daily check job writes, for the usage stats |

Numbering starts at 002 because 001 was the original Azure SQL schema, which was replaced by `setup.sql` when the app moved to Neon. How to apply one safely is in [docs/OPERATIONS.md](docs/OPERATIONS.md#applying-a-migration).

### Running

```bash
npm install
npm run dev        # → http://localhost:3000/secret-santa
npm run typecheck  # tsc --noEmit
npm test           # Vitest tests in tests/
npm run build && npm start  # production
```

CI (`.github/workflows/ci.yml`) runs the tests and the build, which type-checks every file including the tests, on every pull request, and blocks pull requests during the yearly holiday change freeze (see [docs/OPERATIONS.md](docs/OPERATIONS.md#holiday-change-freeze)).

---

## Project Structure

```
src/
  lib/
    db.ts             # Neon serverless SQL client
    tokens.ts         # Organizer keys (14 characters) and personal link tokens (8): generation and shape checks
    matching.ts       # Matching algorithm (shuffle + feasibility-checked fallback)
    email.ts          # Nodemailer email service: the match, organizer link and ops emails
    limits.ts         # The email cap, the per-IP email budget and the send claim expiry
    report.ts         # reportError(), reportWarning(): log and send to Sentry
    email-address.ts  # isValidEmail(): the one address check, used by the forms and the API
    sanitize.ts       # HTML tag and web-address checks, escaping for emails
    base-path.json    # The /secret-santa basePath, read by next.config.js and site.ts
    site.ts           # BASE_PATH, and siteUrl(): public URLs with the basePath
    turnstile.ts      # verifyTurnstile(): server-side CAPTCHA check, 5s timeout, never throws
    groups.ts         # Home page form state: groups by id, Edit & Redraw hand-off, the as-you-type draft (parseFormDraft)
    names.ts          # duplicateNames(): names must differ ignoring case and spaces (form and API)
    details.ts        # The note, budget and date: checks, formatting and the lines the emails and lists show
    email-draft.ts    # The draw page's email card draft in session storage, kept per draw
    match-list.ts     # The organizer's list of matches: table order and CSV columns
    match-pdf.ts      # The matches as a PDF (jsPDF), made in the browser
    ip-prefix.ts      # rateLimitClient(): IPv4 address, or IPv6 /64, as one rate-limit client
    rate-limit.ts     # clientIp(), isWhitelisted(), rateLimitBucket(): shared by the proxy and the email budget
  pages/
    api/
      create-draw.ts  # POST: validate, match, persist in a transaction
      get-draw.ts     # GET: the organizer's view of a draw, found by its admin key
      reveal.ts       # GET: one participant's own match, by reveal token
      send-emails.ts  # POST: CAPTCHA + 24-hour cap + per-IP email budget + per-person claimed send / resend
      save-details.ts # POST: save the note, budget and date before any send
      delete-draw.ts  # POST: soft-delete
      health.ts       # GET: liveness check for the uptime monitor; never touches the database
      ops-check.ts    # GET: daily check job + weekly stats email (Vercel Cron, CRON_SECRET)
    _app.tsx          # App wrapper: global styles, icons, and the fonts (next/font, self-hosted)
    _document.tsx     # Sets <html lang="en">
    index.tsx         # Home page — participant form
    draw.tsx          # Organizer page (/draw#<adminKey>) — organizer link, matches, personal links, email, admin actions
    reveal/[token].tsx  # Participant's private tap-to-reveal page
  components/
    draw/             # The results page's sections (organizer link, matches table, email, personal links, save and print, delete); state stays in the page.
                      # PrintSheet.tsx is what the page prints once the matches are shown
                      # TurnstileWidget.tsx loads the CAPTCHA script, only where the send/resend form renders
  proxy.ts            # Per-IP hourly rate limits (RateLimits table)
  instrumentation.ts  # Loads sentry.server.config.ts: server errors to Sentry when SENTRY_DSN is set
  styles/             # globals.css design tokens + CSS Modules per page
  types/
    api.ts            # JSON response types, shared by the API routes and the pages
    turnstile.d.ts    # Types for Cloudflare Turnstile's window.turnstile
tests/                # Vitest tests: lib, every API route, and the home form (React Testing Library, jsdom)
  real-sql.test.ts    # The routes' real SQL against sql/setup.sql in PGlite
  helpers/            # callRoute() for route tests, and the PGlite stand-in for the database
public/               # Logo, favicons, app icons, link-preview image, and fonts/ (Noto Sans for the PDF; docs/OPERATIONS.md)
sql/
  setup.sql           # Database schema (Postgres)
  migrations/         # One-off schema changes for existing databases, each with a _check.sql
docs/                 # Architecture and operations notes
scripts/              # freeze.ts: the yearly holiday change freeze dates, checked by CI (check-freeze.ts)
```

---

## API Reference

All endpoints are under `/secret-santa/api/`. Errors always return `{ "error": "<message>" }`: `405` (with an `Allow` header) for a wrong HTTP method, and the codes listed per route. Routes marked *admin key required* find the draw by that key alone. Routes marked *rate limited* return `429` when an IP goes over its hourly limit.

| Method | Path | Description |
|---|---|---|
| `POST` | `/api/create-draw` | *Rate limited (10/h).* Validate 2–50 participants (`{ name, email?, group? }`; names may not contain HTML or a web address, since they go into the emails, and must differ ignoring case and spaces, so each person can tell who they drew), generate matches, persist in a transaction. Returns `{ adminKey }`, retrying with fresh tokens in the rare case one repeats a saved one. `400` bad input, `422` no valid matching. Edit & Redraw also sends `replacesKey`, the old draw's admin key, to soft-delete the old draw in the same transaction; the new draw keeps its saved note, budget and date. `403` missing, malformed or unknown `replacesKey`, `409` the old draw's emails were sent, `410` it was already deleted. |
| `GET` | `/api/get-draw` | The organizer's view of a draw, found by the header `X-Admin-Key: <adminKey>` (never the query string): its participants with emails, groups, reveal tokens and per-person email status, matches, each as `{ giver, receiver }` indexes into `participants`, `organizer_name` (set by the first send), and `organizer_note`, `budget_cents` and `exchange_date` (`YYYY-MM-DD`), each `null` when not set. `404` for a missing, malformed or unknown key, `410` for deleted draws. |
| `GET` | `/api/reveal?token=<token>` | One participant's name, their match, the draw date, the organizer (once emails are sent), and the note, budget and exchange date (whenever set). `404` for unknown or malformed tokens, `410` for deleted draws. |
| `POST` | `/api/send-emails` | *Admin key required. Rate limited (5/h).* Body `{ key, turnstileToken, organizerName, organizerEmail, organizerNote?, budget?, exchangeDate? }` (budget is a dollar amount as typed, like `"25.50"`; the date is `YYYY-MM-DD`; the saved details are used on a resend), or `{ key, turnstileToken, retryFailed: true }` to resend only to people whose email failed. Also emails the organizer their organizer link on the first send, or only that when no participant has an email (the draw then stays unsent). Returns `{ success, totalSent, totalFailed, failedNames, organizerLinkSent }`. `400` bad input (including an organizer name over 200 characters or containing HTML or a web address, or an email over 320; a note over 150 characters or containing HTML or a web address; a budget that isn't a dollar amount of $10,000 or less; a date that isn't a real day), `403` missing, malformed or unknown key, or failed CAPTCHA (including when Cloudflare can't be reached), `409` already sent (or nothing to resend), `410` deleted, `429` the sender's IP has used its budget of 100 emails in 24 hours, `503` cap of 495 emails in 24 hours reached. |
| `POST` | `/api/save-details` | *Admin key required.* Body `{ key, organizerNote?, budget?, exchangeDate? }`, checked like the first send; an empty value clears that detail. Saves them on the draw without sending any email, so they show on personal links. Returns `{ organizer_note, budget_cents, exchange_date }` as saved. `400` bad input, `403` missing, malformed or unknown key, `409` emails already sent, `410` deleted. |
| `POST` | `/api/delete-draw` | *Admin key required.* Body `{ key }`. Soft-delete a draw. Idempotent: deleting again keeps the first deletion time. `403` missing, malformed or unknown key. |
| `GET` | `/api/health` | Always `{ ok: true }`, showing the site's functions run; any method works. It never touches the database, so the uptime monitor can poll it without keeping Neon awake. |
| `GET` | `/api/ops-check` | *`Authorization: Bearer <CRON_SECRET>` required; called by Vercel Cron.* Daily: writes yesterday's `DailyStats` row and emails `OPS_ALERT_EMAIL` if people on sent draws were never emailed or the 24-hour email count nears the cap; with `?report=weekly`, emails the last 7 days of stats. `403` wrong secret, `500` not configured or the job failed. |

---

## Deployment

Import the repository into Vercel and add all environment variables under **Project Settings → Environment Variables**.

Key configuration notes:
- All routes are served under `/secret-santa` (`basePath` in `next.config.js`, read from `src/lib/base-path.json`) — do not remove this. To change the prefix, edit only that JSON file
- `DATABASE_URL` is provided by the Neon integration on Vercel
- `vercel.json` gives each API route file its own entry (no globs, so no file matches two patterns): all run in the `cle1` region with a 10s timeout, except `send-emails`, which gets 120s so a 50-person draw has time to send through a slow mail server, and `ops-check`, which gets 30s so one stalled SMTP stage (15s) can't stop the daily job before it reports. A new API route needs its own entry; `tests/vercel-config.test.ts` fails until it has one

Day-to-day operations (migrations, key rotation, rollback) are in [docs/OPERATIONS.md](docs/OPERATIONS.md).

---

## Contributing

Pull requests are welcome. A few conventions to follow:

- TypeScript strict mode — avoid `any`
- Run `npm run typecheck` and `npm test` before opening a PR; CI runs the tests and the build, which type-checks too
- Always use parameterized SQL queries; never interpolate user input
- Multi-step writes must use transactions with rollback on error
- Open PRs against `main`; use descriptive kebab-case branch names

---

## License

[MIT](LICENSE) © 2026 Dan Basar
