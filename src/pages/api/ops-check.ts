// GET /api/ops-check: the daily check job, called by Vercel Cron (vercel.json) with
// the CRON_SECRET as a bearer token. Nobody else can use it.
// Daily (00:00 UTC): writes the DailyStats row for the UTC day that just ended and
// emails OPS_ALERT_EMAIL if something needs a look (people left unemailed on sent
// draws, the 24-hour email count near the cap). Check-ins go to the Sentry cron
// monitor, so a job that doesn't run or fails raises an alert too.
// With ?report=weekly (Sundays 17:00 UTC): emails the last 7 days of stats.
// Returns 200 { ok, statDate, warnings } or { ok, reported }; 403 wrong secret;
// 405 wrong method; 500 job failed or not configured.

import { timingSafeEqual } from 'crypto';
import * as Sentry from '@sentry/nextjs';
import type { NextApiRequest, NextApiResponse } from 'next';
import { sql } from '@/lib/db';
import { sendOpsEmail } from '@/lib/email';
import { CLAIM_EXPIRY_MINUTES, DAILY_EMAIL_LIMIT } from '@/lib/limits';
import { reportError } from '@/lib/report';
import { BASE_PATH } from '@/lib/site';
import vercelConfig from '../../../vercel.json';
import type { ApiError, OpsCheckResponse } from '@/types/api';

// Warn when the last 24 hours of emails reach this share of the cap
const CAP_WARNING_SHARE = 0.8;

// People still unemailed on a sent draw get this long before they count: the
// organizer is usually pressing Resend right then
const UNSENT_GRACE_HOURS = 1;

// Hobby crons run at some point in the scheduled hour, so a check-in is on time
// for up to 65 minutes after the scheduled minute
const CHECK_IN_MARGIN_MINUTES = 65;

// The daily run's schedule, read from its cron entry so the Sentry monitor can't drift from it
const DAILY_SCHEDULE = vercelConfig.crons.find(cron => cron.path === `${BASE_PATH}/api/ops-check`)!.schedule;

interface DayRow {
  draws_created: number;
  draws_emailed: number;
  participants_created: number;
  emails_sent: number;
  links_opened: number;
}

interface NowRow {
  unsent_emails: number;
  unsent_draws: number;
  emails_last_24h: number;
  busiest_connection_requests: number;
}

interface WeekRow {
  days: number;
  draws_created: number;
  draws_emailed: number;
  participants_created: number;
  emails_sent: number;
  links_opened: number;
  total_draws: number;
  total_participants: number;
}

// One check-in when the run ends: "ok", or "error" if it throws. (The SDK's
// withMonitor also sends a "started" check-in; in production its closing
// check-in never registered, so every run ended as a timeout.)
async function withCheckIn<T>(run: () => Promise<T>): Promise<T> {
  if (!process.env.SENTRY_DSN) return run();
  const startedAt = Date.now();
  const checkIn = (status: 'ok' | 'error') => Sentry.captureCheckIn(
    { monitorSlug: 'ops-check', status, duration: (Date.now() - startedAt) / 1000 },
    { schedule: { type: 'crontab', value: DAILY_SCHEDULE }, checkinMargin: CHECK_IN_MARGIN_MINUTES, timezone: 'UTC' }
  );
  try {
    const result = await run();
    checkIn('ok');
    return result;
  } catch (err) {
    checkIn('error');
    throw err;
  } finally {
    await Sentry.flush(2000);
  }
}

function isAuthorized(header: string | undefined, secret: string): boolean {
  const expected = Buffer.from(`Bearer ${secret}`);
  const given = Buffer.from(header ?? '');
  return given.length === expected.length && timingSafeEqual(given, expected);
}

// The UTC day before today, as YYYY-MM-DD
function yesterdayUtc(): string {
  return new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

async function dailyCheck(): Promise<{ statDate: string; warnings: string[] }> {
  const statDate = yesterdayUtc();
  const dayStart = `${statDate}T00:00:00Z`;

  const [[now], [day]] = (await sql.transaction([
    sql`
      SELECT
           unsent.emails as unsent_emails
          ,unsent.draws as unsent_draws
          ,(
                SELECT COALESCE(SUM(emailSendLog.emails_sent), 0)::int
                FROM EmailSendLog as emailSendLog
                WHERE emailSendLog.hour_start > now() - interval '25 hours'
           ) as emails_last_24h
          ,(
                SELECT COALESCE(MAX(busiest.requests), 0)::int
                FROM (
                     SELECT SUM(rateLimits.hits) as requests
                     FROM RateLimits as rateLimits
                     WHERE rateLimits.window_start > now() - interval '24 hours'
                     GROUP BY rateLimits.bucket
                ) as busiest
           ) as busiest_connection_requests
      FROM (
           SELECT
                COUNT(*)::int as emails
               ,COUNT(DISTINCT draws.id)::int as draws
           FROM Participants as participants
                INNER JOIN Draws as draws ON participants.draw_id = draws.id
           WHERE draws.emails_sent_at < now() - make_interval(hours => ${UNSENT_GRACE_HOURS}::int)
                AND draws.deleted_at IS NULL
                AND participants.email IS NOT NULL
                AND participants.email_sent_at IS NULL
                AND (participants.email_claimed_at IS NULL OR participants.email_claimed_at < now() - make_interval(mins => ${CLAIM_EXPIRY_MINUTES}::int))
      ) as unsent
    `,
    sql`
      SELECT
           (SELECT COUNT(*)::int FROM Draws WHERE created_at >= ${dayStart}::timestamptz AND created_at < ${dayStart}::timestamptz + interval '1 day' AND replaced_by IS NULL) as draws_created
          ,(SELECT COUNT(*)::int FROM Draws WHERE emails_sent_at >= ${dayStart}::timestamptz AND emails_sent_at < ${dayStart}::timestamptz + interval '1 day') as draws_emailed
          ,(
                SELECT COUNT(*)::int
                FROM Participants as participants
                     INNER JOIN Draws as draws ON participants.draw_id = draws.id
                WHERE draws.created_at >= ${dayStart}::timestamptz AND draws.created_at < ${dayStart}::timestamptz + interval '1 day'
                     AND draws.replaced_by IS NULL
           ) as participants_created
          ,(SELECT COALESCE(SUM(emails_sent), 0)::int FROM EmailSendLog WHERE hour_start >= ${dayStart}::timestamptz AND hour_start < ${dayStart}::timestamptz + interval '1 day') as emails_sent
          ,(SELECT COUNT(*)::int FROM Participants WHERE revealed_at >= ${dayStart}::timestamptz AND revealed_at < ${dayStart}::timestamptz + interval '1 day') as links_opened
    `,
  ], { readOnly: true })) as [NowRow[], DayRow[]];

  await sql`
    INSERT INTO DailyStats (stat_date, draws_created, draws_emailed, participants_created, emails_sent, links_opened, unsent_emails)
    VALUES (${statDate}::date, ${day.draws_created}, ${day.draws_emailed}, ${day.participants_created}, ${day.emails_sent}, ${day.links_opened}, ${now.unsent_emails})
    ON CONFLICT (stat_date) DO UPDATE SET
         draws_created = EXCLUDED.draws_created
        ,draws_emailed = EXCLUDED.draws_emailed
        ,participants_created = EXCLUDED.participants_created
        ,emails_sent = EXCLUDED.emails_sent
        ,links_opened = EXCLUDED.links_opened
        ,unsent_emails = EXCLUDED.unsent_emails
        ,recorded_at = now()
  `;

  const warnings: string[] = [];
  if (now.unsent_emails > 0) {
    warnings.push(`${now.unsent_emails} people on ${now.unsent_draws} draws still haven't been emailed (more than ${UNSENT_GRACE_HOURS} hour after the draw was sent). Their organizers can press Resend or send personal links.`);
  }
  if (now.emails_last_24h >= DAILY_EMAIL_LIMIT * CAP_WARNING_SHARE) {
    warnings.push(`${now.emails_last_24h} emails were counted in the last 24 hours, against a cap of ${DAILY_EMAIL_LIMIT}.`);
  }

  const alertEmail = process.env.OPS_ALERT_EMAIL;
  if (warnings.length && !alertEmail) throw new Error('OPS_ALERT_EMAIL is not set');
  if (warnings.length && alertEmail) {
    await sendOpsEmail(
      alertEmail,
      'Secret Santa: needs a look',
      `${warnings.join('\n\n')}\n\nThe runbook has what to do: docs/OPERATIONS.md in the repository.\n\nFor reference, the busiest connection made ${now.busiest_connection_requests} counted requests in the last 24 hours.`
    );
  }

  return { statDate, warnings };
}

async function weeklyReport(): Promise<void> {
  const alertEmail = process.env.OPS_ALERT_EMAIL;
  if (!alertEmail) throw new Error('OPS_ALERT_EMAIL is not set');

  // The 7 UTC days before today. Sunday's job runs after Saturday's row is written
  const [week] = (await sql`
    SELECT
         COUNT(*)::int as days
        ,COALESCE(SUM(draws_created), 0)::int as draws_created
        ,COALESCE(SUM(draws_emailed), 0)::int as draws_emailed
        ,COALESCE(SUM(participants_created), 0)::int as participants_created
        ,COALESCE(SUM(emails_sent), 0)::int as emails_sent
        ,COALESCE(SUM(links_opened), 0)::int as links_opened
        ,(SELECT COUNT(*)::int FROM Draws WHERE replaced_by IS NULL) as total_draws
        ,(
              SELECT COUNT(*)::int
              FROM Participants as participants
                   INNER JOIN Draws as draws ON participants.draw_id = draws.id
              WHERE draws.replaced_by IS NULL
         ) as total_participants
    FROM DailyStats
    WHERE stat_date >= current_date - 7 AND stat_date < current_date
  `) as WeekRow[];

  const average = week.draws_created ? (week.participants_created / week.draws_created).toFixed(1) : 'n/a';
  const opened = week.participants_created ? `${Math.round((week.links_opened / week.participants_created) * 100)}%` : 'n/a';
  await sendOpsEmail(
    alertEmail,
    'Secret Santa: weekly stats',
    [
      `Last 7 days (${week.days} days recorded):`,
      `- Draws created: ${week.draws_created}`,
      `- Draws emailed: ${week.draws_emailed}`,
      `- Participants in new draws: ${week.participants_created} (${average} per draw)`,
      `- Emails sent: ${week.emails_sent}`,
      `- Personal links opened for the first time: ${week.links_opened} (${opened} of new participants; opens can come days after a draw)`,
      '',
      `All time: ${week.total_draws} draws, ${week.total_participants} participants.`,
    ].join('\n')
  );
}

export default async function handler(req: NextApiRequest, res: NextApiResponse<OpsCheckResponse | ApiError>) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).json({ error: 'Method not allowed.' });
  }

  const secret = process.env.CRON_SECRET;
  if (!secret) {
    await reportError(new Error('CRON_SECRET is not set'));
    return res.status(500).json({ error: 'Not configured.' });
  }
  if (!isAuthorized(req.headers.authorization, secret)) return res.status(403).json({ error: 'Not allowed.' });

  try {
    if (req.query.report === 'weekly') {
      await weeklyReport();
      return res.status(200).json({ ok: true, reported: true });
    }

    // The daily run checks in with Sentry's cron monitor, which alerts when a
    // check-in is late, missing or failed
    const result = await withCheckIn(dailyCheck);
    return res.status(200).json({ ok: true, ...result });
  } catch (err) {
    await reportError(err);
    return res.status(500).json({ error: 'The check failed.' });
  }
}
