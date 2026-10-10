# Secret Santa Picker

A full-stack web application for running Secret Santa gift exchanges. Create a draw, assign participants to groups to prevent unwanted pairings, share a results link, and optionally send everyone an email revealing their match.

Built with **Next.js**, **TypeScript**, and **Neon Postgres**, deployed on **Vercel**.

---

## Features

- **Conflict-free matching** — participants in the same group (e.g. families, teams) are never paired together
- **Up to 50 participants** across up to 20 groups per draw
- **Private reveal links** — each participant gets a personal link that shows only who they drew, behind a tap-to-reveal
- **Shareable link** — public view lists participant names only; pairings stay private
- **Email notifications** — one-click emails to all participants, protected by Cloudflare Turnstile CAPTCHA
- **Admin access** — the creator gets a private link to view emails, delete the draw, or edit and redraw
- **Soft-delete** — draws are hidden, not destroyed

---

## Tech Stack

| Layer | Technology |
|---|---|
| Framework | Next.js (pages router), React 18, TypeScript 5 |
| Database | Neon Postgres via `@neondatabase/serverless` (HTTP driver) |
| Email | Nodemailer + Gmail SMTP |
| CAPTCHA | Cloudflare Turnstile |
| Deployment | Vercel |

---

## Getting Started

### Prerequisites

- Node.js LTS and npm
- A [Neon](https://neon.tech) Postgres database (on Vercel, connect it through the Neon integration so `DATABASE_URL` is set for you)
- A Gmail account with an [app-specific password](https://support.google.com/accounts/answer/185833)
- A [Cloudflare Turnstile](https://www.cloudflare.com/products/turnstile/) site/secret key pair

### Environment Variables

Create a `.env.local` file in the project root (or run `vercel env pull .env.local` to fetch the values from the linked Vercel project):

```dotenv
DATABASE_URL=postgresql://user:password@your-endpoint.neon.tech/neondb?sslmode=require

GMAIL_USER=you@gmail.com
GMAIL_APP_PASSWORD=your-16-char-app-password

# Site origin used for the reveal links in emails, without the /secret-santa basePath
NEXT_PUBLIC_BASE_URL=http://localhost:3000

NEXT_PUBLIC_TURNSTILE_SITE_KEY=your-site-key
TURNSTILE_SECRET_KEY=your-secret-key
```

**Local development never uses the production database.** Point `DATABASE_URL` in `.env.local` at the Neon `dev` branch (an empty copy of the schema, with no real participants); the production connection string lives only in Vercel. `vercel env pull` writes the production value, so swap `DATABASE_URL` back to the dev branch after running it.

The real Turnstile keys don't accept `localhost`. For `npm run dev`, put Cloudflare's [published test keys](https://developers.cloudflare.com/turnstile/troubleshooting/testing/) in `.env.development.local`, which overrides `.env.local` only in development:

```dotenv
NEXT_PUBLIC_TURNSTILE_SITE_KEY=1x00000000000000000000AA
TURNSTILE_SECRET_KEY=1x0000000000000000000000000000000AA
```

### Database Setup

Run the schema script once to create all required tables (`Draws`, `Participants`, `Matches`, `DailyEmailLog`):

```bash
psql "$DATABASE_URL" -f sql/setup.sql
```

An existing database created before reveal links needs `sql/migrations/002_reveal_tokens.sql` once; `setup.sql` already includes it.

You can also paste the script into the SQL Editor in the Neon console.

See [`sql/setup.sql`](sql/setup.sql) for the full schema.

[`scripts/copy-azure-to-neon.ts`](scripts/copy-azure-to-neon.ts) is a one-off script that copies the original Azure SQL data into Neon; see the comment at the top of the file for usage.

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
1. **Random shuffle** — up to 1,000 attempts pairing givers with a uniformly shuffled receiver list
2. **Feasibility-checked fallback** — assigns receivers one giver at a time, only taking a receiver that leaves the rest still matchable, so it never dead-ends

### Email Flow

Emails are one-shot and idempotent. The organizer provides their name and email, completes a Turnstile CAPTCHA, and triggers sends. A daily cap of 495 emails is enforced via `DailyEmailLog` to stay within Gmail SMTP limits. Once sent, re-sending is rejected with `409 Conflict`.

### Admin Access

Draw creation returns a `drawId` and a random `adminKey`. The creator is redirected to `/draw/<id>?key=<adminKey>`. Anyone with just the draw ID gets a read-only view with emails hidden; the admin key unlocks email addresses, deletion, and the edit-and-redraw flow.

---

## Project Structure

```
src/
  lib/
    db.ts             # Neon serverless SQL client
    matching.ts       # Matching algorithm (shuffle + backtracking)
    email.ts          # Nodemailer email service
    sanitize.ts       # HTML tag check and escaping for emails
  pages/
    api/
      create-draw.ts  # POST: validate, match, persist in a transaction
      get-draw.ts     # GET: fetch draw; matches and reveal links for the organizer only
      reveal.ts       # GET: one participant's own match, by reveal token
      send-emails.ts  # POST: CAPTCHA + rate-limit + idempotent send
      delete-draw.ts  # POST: soft-delete
      health.ts       # GET: DB health check
    index.tsx         # Home page — participant form
    draw/[id].tsx     # Results page — names for everyone; matches, personal links, email, admin actions for the organizer
    reveal/[token].tsx  # Participant's private tap-to-reveal page
sql/
  setup.sql           # Database schema (Postgres)
  migrations/         # One-off schema changes for existing databases
scripts/
  copy-azure-to-neon.ts  # One-off Azure SQL -> Neon data copy
```

---

## API Reference

All endpoints are under `/secret-santa/api/`. Errors always return `{ "error": "<message>" }`.

| Method | Path | Description |
|---|---|---|
| `POST` | `/api/create-draw` | Validate participants, generate matches, persist in a transaction. Returns `{ drawId, adminKey }`. |
| `GET` | `/api/get-draw?id=<uuid>[&key=<adminKey>]` | Fetch a draw. Without a valid admin key: participant names only. With it: emails, groups, reveal tokens and matches. `410` for deleted draws. |
| `GET` | `/api/reveal?token=<uuid>` | One participant's name, their match, the draw date and the organizer (once emails are sent). `404` for unknown tokens, `410` for deleted draws. |
| `POST` | `/api/send-emails` | Verify CAPTCHA, check daily limit, send match emails. Returns `409` if already sent. |
| `POST` | `/api/delete-draw` | Soft-delete a draw. Idempotent. |
| `GET` | `/api/health` | `{ ok: true }` if DB reachable; `503` otherwise. |

---

## Deployment

Import the repository into Vercel and add all environment variables under **Project Settings → Environment Variables**.

Key configuration notes:
- All routes are served under `/secret-santa` (`basePath` in `next.config.js`) — do not remove this
- `DATABASE_URL` is provided by the Neon integration on Vercel
- `vercel.json` sets a 10s function timeout and the `cle1` region for API functions

---

## Contributing

Pull requests are welcome. A few conventions to follow:

- TypeScript strict mode — avoid `any`
- Run `npm run typecheck` and `npm test` before opening a PR; CI runs both plus the build
- Always use parameterized SQL queries; never interpolate user input
- Multi-step writes must use transactions with rollback on error
- Open PRs against `main`; use descriptive kebab-case branch names
