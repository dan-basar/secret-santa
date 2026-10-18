# Operations

Runbook for the running app. How it works is in [ARCHITECTURE.md](ARCHITECTURE.md); setup is in the [README](../README.md).

There are two Neon databases (branches of one Neon project): **`dev`**, used by local development, and **production**, used only by Vercel. Anything you try goes to `dev` first.

## Applying a migration

Migrations live in [`sql/migrations/`](../sql/migrations). Each `NNN_name.sql` has a read-only `NNN_name_check.sql` that says at the top what result to expect. `sql/setup.sql` already includes every migration, so a brand-new database never needs them.

1. **Neon dev branch first.** In the Neon console, open the SQL Editor on the `dev` branch and run the migration. Then run its `_check.sql` and compare with the expected result in its header.
2. **Try the app against dev.** `npm run dev` with `.env.local` pointing at the dev branch; exercise whatever the migration supports.
3. **Production.** In the Neon console, switch the SQL Editor to the production branch, run the same migration, then its `_check.sql`.
4. **Deploy the code** that needs the change (merge the PR) only after production has the migration, so new code never meets an old schema.

Migrations that change more than one thing are wrapped in `BEGIN; ... COMMIT;`, so a failure leaves the database unchanged. Don't run a migration twice: most `ALTER TABLE ... ADD` statements fail on the second run, which is harmless but noisy.

## Environment variables

| Where | Used by | Holds |
|---|---|---|
| Vercel → Project Settings → Environment Variables | Production (and preview) deployments | All variables, including the production `DATABASE_URL` set by the Neon integration |
| `.env.local` (not committed) | `npm run dev` / `npm run build` locally | All variables; `DATABASE_URL` must point at the Neon **dev** branch |
| `.env.development.local` (not committed) | `npm run dev` only | Cloudflare's always-pass Turnstile test keys, because the real keys reject `localhost` |

The full list, with what each one does, is in [`.env.example`](../.env.example), the template for `.env.local` (setup is in the [README](../README.md#environment-variables)). `vercel env pull .env.local` copies the Vercel values down, **including the production `DATABASE_URL`**: switch it back to the dev branch straight away. The production connection string should never be used locally.

Variables are read when a deployment is built or a function starts, so **changing one in Vercel has no effect until you redeploy** (Deployments → latest production deployment → ⋯ → Redeploy).

## Rotating secrets

**Gmail app password** (`GMAIL_APP_PASSWORD`)
1. In the Google account for `GMAIL_USER`: Security → App passwords → create a new one.
2. In Vercel, replace `GMAIL_APP_PASSWORD` for Production (and Preview if set), then redeploy.
3. Check that an email goes out (send for a test draw of your own on the new deployment), then revoke the old app password in Google.
4. Update your local `.env.local` too.

**Turnstile keys** (`NEXT_PUBLIC_TURNSTILE_SITE_KEY`, `TURNSTILE_SECRET_KEY`)
1. In the Cloudflare dashboard → Turnstile → the site widget, rotate the secret key (or create a new widget for a new pair).
2. Update both variables in Vercel and redeploy. The site key is built into the page (`NEXT_PUBLIC_`), so a redeploy is required for it as well.
3. Open a draw's organizer link and check the CAPTCHA widget renders and a send works.

Never put real keys in `.env.development.local`; it keeps the test keys.

**Rate-limit hash secret** (`RATE_LIMIT_HASH_SECRET`)
1. Generate a new random value (`openssl rand -hex 32`), replace it in Vercel and redeploy.
2. Every bucket gets a new hash, so current hourly counts start again from zero; the old rows are deleted after 2 days as usual. Rotating it also resets each IP's 24-hour email budget. If the variable is missing, rate limiting and the email budget are skipped (they fail open and log an error), so set it before deploying.

## Edge rate limit (Vercel Firewall)

`src/proxy.ts` limits each route per IP per hour, but it runs as a Vercel function and asks Neon on every request, including the ones it refuses. A flood of requests would still keep Neon awake and spend function invocations. A Vercel Firewall rule refuses floods at the edge first, before any function or database runs. It lives in the Vercel dashboard, not in this repo, so a new project or a lost setting needs these steps again.

1. Vercel dashboard → **baseworkshop-home** (the project that owns `www.baseworkshop.app` and passes `/secret-santa` on to this app; this app's own project only has its `.vercel.app` address) → **Firewall** → **Configure** → **New Rule**.
2. Name it `API flood backstop`. **If** *Request Path* *Starts with* `/secret-santa/api/`.
3. **Then** *Rate Limit*: *Fixed Window*, **60 seconds**, **60 requests**, keyed on **IP**, action **Too Many Requests (429)**.
4. **Save Rule**, then **Review Changes** → **Publish**.

60 a minute per IP is far above anything a real organizer or household sends (each page makes one or two API calls), and well below a flood. The Hobby plan allows one rate-limit rule per project, fixed window only (10 seconds to 10 minutes), and 1,000,000 allowed requests a month; requests the rule refuses aren't billed as function invocations. The edge `429` doesn't carry the app's `{ error }` JSON, which the pages already handle: the organizer and personal link pages show their "busy" message for any `429`, and the other calls fall back to their generic error. To check it, Firewall → **Overview** shows the rule's matches and rate-limited requests.

## When Gmail stops sending

Symptoms: `send-emails` reports failures (`failedNames`), or `503` "The site's email limit is reached for now".

- **Our daily cap.** `send-emails` refuses a send that would take the last 24 hours past **495** (`DAILY_EMAIL_LIMIT`), counted per hour in `EmailSendLog`. A send reserves a count for everyone it claimed, in the same transaction as the claims, before emailing anyone, and gives back the emails that failed; a request that died mid-send keeps its reservation, so the count can run a little high. The count the cap sees right now:
  ```sql
  SELECT
       COALESCE(SUM(emailSendLog.emails_sent), 0) as emailsInLast24Hours
  FROM EmailSendLog as emailSendLog
  WHERE emailSendLog.hour_start > now() - interval '25 hours'
  ```
  There is no midnight reset: room comes back as each hour rolls out of the window.
- **One connection's budget.** A `429` "You've sent the most emails allowed from your connection for now" means that IP (or IPv6 /64) has had 100 emails in the last 24 hours (`IP_EMAIL_BUDGET`), counted in `RateLimits` like the cap above. It frees up as each hour rolls out; to let one organizer past it, add their IP to `RATE_LIMIT_IP_WHITELIST` and redeploy.
- **Gmail itself blocked or throttled the account** (sending limits, suspicious-activity lock, revoked app password). Check the Gmail account's inbox for a notice and the Vercel function logs for the SMTP error. A revoked or changed password needs the rotation steps above.

The daily job emails "needs a look" when people on a sent draw were left unemailed for over an hour, or when the 24-hour count is above 80% of the cap.

Meanwhile nobody is stuck: organizers can copy each person's **personal link** from their organizer page and send it by text or chat. Failed emails are released (and anyone left claimed by a send that timed out is released after 5 minutes), so once Gmail works again the organizer can press **Resend** to reach just the people who were missed.

## Alerts

Alerts go to the owner's email; nothing pushes to a phone. What can alert, and what to do:

| Alert | From | Means | Go to |
|---|---|---|---|
| Uptime monitor down | Sentry | The site or its functions aren't answering `/api/health` | [Site is down](#site-is-down) |
| New error issue | Sentry | A route hit an unexpected error (the issue shows the stack trace, never a link or name) | [Errors in Sentry](#errors-in-sentry) |
| Cron monitor missed or failed | Sentry | The daily job didn't run, or ran and failed | [The daily job went quiet](#the-daily-job-went-quiet) |
| "Secret Santa: needs a look" | Daily job, by email | People on sent draws were never emailed, or the 24-hour email count is near the cap | [When Gmail stops sending](#when-gmail-stops-sending) |
| "A send of N emails took Ns" | Sentry warning | A send ran close to the 60-second function limit (alerts above 50 seconds) | [Slow sends](#slow-sends) |
| Neon or Vercel usage notices | Neon, Vercel | Plan limits or billing | The Neon and Vercel notification settings |
| "Secret Santa: weekly stats" | Weekly job, by email | Not an alert: draws, participants, emails and first link opens for the last 7 days | |

Alert rules live in Sentry (Alerts → Create Alert → email the owner); the uptime and cron monitors are under Insights → Crons and Uptime. The cron monitor is created by the first daily run.

### Site is down

1. Open the site and `/secret-santa/api/health`. If the second answers `{ "ok": true }` but the pages don't, check the latest deployment in Vercel.
2. Check [Vercel's status page](https://www.vercel-status.com/) and the project: Hobby projects are **paused** when they pass a usage limit (Vercel emails first). Unpause or wait for the period to reset.
3. If it started right after a deploy, [roll back](#rolling-back-a-bad-deploy).

Meanwhile, nobody loses a match: organizers keep their organizer link, and anyone with a personal link can use it as soon as the site is back.

### Errors in Sentry

A new issue is a route's `catch`. The title and stack say where. If it's `Database error`/Neon-related, look at Neon's status page and the project in the Neon console (a cold start takes a moment, but anything longer is real; the project is on Neon's Launch plan, billed by use, so it isn't cut off at a monthly allowance), then the Vercel function logs. Organizers see "Database error. Please try again." and can simply retry.

### The daily job went quiet

1. Vercel dashboard → the project → **Cron Jobs**: is `/secret-santa/api/ops-check` listed, and what did its last run return? A `403` means `CRON_SECRET` differs from Vercel's value (the cron sends it automatically; redeploy after changing it); `500` shows in the function logs.
2. Run it by hand (nothing is lost; it overwrites the day's row): `curl -H "Authorization: Bearer $CRON_SECRET" https://<site>/secret-santa/api/ops-check`.
3. A day with no row in `DailyStats` is only a gap in the stats.

### Slow sends

A 50-person draw takes about 45 seconds through Gmail against a 60-second limit. If a send alerts, check Gmail/SMTP latency in the function logs. A send that's killed mid-way leaves the people not yet emailed marked "not sent" after 5 minutes, and the organizer presses **Resend**.

## Rolling back a bad deploy

Vercel keeps every deployment. In the Vercel dashboard → Deployments, pick the last good production deployment and use **Instant Rollback** (or ⋯ → **Promote to Production**). This swaps traffic in seconds without a rebuild. Then fix forward with a new PR; the next merge to `main` deploys normally.

A rollback does not touch the database. If the bad deploy came with a migration, the older code must still work with the newer schema (migrations here add columns or tables, or drop ones no deployed code has used since an earlier migration, so it does).

## Health check

```
GET <site>/secret-santa/api/health
```

It answers `200 { "ok": true }` to any method whenever the site's functions run, and isn't rate limited. It never touches the database, so the uptime monitor can poll it without keeping Neon's compute awake (a `?shallow=1` left on the monitor's address from before is ignored). To check the database itself, run a query in the Neon console's SQL Editor, or [run the daily job by hand](#the-daily-job-went-quiet).

## Holiday change freeze

Every year, from **3am Eastern on the Tuesday before US Thanksgiving until 3am Eastern on 2 January**, nothing ships to production unless the owner approves it, so organizers aren't hit by a risky change in the busiest weeks. The Tuesday falls between 20 and 26 November (Thanksgiving is the fourth Thursday); both edges are 08:00 UTC, since Eastern is on standard time throughout. Land features and dependency majors before the freeze starts or after it ends.

CI enforces it: during the freeze the **Holiday change freeze** step of the `check` job fails every pull request, so none can merge (the ruleset requires `check`). To let an approved fix through, add the **`freeze-exception`** label to its PR; that re-runs CI and the step passes. Create the label once under the repository's Issues → Labels if it doesn't exist yet. The dates come from `scripts/freeze.ts` (tested in `tests/freeze.test.ts`); `npx tsx scripts/check-freeze.ts` prints whether a freeze is on and when the next one starts.

Two gaps to know about: a PR whose CI went green before the freeze started keeps its green check, so don't merge older PRs during the freeze without re-running CI; and a manual redeploy or promotion in the Vercel dashboard bypasses CI entirely. Dependabot keeps opening PRs during the freeze; they fail the step and wait until January.

## Dependency updates

Dependabot (`.github/dependabot.yml`) opens pull requests weekly: one grouped PR for npm minor and patch updates, separate PRs for npm major updates (except `@types/node`, which stays on Node 24, and React and its types, whose move to 19 is a deliberate migration), and PRs for the GitHub Actions used by CI (which are pinned to commit SHAs, with the version in a comment). Each runs CI like any other PR; read the changelog for majors, then squash-merge. Closing a Dependabot PR without merging tells it to skip that version.

## PDF font

The organizer's PDF of the matches uses Noto Sans (SIL Open Font License, `public/fonts/OFL.txt`) so Croatian, Cyrillic and Greek names print as typed. The three files in `public/fonts/` are Noto Sans Regular, Bold and Italic cut down to Latin, Greek and Cyrillic with fontTools (`pip install fonttools`):

```bash
pyftsubset NotoSans-Regular.ttf --unicodes="U+0020-007E,U+00A0-024F,U+0300-036F,U+0370-03FF,U+0400-052F,U+1E00-1EFF,U+2000-206F,U+20A0-20CF,U+2122" \
  --layout-features='kern' --no-hinting --output-file=public/fonts/noto-sans-pdf-regular.ttf
```

and the same for Bold and Italic (`noto-sans-pdf-bold.ttf`, `noto-sans-pdf-italic.ttf`). If the ranges change, change `NOTO_RANGES` in `src/lib/match-pdf.ts` to match. Letters outside them (Chinese, Arabic and so on) print as "?" in the PDF; Print and the CSV show everything. If the font can't be fetched, the PDF falls back to Helvetica, which covers only Western European letters.
