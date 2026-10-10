# CLAUDE.md

This file provides guidance for AI assistants working in this codebase.

## Project Overview

A full-stack Secret Santa draw application built with Next.js and TypeScript, backed by Neon Postgres. Users create draws by defining participant groups, the app generates conflict-free matches, and sends email notifications via Gmail SMTP.

Deployed on Vercel at the `/secret-santa` path prefix.

## Tech Stack

- **Framework**: Next.js (pages router, React 18, TypeScript 5)
- **Database**: Neon Postgres via `@neondatabase/serverless` (HTTP driver, no connection pool)
- **Email**: Nodemailer with Gmail SMTP
- **Deployment**: Vercel (region: `cle1`, timeout: 10s per function)
- **Hosting path**: All routes are under `/secret-santa` (set via `next.config.js` `basePath`)

## Repository Structure

```
src/
  lib/
    db.ts           # Neon serverless SQL client
    matching.ts     # Secret Santa matching algorithm with constraint validation
    email.ts        # Nodemailer email service
  pages/
    api/
      create-draw.ts   # POST: create draw + participants + matches in a transaction
      get-draw.ts      # GET: retrieve draw; matches + reveal tokens for admins only
      reveal.ts        # GET: one participant's own match, by reveal token
      send-emails.ts   # POST: send match emails (idempotent)
      delete-draw.ts   # POST: soft-delete a draw
      health.ts        # GET: DB health check
    _app.tsx           # App wrapper
    index.tsx          # Home page — draw creation form
    draw/[id].tsx      # Draw results page
    reveal/[token].tsx # Participant's private tap-to-reveal page
  proxy.ts             # Per-IP hourly rate limits for create-draw, send-emails, delete-draw (RateLimits table)
  styles/
    globals.css        # Design tokens (CSS custom properties), resets
    Home.module.css
    Draw.module.css
    Reveal.module.css
sql/
  setup.sql            # Database schema (Draws, Participants, Matches, DailyEmailLog, RateLimits tables)
  migrations/          # One-off schema changes for existing databases (run manually)
scripts/
  copy-azure-to-neon.ts  # One-off Azure SQL -> Neon data copy (run manually)
next.config.js
vercel.json
tsconfig.json
```

## Development Commands

```bash
npm run dev      # Start dev server on http://localhost:3000/secret-santa
npm run build    # Production build
npm run start    # Serve production build
npm run typecheck  # tsc --noEmit
npm test         # Vitest unit tests (tests/)
```

**Always prefix `npm run dev` with the appropriate `cd` command:**

```bash
cd /home/user/secret-santa-app && npm run dev
```

Unit tests use Vitest and live in `tests/` (never under `src/pages/`, where Next.js would treat them as routes). CI (`.github/workflows/ci.yml`) runs typecheck, tests and build on every PR. There is no linter configured beyond TypeScript strict mode.

## Environment Variables

All required — no defaults. Store in `.env.local` locally.

**Local `DATABASE_URL` points at the Neon `dev` branch, never production.** The production connection string lives only in Vercel; never run queries, scripts or the dev server against it. `.env.development.local` holds Cloudflare's always-pass Turnstile test keys so emails can be sent from `npm run dev` (the real keys reject `localhost`). Only send email for draws you create, to addresses you were given.

| Variable             | Purpose                           |
|----------------------|-----------------------------------|
| `DATABASE_URL`       | Neon Postgres connection string (set by the Neon integration on Vercel; `vercel env pull .env.local` locally) |
| `GMAIL_USER`         | Gmail address for outbound email  |
| `GMAIL_APP_PASSWORD` | Gmail app-specific password       |
| `NEXT_PUBLIC_BASE_URL` | Site origin for reveal links in emails, without the `/secret-santa` basePath |

## Database Schema

Tables (see `sql/setup.sql`):

- **Draws** — one row per draw session; `id` is a `uuid`; soft-delete via `deleted_at`
- **Participants** — name, optional email, optional group, `position` (1..n order within the draw); FK to `draw_id`
- **Matches** — giver/receiver pairs; FKs to both `draw_id` and `Participants`
- **DailyEmailLog** — one row per UTC date counting emails sent (daily cap)
- **RateLimits** — one hit counter per SHA-256-hashed IP + route per hour, shared by every Vercel instance; `src/proxy.ts` upserts it and fails open if the query errors

### Conventions
- Column names: `snake_case`
- Public IDs: `uuid`
- Internal join keys: `integer GENERATED ALWAYS AS IDENTITY`
- Soft deletes only — never hard-delete rows. The one exception is `RateLimits`: its rows are counters, not people's data, so `src/proxy.ts` deletes rows older than 2 days on about 1 in 100 limited requests
- Always use parameterized queries: the `sql` tagged template sends `${...}` values as bind parameters; never build SQL text with string concatenation
- Multi-step writes use `sql.transaction([...])`, which runs all statements in one transaction and rolls back on error

## API Conventions

All endpoints live under `/api/`:

| Method | Path            | Notes                                          |
|--------|-----------------|------------------------------------------------|
| POST   | `/api/create-draw`  | Validates 2–50 participants before DB write    |
| GET    | `/api/get-draw`     | `?id=UUID`; names only unless `key` is the admin key; 410 for deleted draws |
| GET    | `/api/reveal`       | `?token=UUID`; one participant's own match; 404 unknown, 410 deleted |
| POST   | `/api/send-emails`  | Idempotent — rejects if already sent (409)     |
| POST   | `/api/delete-draw`  | Idempotent soft-delete                         |
| GET    | `/api/health`       | Returns 503 if DB unreachable                  |

Error responses always use `{ error: string }` JSON. Use appropriate HTTP status codes: 400 (bad input), 404 (not found), 409 (conflict), 410 (deleted), 422 (unprocessable), 500 (server error).

## Matching Algorithm (`src/lib/matching.ts`)

Core business logic — handle carefully:

1. **Constraint**: participants in the same `group_name` cannot be matched together; group names are compared trimmed and case-insensitively (`normalizeGroup()`)
2. **Validation**: if any single group contains >50% of participants, matching is mathematically impossible — reject early
3. **Phase 1**: uniform Fisher-Yates shuffle with up to 1000 attempts
4. **Phase 2**: randomized assignment with a Hall's-condition feasibility check if Phase 1 fails; never dead-ends, so large-group draws stay fast
5. No self-matches, no same-group matches; participants are compared by position, so duplicate names are fine

## Database Connection (`src/lib/db.ts`)

- Exports a single `sql` client from `neon(process.env.DATABASE_URL!)`; each query is one HTTPS request
- No pool, retry wrapper or warm-up: there is no long-lived connection to go stale
- `isUuid()` guards route inputs, because Postgres raises an error on malformed uuid strings

## Frontend Conventions

- **State management**: local React hooks only (`useState`, `useEffect`, `useCallback`, `useRef`) — no Redux or Context
- **Styling**: CSS Modules per page + `globals.css` for design tokens
- **Design tokens**: defined as CSS custom properties on `:root` in `globals.css` (e.g., `--ink`, `--accent`, `--success`, `--error`)
- **Typography**: Libre Baskerville (headings) + DM Sans (body)
- **Forms**: client-side validation before API calls; errors displayed inline
- **Session storage**: used to pass participant data back to the home page for "edit and redraw" flow
- Participants limit: 50 max; groups limit: 20 max

## Code Style

- TypeScript strict mode — no `any` unless truly unavoidable
- Use `@/lib/...` and `@/styles/...` path aliases (configured in `tsconfig.json`)
- Keep API routes focused: validate input → query DB → return response
- No unnecessary abstractions — three similar lines is fine; don't extract prematurely
- Do not add error handling for impossible scenarios; trust Next.js and Neon driver guarantees at internal boundaries

## Branch Strategy

- `main` — production branch; only merged via pull requests
- Feature branches: descriptive kebab-case names (e.g., `titan/add-feature-XYZ`)
- **AI-created branches must be prefixed with `titan/`**, not `claude/` (e.g., `titan/add-feature-XYZ`)
- Current development branch for Claude agents: see task instructions

## Deployment Notes

- `vercel.json` sets function max duration to 10s and deploys to region `cle1`
- `next.config.js` `basePath: '/secret-santa'` affects all internal Next.js links and API calls — do not remove this
- `DATABASE_URL` comes from the Neon integration on the Vercel project (Free plan, AWS US East 2)
