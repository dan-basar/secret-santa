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

The full list, with what each one does, is in the [README](../README.md#environment-variables). `vercel env pull .env.local` copies the Vercel values down, **including the production `DATABASE_URL`**: switch it back to the dev branch straight away. The production connection string should never be used locally.

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

## When Gmail stops sending

Symptoms: `send-emails` reports failures (`failedNames`), or `503` "daily email limit reached".

- **Our daily cap.** `send-emails` refuses a send that would take the day's total past **495** (`DAILY_EMAIL_LIMIT`), counted per UTC day in `DailyEmailLog`. Today's count:
  ```sql
  SELECT
       dailyEmailLog.log_date as logDate
      ,dailyEmailLog.emails_sent as emailsSent
  FROM DailyEmailLog as dailyEmailLog
  WHERE dailyEmailLog.log_date = (now() AT TIME ZONE 'utc')::date
  ```
  It resets at midnight UTC.
- **Gmail itself blocked or throttled the account** (sending limits, suspicious-activity lock, revoked app password). Check the Gmail account's inbox for a notice and the Vercel function logs for the SMTP error. A revoked or changed password needs the rotation steps above.

Meanwhile nobody is stuck: organizers can copy each person's **personal link** from their organizer page and send it by text or chat. Failed emails are released (and anyone left claimed by a send that timed out is released after 5 minutes), so once Gmail works again the organizer can press **Resend** to reach just the people who were missed.

## Rolling back a bad deploy

Vercel keeps every deployment. In the Vercel dashboard → Deployments, pick the last good production deployment and use **Instant Rollback** (or ⋯ → **Promote to Production**). This swaps traffic in seconds without a rebuild. Then fix forward with a new PR; the next merge to `main` deploys normally.

A rollback does not touch the database. If the bad deploy came with a migration, the older code must still work with the newer schema (migrations here only add columns or tables, so it does).

## Health check

```
GET <site>/secret-santa/api/health
```

`200 { "ok": true }` means the function runs and Neon answered `SELECT 1`; `503 { "ok": false, "error": "Database unreachable." }` means the database is unreachable. It isn't rate limited and can be pointed at by an uptime monitor. If it fails, check Neon's status page and the project in the Neon console (a project over its Free plan limits also fails here), then the Vercel function logs.
