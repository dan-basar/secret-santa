# Secret Santa Picker

A full-stack web application for running Secret Santa gift exchanges. Create a draw, assign participants to groups to prevent unwanted pairings, share a results link, and optionally send everyone an email revealing their match.

Built with **Next.js**, **TypeScript**, and **Azure SQL**, deployed on **Vercel**.

---

## Features

- **Conflict-free matching** — participants in the same group (e.g. families, teams) are never paired together
- **Up to 50 participants** across up to 20 groups per draw
- **Shareable results link** — public view shows matches without revealing email addresses
- **Email notifications** — one-click emails to all participants, protected by Cloudflare Turnstile CAPTCHA
- **Admin access** — the creator gets a private link to view emails, delete the draw, or edit and redraw
- **Soft-delete** — draws are hidden, not destroyed

---

## Tech Stack

| Layer | Technology |
|---|---|
| Framework | Next.js (pages router), React 18, TypeScript 5 |
| Database | Azure SQL Server via `mssql` |
| Email | Nodemailer + Gmail SMTP |
| CAPTCHA | Cloudflare Turnstile |
| Deployment | Vercel |

---

## Getting Started

### Prerequisites

- Node.js LTS and npm
- An Azure SQL Server instance
- A Gmail account with an [app-specific password](https://support.google.com/accounts/answer/185833)
- A [Cloudflare Turnstile](https://www.cloudflare.com/products/turnstile/) site/secret key pair

### Environment Variables

Create a `.env.local` file in the project root:

```dotenv
AZURE_SQL_SERVER=your-server.database.windows.net
AZURE_SQL_DATABASE=your-database-name
AZURE_SQL_USER=your-db-username
AZURE_SQL_PASSWORD=your-db-password

GMAIL_USER=you@gmail.com
GMAIL_APP_PASSWORD=your-16-char-app-password

NEXT_PUBLIC_TURNSTILE_SITE_KEY=your-site-key
TURNSTILE_SECRET_KEY=your-secret-key
```

### Database Setup

Run the schema script once to create all required tables (`Draws`, `Participants`, `Matches`, `DailyEmailLog`):

```bash
sqlcmd -S <server> -d <database> -U <user> -P <password> -i sql/setup.sql
```

See [`sql/setup.sql`](sql/setup.sql) for the full schema.

### Running

```bash
npm install
npm run dev      # → http://localhost:3000/secret-santa
npm run build && npm start  # production
```

---

## How It Works

### Matching Algorithm

No participant can draw themselves or anyone in their group. Before writing to the DB, the algorithm checks feasibility: if any single group holds more than 50% of participants, a valid assignment is impossible and the draw is rejected.

Matching runs in two phases:
1. **Random shuffle** — up to 1,000 attempts pairing givers with a shuffled receiver list
2. **Backtracking fallback** — deterministic recursive search if Phase 1 fails (rare in practice)

### Email Flow

Emails are one-shot and idempotent. The organizer provides their name and email, completes a Turnstile CAPTCHA, and triggers sends. A daily cap of 495 emails is enforced via `DailyEmailLog` to stay within Gmail SMTP limits. Once sent, re-sending is rejected with `409 Conflict`.

### Admin Access

Draw creation returns a `drawId` and a random `adminKey`. The creator is redirected to `/draw/<id>?key=<adminKey>`. Anyone with just the draw ID gets a read-only view with emails hidden; the admin key unlocks email addresses, deletion, and the edit-and-redraw flow.

---

## Project Structure

```
src/
  lib/
    db.ts             # Azure SQL singleton pool with retry/backoff
    matching.ts       # Matching algorithm (shuffle + backtracking)
    email.ts          # Nodemailer email service
    sanitize.ts       # HTML stripping (XSS prevention)
  pages/
    api/
      create-draw.ts  # POST: validate, match, persist in a transaction
      get-draw.ts     # GET: fetch draw + participants + matches
      send-emails.ts  # POST: CAPTCHA + rate-limit + idempotent send
      delete-draw.ts  # POST: soft-delete
      health.ts       # GET: DB health check (Vercel cron)
      ping.ts         # GET: lightweight warm-up ping
    index.tsx         # Home page — participant form
    draw/[id].tsx     # Results page — matches, email, admin actions
sql/
  setup.sql           # Database schema
```

---

## API Reference

All endpoints are under `/secret-santa/api/`. Errors always return `{ "error": "<message>" }`.

| Method | Path | Description |
|---|---|---|
| `POST` | `/api/create-draw` | Validate participants, generate matches, persist in a transaction. Returns `{ drawId, adminKey }`. |
| `GET` | `/api/get-draw?id=<uuid>[&key=<adminKey>]` | Fetch draw, participants, and matches. `410` for deleted draws; emails included only with a valid admin key. |
| `POST` | `/api/send-emails` | Verify CAPTCHA, check daily limit, send match emails. Returns `409` if already sent. |
| `POST` | `/api/delete-draw` | Soft-delete a draw. Idempotent. |
| `GET` | `/api/health` | `{ ok: true }` if DB reachable; `503` otherwise. Called by Vercel cron daily. |
| `GET` | `/api/ping` | Lightweight connectivity check. |

---

## Deployment

Import the repository into Vercel and add all environment variables under **Project Settings → Environment Variables**.

Key configuration notes:
- All routes are served under `/secret-santa` (`basePath` in `next.config.js`) — do not remove this
- `mssql` is listed under `serverExternalPackages` in `next.config.js` — required for the driver to work in serverless functions
- `vercel.json` sets a 10s function timeout and a daily cron at 17:00 UTC to keep the Azure SQL connection warm

---

## Contributing

Pull requests are welcome. A few conventions to follow:

- TypeScript strict mode — avoid `any`
- No test runner configured — verify changes via the dev server
- Always use parameterized SQL queries; never interpolate user input
- Multi-step writes must use transactions with rollback on error
- Open PRs against `main`; use descriptive kebab-case branch names
