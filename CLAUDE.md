# CLAUDE.md

This file provides guidance for AI assistants working in this codebase.

## Project Overview

A Secret Santa draw app: Next.js (pages router, TypeScript) on Vercel, Neon Postgres, Gmail SMTP for emails, Cloudflare Turnstile on sends. Organizers create a draw with optional groups, the app generates conflict-free matches, and each person sees their own match by email or personal link. Everything is served under the `/secret-santa` path prefix.

How the app works lives in one place; read it there rather than duplicating it here:
- [README.md](README.md) — features, setup, environment variables, project structure, API reference
- [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) — which secret unlocks what, draw lifecycle, request path, tables, data kept
- [docs/OPERATIONS.md](docs/OPERATIONS.md) — migrations, env vars, key rotation, Gmail trouble, rollback, health check

When you change behavior those documents describe (routes, status codes, schema, limits), update them in the same change.

## Development Commands

```bash
npm run dev        # Start dev server on http://localhost:3000/secret-santa
npm run build      # Production build
npm run start      # Serve production build
npm run typecheck  # tsc --noEmit
npm test           # Vitest tests (tests/)
```

**Always prefix `npm run dev` with the appropriate `cd` command:**

```bash
cd /home/user/secret-santa && npm run dev
```

Tests use Vitest and live in `tests/` (never under `src/pages/`, where Next.js would treat them as routes). Page tests (`tests/home.test.tsx`) use React Testing Library and start with `// @vitest-environment jsdom`. CI (`.github/workflows/ci.yml`) runs the tests and the build (which type-checks every file, tests included) on every PR, and fails PRs during the yearly holiday change freeze (3am ET on the Tuesday before Thanksgiving to 3am ET on 2 January) unless they carry the `freeze-exception` label; see docs/OPERATIONS.md. Route tests call handlers through `callRoute()` (`tests/helpers/fake-res.ts`) and mostly answer queries with canned rows; `tests/real-sql.test.ts` runs the routes' real SQL against `sql/setup.sql` in PGlite, an in-memory Postgres (`tests/helpers/pglite-sql.ts`), so a schema or query change should keep it passing. There is no linter configured beyond TypeScript strict mode.

## Environment and Data Safety

- **Local `DATABASE_URL` points at the Neon `dev` branch, never production.** The production connection string lives only in Vercel; never run queries, scripts or the dev server against it. `vercel env pull` writes the production value, so switch it back to dev immediately.
- `.env.development.local` holds Cloudflare's always-pass Turnstile test keys so emails can be sent from `npm run dev` (the real keys reject `localhost`). Never put real keys there.
- **Only send email for draws you create, to addresses you were given.**
- Schema changes go in a new `sql/migrations/NNN_name.sql` with a read-only `NNN_name_check.sql`, and are folded into `sql/setup.sql`. Never apply them to production yourself; the runbook is in docs/OPERATIONS.md.
- `.env.example` lists every env var and says which are optional; there are no defaults, so don't add any.

## Conventions

### Database
- Column names: `snake_case`
- Draw ids: `uuid`, internal only. Routes find a draw by its admin key alone (`WHERE admin_key = ${key}`; the column is `UNIQUE`), never by an id from the request, and no response carries the id
- Link secrets: the organizer's admin key (14 characters) and each personal link's reveal code (8) are random letters and digits from `src/lib/tokens.ts`, which also has the shape checks the routes and pages use (and `isCutShort()` to spot a link cut short)
- Internal join keys: `integer GENERATED ALWAYS AS IDENTITY`
- Soft deletes only — never hard-delete rows. The one exception is `RateLimits`: its rows are counters, not people's data, so `src/proxy.ts` deletes rows older than 2 days
- Always use parameterized queries: the `sql` tagged template sends `${...}` values as bind parameters; never build SQL text with string concatenation
- Multi-step writes use `sql.transaction([...])`, which runs all statements in one transaction and rolls back on error
- A write that needs the draw in a certain state (not deleted, not yet emailed) puts that in the `UPDATE`'s `WHERE` and looks up why only when it matched nothing, so the usual case is one round trip
- `src/lib/db.ts` exports a single `sql` client from `neon(process.env.DATABASE_URL!)`; each query is one HTTPS request. No pool, retry wrapper or warm-up
- The driver returns rows untyped. Each route declares a small row interface for what its query selects and casts once at the query (`as DrawRow[]`). `timestamptz` columns arrive as `Date`, so routes call `.toISOString()` when putting them in a response

### API
- Keep routes focused: validate input → query DB → return response. Each route file starts with a short comment giving its contract; keep it current
- Error responses always use `{ error: string }` JSON, with status codes 400 (bad input), 403 (wrong admin key), 404 (not found), 405 (wrong method, with an `Allow` header), 409 (conflict), 410 (deleted), 422 (unprocessable), 429 (rate limited, from `src/proxy.ts`, or over its IP's email budget, from send-emails), 500 (server error)
- Anything that reveals matches, emails or reveal tokens, or changes a draw, requires the draw's admin key
- Response shapes live in `src/types/api.ts`: routes type their `res` with them (`NextApiResponse<RevealResponse | ApiError>`) and pages import the same types, so a shape is written once

### Code Style
- TypeScript strict mode — no `any` unless truly unavoidable
- Use `@/lib/...`, `@/types/...`, `@/components/...` and `@/styles/...` path aliases (configured in `tsconfig.json`)
- No unnecessary abstractions — three similar lines is fine; don't extract prematurely
- Do not add error handling for impossible scenarios; trust Next.js and Neon driver guarantees at internal boundaries

### Frontend
- **State management**: local React hooks only (`useState`, `useEffect`, `useCallback`, `useRef`) — no Redux or Context
- **Components**: a page's sections live in `src/components/<page>/`, one per file (e.g. `src/components/draw/`). Fetching, effects and shared state stay in the page and go down as props and callbacks; a component keeps only its own UI state (a "Copied" flash, a confirm step) and uses its page's CSS module
- **Styling**: CSS Modules per page + `globals.css` for design tokens (CSS custom properties on `:root`, e.g. `--ink`, `--accent`, `--success`, `--error`)
- **Typography**: Libre Baskerville (headings) + DM Sans (body), loaded with `next/font/google` in `_app.tsx` (downloaded at build time and served from this site), feeding `--font-serif` / `--font-sans`
- **Forms**: client-side validation before API calls; errors displayed inline
- **Groups on the home page** are referenced by a stable id (`src/lib/groups.ts`), never by name, so renaming a group keeps its members
- **Session storage** is the only browser storage: `editDraftData` carries the form from the draw page to the home page for Edit & Redraw; `homeFormDraft` holds the home form as it is typed, removed once a draw is created or the form is cleared; `drawEmailDraft` (`src/lib/email-draft.ts`) holds the draw page's email card until the first send succeeds, and belongs to one draw by admin key (Edit & Redraw hands it to the replacement draw). Saved details win over a draft's on load
- Limits live in one place each: participants (50) and groups (20) in `src/lib/groups.ts`, shared by the home form and create-draw; the email cap, per-IP budget and claim expiry in `src/lib/limits.ts`. Never hard-code them

## Matching Algorithm (`src/lib/matching.ts`)

Core business logic — handle carefully. How it works is in docs/ARCHITECTURE.md (Matching); these must stay true:

1. No self-matches and no same-group matches; group names are compared with `normalizeGroup()` (trimmed, case-insensitive)
2. A draw where one group holds more than half the participants is rejected before matching
3. Phase 1 is a uniform Fisher-Yates shuffle (up to 1000 attempts); Phase 2, `assignWithFeasibilityCheck()` (Hall's condition), never dead-ends, so large-group draws stay fast
4. Participants are compared by position, never by name; names must still differ ignoring case and spaces (`src/lib/names.ts`), so each person can tell who they drew

## Branch Strategy

- `main` — production branch; it changes only through pull requests, merged with **Squash and merge**
- Work on a short-lived feature branch with a descriptive kebab-case name (e.g. `feature/add-xyz`)
- Current development branch for Claude agents: see task instructions

## Deployment Cautions

- `next.config.js` `basePath` (`/secret-santa`) affects all internal Next.js links and API calls — do not remove this. Its one definition is `src/lib/base-path.json`, read by `next.config.js` and by `BASE_PATH` in `src/lib/site.ts` (used by `src/proxy.ts`); pages use `router.basePath`. Never hard-code the prefix. Public URLs outside Next.js routing (emails, meta tags) go through `siteUrl()`
- `vercel.json` has one entry per API route file, setting max duration to 10s (60s for send-emails, so a 50-person draw has time to send) and region `cle1`. It is the only place timeouts are set (no `export const config` in routes). A new route needs its own entry and must stay inside 10s; `tests/vercel-config.test.ts` checks every route has exactly one
