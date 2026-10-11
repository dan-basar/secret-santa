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
npm test           # Vitest unit tests (tests/)
```

**Always prefix `npm run dev` with the appropriate `cd` command:**

```bash
cd /home/user/secret-santa && npm run dev
```

Unit tests use Vitest and live in `tests/` (never under `src/pages/`, where Next.js would treat them as routes). CI (`.github/workflows/ci.yml`) runs typecheck, tests and build on every PR. There is no linter configured beyond TypeScript strict mode.

## Environment and Data Safety

- **Local `DATABASE_URL` points at the Neon `dev` branch, never production.** The production connection string lives only in Vercel; never run queries, scripts or the dev server against it. `vercel env pull` writes the production value, so switch it back to dev immediately.
- `.env.development.local` holds Cloudflare's always-pass Turnstile test keys so emails can be sent from `npm run dev` (the real keys reject `localhost`). Never put real keys there.
- **Only send email for draws you create, to addresses you were given.**
- Schema changes go in a new `sql/migrations/NNN_name.sql` with a read-only `NNN_name_check.sql`, and are folded into `sql/setup.sql`. Never apply them to production yourself; the runbook is in docs/OPERATIONS.md.
- All env vars are required except `RATE_LIMIT_IP_WHITELIST`; there are no defaults. The list is in the README.

## Conventions

### Database
- Column names: `snake_case`
- Public IDs: `uuid`; `isUuid()` (`src/lib/db.ts`) guards route inputs, because Postgres raises an error on malformed uuid strings
- Internal join keys: `integer GENERATED ALWAYS AS IDENTITY`
- Soft deletes only — never hard-delete rows. The one exception is `RateLimits`: its rows are counters, not people's data, so `src/proxy.ts` deletes rows older than 2 days on about 1 in 100 limited requests
- Always use parameterized queries: the `sql` tagged template sends `${...}` values as bind parameters; never build SQL text with string concatenation
- Multi-step writes use `sql.transaction([...])`, which runs all statements in one transaction and rolls back on error
- `src/lib/db.ts` exports a single `sql` client from `neon(process.env.DATABASE_URL!)`; each query is one HTTPS request. No pool, retry wrapper or warm-up
- The driver returns rows untyped. Each route declares a small row interface for what its query selects and casts once at the query (`as DrawRow[]`). `timestamptz` columns arrive as `Date`, so routes call `.toISOString()` when putting them in a response

### API
- Keep routes focused: validate input → query DB → return response. Each route file starts with a short comment giving its contract; keep it current
- Error responses always use `{ error: string }` JSON, with status codes 400 (bad input), 403 (wrong admin key), 404 (not found), 409 (conflict), 410 (deleted), 422 (unprocessable), 429 (rate limited, from `src/proxy.ts`), 500 (server error)
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
- **Typography**: Libre Baskerville (headings) + DM Sans (body)
- **Forms**: client-side validation before API calls; errors displayed inline
- **Groups on the home page** are referenced by a stable id (`src/lib/groups.ts`), never by name, so renaming a group keeps its members
- **Session storage**: key `editDraftData` passes the form state from the draw page back to the home page for "Edit & Redraw"
- Participants limit: 50 max; groups limit: 20 max

## Matching Algorithm (`src/lib/matching.ts`)

Core business logic — handle carefully:

1. **Constraint**: participants in the same `group_name` cannot be matched together; group names are compared trimmed and case-insensitively (`normalizeGroup()`)
2. **Validation**: if any single group contains >50% of participants, matching is mathematically impossible — reject early
3. **Phase 1**: uniform Fisher-Yates shuffle with up to 1000 attempts
4. **Phase 2**: `assignWithFeasibilityCheck()`, a randomized assignment with a Hall's-condition feasibility check if Phase 1 fails; never dead-ends, so large-group draws stay fast
5. No self-matches, no same-group matches; participants are compared by position, so duplicate names are fine

## Branch Strategy

- `main` — production branch; only merged via pull requests
- Feature branches: descriptive kebab-case names (e.g., `titan/add-feature-XYZ`)
- **AI-created branches must be prefixed with `titan/`**, not `claude/` (e.g., `titan/add-feature-XYZ`)
- Current development branch for Claude agents: see task instructions

## Deployment Cautions

- `next.config.js` `basePath: '/secret-santa'` affects all internal Next.js links and API calls — do not remove this. Public URLs outside Next.js routing (emails, meta tags) go through `siteUrl()` in `src/lib/site.ts`
- `vercel.json` has one entry per API route file, setting max duration to 10s (60s for send-emails, so a 50-person draw has time to send) and region `cle1`. It is the only place timeouts are set (no `export const config` in routes). A new route needs its own entry and must stay inside 10s; `tests/vercel-config.test.ts` checks every route has exactly one
