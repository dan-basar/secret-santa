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
- **Form kept as you type** — the home form is saved in the browser tab's session storage, so a refresh or an accidental Back doesn't lose it; a small "Clear form" link appears once there are more than two rows
- **Private reveal links** — each participant gets a personal link that shows only who they drew, behind a tap-to-reveal; on a phone or tablet, a Text button beside each link opens the messages app with "Hi Sam, your Secret Santa match is ready:" and the link filled in
- **Note, budget and date** — the organizer can add a short note (150 characters, no links), a dollar budget and an exchange date; they go into each match email and show on each personal link page, and lock once the emails are sent
- **Email notifications** — one-click emails to all participants, protected by Cloudflare Turnstile CAPTCHA; anyone whose email failed can be resent to later
- **Admin access** — the creator gets a private organizer link, shown with a Copy button at the top of their page, and by email when they send, to see matches (hidden until they ask, so an organizer who is playing isn't spoiled), emails and personal links, send emails, delete the draw, or edit and redraw
- **Save or print your Secret Santa** — once the organizer shows the matches, a card below the personal links offers a CSV download (Secret Santa, Group, Email, Match Name, Match Group, Match Email; the group or email columns are left out when nobody has one), a PDF and a print view with the note, budget and date and each person's email under their name; all three are made in the browser, so nothing is sent anywhere
- **Soft-delete** — draws are hidden, not destroyed
- **Rate limiting** — per-IP hourly limits on creating, emailing and deleting draws, and on opening organizer and personal links (which keeps their short secrets from being guessed)

---

## Tech Stack

| Layer | Technology |
|---|---|
| Framework | Next.js (pages router), React 18, TypeScript 5 |
| Database | Neon Postgres via `@neondatabase/serverless` (HTTP driver) |
| Email | Nodemailer + Gmail SMTP |
| CAPTCHA | Cloudflare Turnstile |
| Deployment | Vercel |
| PDF | jsPDF + jspdf-autotable, loaded in the browser only when the organizer saves a PDF |
| Tests | Vitest, React Testing Library, PGlite (in-memory Postgres) |

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
| `008_short_links.sql` | `Participants.reveal_code`, the 8-character personal link token (the uuid `reveal_token` is retired), and `UNIQUE` on `Draws.admin_key`, which get-draw now looks draws up by |
| `009_exchange_details.sql` | `Draws.organizer_note`, `budget_cents` and `exchange_date`, the optional details shown in match emails and on personal link pages |

Numbering starts at 002 because 001 was the original Azure SQL schema, which was replaced by `setup.sql` when the app moved to Neon. How to apply one safely is in [docs/OPERATIONS.md](docs/OPERATIONS.md#applying-a-migration).

### Running

```bash
npm install
npm run dev        # → http://localhost:3000/secret-santa
npm run typecheck  # tsc --noEmit
npm test           # Vitest tests in tests/
npm run build && npm start  # production
```

CI (`.github/workflows/ci.yml`) runs typecheck, tests and build on every pull request, and blocks pull requests during the yearly holiday change freeze (see [docs/OPERATIONS.md](docs/OPERATIONS.md#holiday-change-freeze)).

---

## How It Works

### Matching Algorithm

No participant can draw themselves or anyone in their group. Group names are compared trimmed and case-insensitively, so "Family" and "family " are one group. Before writing to the DB, the algorithm checks feasibility: if any single group holds more than 50% of participants, a valid assignment is impossible and the draw is rejected.

Matching runs in two phases:
1. **Random shuffle** — up to 1,000 attempts pairing givers with a uniformly shuffled receiver list
2. **Feasibility-checked fallback** — assigns receivers one giver at a time, only taking a receiver that leaves the rest still matchable, so it never dead-ends

### Email Flow

The organizer provides their name and email, completes a Turnstile CAPTCHA, and sends. Each participant with an email address gets their match and their personal reveal link, and the organizer gets an email with their organizer link (if that one email fails, the send still stands and the page tells them to copy the link instead; a resend doesn't email it again). When no participant has an email address, the same form emails just the organizer their link: the draw isn't marked as sent, so Edit & Redraw stays open and it can be sent again.

Above the send button, a folded "Add a note, budget, or date" row lets the organizer add an optional note, budget and exchange date, with a live preview of the first match email. They are saved with the first send, appear in a box in each email (above the match) and on each personal link page (below the reveal), and can't be changed afterwards (the card then shows them read-only). A budget of $0 shows as "No limit set". With no participant emails they are saved each time the organizer link is emailed, and stay editable, since the draw stays unsent.

Sending is tracked per person. Each person is claimed in the database (`Participants.email_claimed_at`) before their email goes out, so two clicks can never email anyone twice. The daily count is reserved for everyone before the first email goes out (see below). As soon as each person's email settles, `email_sent_at` is set if it went out; if it failed, the claim is released and their share of the reservation is given back. A request that dies midway (the function's time limit, or a stalled SMTP connection) leaves only the emails still in flight claimed; a claim older than 5 minutes can be taken again, so those people show as not delivered and can be resent to. SMTP connect, greeting and socket timeouts are 15 seconds, so a stalled send fails well within the 60-second function limit. The organizer then sees who wasn't reached and can **resend to just those people** (`retryFailed: true`), or share their personal links another way. A second full send is rejected with `409 Conflict`. If every email in a first send fails, the draw is reopened so the organizer can start over. If the request times out (Vercel answers with a 504 and no JSON body), the page says it couldn't confirm the send and reloads the list, so the organizer sees who was reached before resending.

A cap of 495 emails in any 24 hours, across all draws, is enforced via `EmailSendLog` to stay within Gmail's rolling SMTP limit. Each send checks the cap, claims the draw and its people, and reserves its count in one database transaction before any email goes out.

### Admin Access

Draw creation returns a random 14-character `adminKey` (letters and digits, [`src/lib/tokens.ts`](src/lib/tokens.ts)), and the creator is redirected to their organizer link, `/draw#<adminKey>`. The key sits in the URL fragment, which browsers never send to the server, and the page passes it to `get-draw` in an `X-Admin-Key` header, so it stays out of request logs. The draw is found by the key alone; there is no other link to a draw. The organizer page shows this link in a box with a Copy button, warning that it shows everyone's matches and is the only way back. A key cut short when pasted gets "This link looks incomplete". The admin key unlocks the matches, email addresses, groups and personal reveal links, plus sending emails, deletion and the edit-and-redraw flow. Pairings are visible only to the organizer and, one at a time, to each person through their own 8-character personal link, `/reveal/<token>`. See [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) for the full picture.

### Rate Limiting

[`src/proxy.ts`](src/proxy.ts) limits each IP per hour: 10 for `create-draw`, 5 for `send-emails`, 10 for `delete-draw`, and 60 each for `get-draw` and `reveal`, the lookups behind organizer and personal links; over the limit it returns `429`. Counts live in the Neon `RateLimits` table, so every Vercel instance shares them: one row per HMAC-SHA-256 hash of client + route per hour, keyed with `RATE_LIMIT_HASH_SECRET`, so raw IPs are never stored and the hashes can't be reversed without the secret. A client is an IPv4 address, or an IPv6 /64 block (one household or phone can hold millions of IPv6 addresses). Rows older than 2 days are deleted on roughly 1 in 100 limited requests. If the database check fails or the secret is missing, the request is allowed through (fails open) and the error is logged. IPs in `RATE_LIMIT_IP_WHITELIST` are never limited.

---

## Project Structure

```
src/
  lib/
    db.ts             # Neon serverless SQL client (re-exports isUuid())
    uuid.ts           # isUuid(): draw id shape check for the routes
    tokens.ts         # Organizer keys (14 characters) and personal link tokens (8): generation and shape checks
    matching.ts       # Matching algorithm (shuffle + feasibility-checked fallback)
    email.ts          # Nodemailer email service
    email-address.ts  # isValidEmail(): the one address check, used by the forms and the API
    sanitize.ts       # HTML tag and web-address checks, escaping for emails
    base-path.json    # The /secret-santa basePath, read by next.config.js and site.ts
    site.ts           # BASE_PATH, and siteUrl(): public URLs with the basePath
    turnstile.ts      # verifyTurnstile(): server-side CAPTCHA check, 5s timeout, never throws
    groups.ts         # Home page form state: groups by id, Edit & Redraw hand-off, the as-you-type draft (parseFormDraft)
    names.ts          # duplicateNames(): names must differ ignoring case and spaces (form and API)
    match-list.ts     # The organizer's list of matches: table order, CSV columns, details lines
    match-pdf.ts      # The matches as a PDF (jsPDF), made in the browser
    ip-prefix.ts      # rateLimitClient(): IPv4 address, or IPv6 /64, as one rate-limit client
  pages/
    api/
      create-draw.ts  # POST: validate, match, persist in a transaction
      get-draw.ts     # GET: the organizer's view of a draw, found by its admin key
      reveal.ts       # GET: one participant's own match, by reveal token
      send-emails.ts  # POST: CAPTCHA + 24-hour cap + per-person claimed send / resend
      delete-draw.ts  # POST: soft-delete
      health.ts       # GET: DB health check
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
  styles/             # globals.css design tokens + CSS Modules per page
  types/
    api.ts            # JSON response types, shared by the API routes and the pages
    turnstile.d.ts    # Types for Cloudflare Turnstile's window.turnstile
tests/                # Vitest tests: lib, every API route, and the home form (React Testing Library, jsdom)
  real-sql.test.ts    # The routes' real SQL against sql/setup.sql in PGlite
public/               # Logo, favicons, app icons and link-preview image
sql/
  setup.sql           # Database schema (Postgres)
  migrations/         # One-off schema changes for existing databases, each with a _check.sql
docs/                 # Architecture and operations notes
scripts/              # freeze.ts: the yearly holiday change freeze dates, checked by CI (check-freeze.ts)
```

---

## API Reference

All endpoints are under `/secret-santa/api/`. Errors always return `{ "error": "<message>" }`: `400` for a missing draw id, `405` (with an `Allow` header) for a wrong HTTP method, and the codes listed per route. Routes marked *rate limited* return `429` when an IP goes over its hourly limit.

| Method | Path | Description |
|---|---|---|
| `POST` | `/api/create-draw` | *Rate limited (10/h).* Validate 2–50 participants (`{ name, email?, group? }`; names may not contain HTML or a web address, since they go into the emails, and must differ ignoring case and spaces, so each person can tell who they drew), generate matches, persist in a transaction. Returns `{ adminKey }`, retrying with fresh tokens in the rare case one repeats a saved one. `400` bad input, `422` no valid matching. Edit & Redraw also sends `replacesDrawId` + `replacesKey` to soft-delete the old draw in the same transaction. |
| `GET` | `/api/get-draw` | *Rate limited (60/h).* The organizer's view of a draw, found by the header `X-Admin-Key: <adminKey>` (never the query string): its id, participants with emails, groups, reveal tokens and per-person email status, matches, each as `{ giver, receiver }` indexes into `participants`, `organizer_name` (set by the first send), and `organizer_note`, `budget_cents` and `exchange_date` (`YYYY-MM-DD`), each `null` when not set. `404` for a missing, malformed or unknown key, `410` for deleted draws. |
| `GET` | `/api/reveal?token=<token>` | *Rate limited (60/h).* One participant's name, their match, the draw date, the organizer (once emails are sent), and the note, budget and exchange date (whenever set). `404` for unknown or malformed tokens, `410` for deleted draws. |
| `POST` | `/api/send-emails` | *Admin key required. Rate limited (5/h).* Body `{ id, key, turnstileToken, organizerName, organizerEmail, organizerNote?, budget?, exchangeDate? }` (budget is a dollar amount as typed, like `"25.50"`; the date is `YYYY-MM-DD`; the saved details are used on a resend), or `{ id, key, turnstileToken, retryFailed: true }` to resend only to people whose email failed. Also emails the organizer their organizer link on the first send, or only that when no participant has an email (the draw then stays unsent). Returns `{ success, totalSent, totalFailed, failedNames, organizerLinkSent }`. `400` bad input (including an organizer name over 200 characters or containing HTML or a web address, or an email over 320; a note over 150 characters or containing HTML or a web address; a budget that isn't a dollar amount of $10,000 or less; a date that isn't a real day), `403` wrong key or failed CAPTCHA (including when Cloudflare can't be reached), `404` unknown or malformed id, `409` already sent (or nothing to resend), `410` deleted, `503` cap of 495 emails in 24 hours reached. |
| `POST` | `/api/delete-draw` | *Admin key required. Rate limited (10/h).* Body `{ id, key }`. Soft-delete a draw. Idempotent. `403` wrong key, `404` unknown or malformed id. |
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
