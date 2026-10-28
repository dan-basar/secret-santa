// POST /api/send-emails: emails each participant their match and reveal link,
// and on the first send emails the organizer their organizer link. With no
// participant emails, the first send emails just the organizer their link, and
// can be repeated. Admin key required. Body: { key, turnstileToken } plus
// organizerName and organizerEmail on the first send, or retryFailed: true to
// resend only the failed. A resend can carry person (an index into get-draw's
// participants) to resend to just that person, plus email to correct their
// address first; only someone whose email didn't go out can be resent to or
// have their address changed. The first send may also carry the optional exchange
// details organizerNote, budget (dollars as typed) and exchangeDate (YYYY-MM-DD),
// saved with the draw and put in every match email; with no participant emails
// they are saved with each organizer link email, for the personal link pages.
// Returns 200 { success, totalSent, totalFailed, failedNames, organizerLinkSent }; 400 bad input;
// 403 missing, malformed or unknown key, or failed CAPTCHA; 409 already sent /
// nothing to resend / that person already has their email; 410 deleted;
// 429 the sender's IP has used its email budget (100 emails in any 24 hours);
// 503 daily cap hit (495 emails in any 24 hours, across all draws).

import type { NextApiRequest, NextApiResponse } from 'next';
import { sql } from '@/lib/db';
import { isAdminKey } from '@/lib/tokens';
import { sendMatchEmail, sendOrganizerLinkEmail } from '@/lib/email';
import { hasHtmlTag, hasLink } from '@/lib/sanitize';
import { isValidEmail } from '@/lib/email-address';
import { verifyTurnstile } from '@/lib/turnstile';
import { readDetails } from '@/lib/details';
import { reportError, reportWarning } from '@/lib/report';
import { CLAIM_EXPIRY_MINUTES, DAILY_EMAIL_LIMIT, IP_EMAIL_BUDGET } from '@/lib/limits';
import { clientIp, isWhitelisted, rateLimitBucket } from '@/lib/rate-limit';
import type { ExchangeDetails, SendEmailsError, SendEmailsResponse } from '@/types/api';

// A send that takes longer than this is close to the 120s function limit; the
// 50-person test sent in 44s with Gmail
const SLOW_SEND_SECONDS = 100;

// Any fixed number: the advisory lock that makes cap reservations take turns
const EMAIL_CAP_LOCK_ID = 495;

interface DrawRow {
  id: string;
  emails_sent_at: Date | null;
  deleted_at: Date | null;
  organizer_name: string | null;
  organizer_email: string | null;
  organizer_note: string | null;
  budget_cents: number | null;
  exchange_date: string | null;
}

interface MatchRow {
  giver_id: number;
  giver_position: number;
  giver_name: string;
  giver_email: string | null;
  giver_email_sent_at: Date | null;
  giver_reveal_code: string;
  receiver_name: string;
}

interface ClaimRow {
  cap_ok: boolean;
  ip_ok: boolean;
  draw_updated: boolean;
  claimed_ids: number[];
  reserved_hour: Date | null;
}

// Hands back reserved emails that weren't sent, from the cap and from the IP's
// budget. Both reservations were made in the same hour, so that hour's rows hold
// them. A failure here only leaves a count too high for a day, so it never fails
// the request
async function releaseReserved(count: number, reservedHour: Date | null, budgetBucket: string | null) {
  if (count <= 0 || !reservedHour) return;
  try {
    await sql.transaction([
      sql`
        UPDATE EmailSendLog
        SET emails_sent = emails_sent - ${count}::int
        WHERE hour_start = ${reservedHour}::timestamptz
      `,
      sql`
        UPDATE RateLimits
        SET hits = hits - ${count}::int
        WHERE bucket = ${budgetBucket}
             AND window_start = ${reservedHour}::timestamptz
      `,
    ]);
  } catch (err) {
    await reportError(err);
  }
}

export default async function handler(req: NextApiRequest, res: NextApiResponse<SendEmailsResponse | SendEmailsError>) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method not allowed.' });
  }

  const { key, organizerName, organizerEmail, organizerNote, budget, exchangeDate, turnstileToken, retryFailed, person, email } = req.body;
  if (typeof key !== 'string' || !isAdminKey(key)) return res.status(403).json({ error: 'Only the organizer can send emails for this draw.' });
  if (retryFailed !== undefined && typeof retryFailed !== 'boolean') return res.status(400).json({ error: 'retryFailed must be true or false.' });
  if (person !== undefined && (!retryFailed || !Number.isInteger(person) || person < 0)) return res.status(400).json({ error: 'person must be a participant number, with retryFailed.' });
  if (email !== undefined && (person === undefined || typeof email !== 'string')) return res.status(400).json({ error: 'email must be text, with person.' });
  // A corrected address, stored like create-draw stores addresses
  const newEmail: string | null = typeof email === 'string' ? email.trim().toLowerCase() : null;
  if (newEmail !== null && (newEmail.length > 320 || !isValidEmail(newEmail))) return res.status(400).json({ error: 'Please enter a valid email address.' });

  // A resend reuses the organizer name and email saved by the first send, so
  // they're only read from the body for the first send
  let safeOrganizerName = '';
  let safeOrganizerEmail = '';
  // Likewise the exchange details: a resend uses the ones saved by the first send
  let details: ExchangeDetails = { organizer_note: null, budget_cents: null, exchange_date: null };

  if (!retryFailed) {
    if (!organizerName || typeof organizerName !== 'string' || !organizerName.trim()) return res.status(400).json({ error: 'Organizer name is required.' });
    if (!organizerEmail || typeof organizerEmail !== 'string' || !organizerEmail.trim()) return res.status(400).json({ error: 'Organizer email is required.' });

    // Stored and emailed as plain text; email.ts escapes both before they go into HTML
    safeOrganizerName = organizerName.trim();
    safeOrganizerEmail = organizerEmail.trim().toLowerCase();

    // Column sizes in sql/setup.sql; longer values would fail in the database
    if (safeOrganizerName.length > 200) return res.status(400).json({ error: 'Organizer name must be 200 characters or fewer.' });
    if (safeOrganizerEmail.length > 320) return res.status(400).json({ error: 'Organizer email must be 320 characters or fewer.' });
    if (hasHtmlTag(safeOrganizerName)) return res.status(400).json({ error: 'Organizer name cannot contain HTML.' });
    // It is written into every email, where a mail app would make a web address clickable
    if (hasLink(safeOrganizerName)) return res.status(400).json({ error: 'Organizer name cannot contain a web address.' });

    if (!isValidEmail(safeOrganizerEmail)) return res.status(400).json({ error: 'Invalid organizer email format.' });

    // All three are optional; an empty value means not set
    const read = readDetails({ organizerNote, budget, exchangeDate });
    if (typeof read === 'string') return res.status(400).json({ error: read });
    details = read;
  }

  // Every email carries a reveal link built from this; an email can't be taken
  // back, so refuse to send rather than send broken links
  if (!process.env.NEXT_PUBLIC_BASE_URL) {
    console.error('NEXT_PUBLIC_BASE_URL is not set');
    return res.status(500).json({ error: 'Emails are not configured on this server. Please contact the site owner.' });
  }

  if (!turnstileToken || typeof turnstileToken !== 'string') {
    return res.status(400).json({ error: 'CAPTCHA verification required.' });
  }

  // Also false when Cloudflare can't be reached; the organizer just tries again
  if (!(await verifyTurnstile(turnstileToken))) {
    return res.status(403).json({ error: 'CAPTCHA verification failed.' });
  }

  // The RateLimits bucket that counts this IP's emails against IP_EMAIL_BUDGET;
  // null skips the budget, for a whitelisted IP or (failing open, like the
  // proxy) when the bucket can't be worked out
  const ip = clientIp(String(req.headers['x-forwarded-for'] ?? ''), String(req.headers['x-real-ip'] ?? ''));
  let budgetBucket: string | null = null;
  if (!isWhitelisted(ip)) {
    try {
      budgetBucket = await rateLimitBucket(ip, 'email-budget');
    } catch (err) {
      console.error('Email budget check skipped', err);
    }
  }

  try {
    const [drawRows, matchRows] = (await sql.transaction([
      sql`
        SELECT
             id
            ,emails_sent_at
            ,deleted_at
            ,organizer_name
            ,organizer_email
            ,organizer_note
            ,budget_cents
            ,to_char(exchange_date, 'YYYY-MM-DD') as exchange_date
        FROM Draws
        WHERE admin_key = ${key}
      `,
      sql`
        SELECT
             givers.id as giver_id
            ,givers.position as giver_position
            ,givers.name as giver_name
            ,givers.email as giver_email
            ,givers.email_sent_at as giver_email_sent_at
            ,givers.reveal_code as giver_reveal_code
            ,receivers.name as receiver_name
        FROM Matches as matches
             INNER JOIN Draws as draws ON matches.draw_id = draws.id
             INNER JOIN Participants as givers ON matches.giver_participant_id = givers.id
             INNER JOIN Participants as receivers ON matches.receiver_participant_id = receivers.id
        WHERE draws.admin_key = ${key}
      `,
    ], { readOnly: true })) as [DrawRow[], MatchRow[]];

    if (!drawRows.length) return res.status(403).json({ error: 'Only the organizer can send emails for this draw.' });

    const draw = drawRows[0];

    if (draw.deleted_at) return res.status(410).json({ error: 'This draw has been deleted.' });

    if (retryFailed) {
      if (!draw.emails_sent_at) return res.status(409).json({ error: 'Emails haven\'t been sent for this draw yet.' });
      // Saved together with emails_sent_at by the first send, so never null here
      safeOrganizerName = draw.organizer_name ?? '';
      safeOrganizerEmail = draw.organizer_email ?? '';
      details = { organizer_note: draw.organizer_note, budget_cents: draw.budget_cents, exchange_date: draw.exchange_date };
    } else if (draw.emails_sent_at) {
      return res.status(409).json({ error: 'Emails have already been sent for this draw.' });
    }

    let unsent = matchRows.filter((match): match is MatchRow & { giver_email: string } => !!match.giver_email && !match.giver_email_sent_at);

    if (person !== undefined) {
      // Positions are 1-based; person is an index into get-draw's list, which is in position order
      const chosen = matchRows.find(match => match.giver_position === person + 1);
      if (!chosen) return res.status(400).json({ error: 'There is no such participant in this draw.' });
      if (chosen.giver_email_sent_at) return res.status(409).json({ error: `${chosen.giver_name} already has their email.` });
      if (!chosen.giver_email) return res.status(409).json({ error: `${chosen.giver_name} has no email address to resend to.` });
      unsent = [{ ...chosen, giver_email: newEmail ?? chosen.giver_email }];
    }

    if (retryFailed && !unsent.length) return res.status(409).json({ error: 'Everyone has already been sent their email.' });

    // The first send also emails the organizer their link: one more email
    const organizerCount = retryFailed ? 0 : 1;

    // Nobody has an email address: the first send emails just the organizer their
    // link. The draw isn't marked as sent, so Edit & Redraw stays open and this
    // can be repeated (the hourly rate limit and the cap still apply). The
    // exchange details are saved each time, for the personal link pages
    const organizerOnly = !retryFailed && !unsent.length;
    // What the organizer can do instead when the cap or their budget refuses the send
    const fallback = organizerOnly ? 'copy your organizer link above' : 'send each person their personal link below';

    // Step 1: In one transaction, check the email cap and claim the draw and
    // each participant BEFORE sending, reserving the cap for whoever was claimed
    // and for the organizer's link when the draw row was updated.
    //
    // The cap covers every hourly EmailSendLog row that can hold a send from the
    // last 24 hours (so up to 25 hours, erring on the safe side), matching Gmail's
    // rolling limit rather than the calendar day. The advisory lock makes
    // concurrent requests take turns, so two big sends can't both pass the check.
    //
    // The claims are atomic UPDATEs: on the first send only one request matches
    // `emails_sent_at IS NULL` and gets the draw back, so two first sends can't
    // both save organizer details (with nobody to email, the row only takes the
    // exchange details and stays unsent). Each participant comes back only to the
    // request that set their email_claimed_at, so two clicks of Send or Resend can
    // never email anyone twice. A claim older than CLAIM_EXPIRY_MINUTES was left
    // by a request that died, so it can be taken. Nothing is claimed when the cap
    // check fails, and on a first send nobody is claimed unless the draw was.
    //
    // Failed sends give their reservation back below; a request that dies keeps
    // its reservation, since some of those emails may have gone out.
    const [, claimRows] = await sql.transaction([
      sql`SELECT pg_advisory_xact_lock(${EMAIL_CAP_LOCK_ID}::bigint)`,
      sql`
        WITH cap AS (
             SELECT COALESCE(SUM(emailSendLog.emails_sent), 0) + ${unsent.length + organizerCount}::int <= ${DAILY_EMAIL_LIMIT}::int as ok
             FROM EmailSendLog as emailSendLog
             WHERE emailSendLog.hour_start > now() - interval '25 hours'
        ), ip_budget AS (
             SELECT ${budgetBucket}::text IS NULL OR COALESCE(SUM(rateLimits.hits), 0) + ${unsent.length + organizerCount}::int <= ${IP_EMAIL_BUDGET}::int as ok
             FROM RateLimits as rateLimits
             WHERE rateLimits.bucket = ${budgetBucket}
                  AND rateLimits.window_start > now() - interval '25 hours'
        ), allowed AS (
             SELECT (SELECT ok FROM cap) AND (SELECT ok FROM ip_budget) as ok
        ), draw_update AS (
             UPDATE Draws
             SET organizer_note = ${details.organizer_note}, budget_cents = ${details.budget_cents}::int, exchange_date = ${details.exchange_date}::date
                 ,emails_sent_at = CASE WHEN ${organizerOnly}::boolean THEN emails_sent_at ELSE now() END
                 ,organizer_name = CASE WHEN ${organizerOnly}::boolean THEN organizer_name ELSE ${safeOrganizerName} END
                 ,organizer_email = CASE WHEN ${organizerOnly}::boolean THEN organizer_email ELSE ${safeOrganizerEmail} END
             WHERE id = ${draw.id}::uuid
                  AND emails_sent_at IS NULL
                  AND NOT ${!!retryFailed}::boolean
                  AND (SELECT ok FROM allowed)
             RETURNING id
        ), participant_claim AS (
             -- A corrected address is saved with the claim, so it only changes for
             -- someone whose email hasn't gone out, and stays for a later resend if
             -- this one fails
             UPDATE Participants
             SET email_claimed_at = now()
                 ,email = COALESCE(${newEmail}::varchar, email)
             WHERE id = ANY(${unsent.map(match => match.giver_id)}::int[])
                  AND email_sent_at IS NULL
                  AND (email_claimed_at IS NULL OR email_claimed_at < now() - make_interval(mins => ${CLAIM_EXPIRY_MINUTES}))
                  AND (SELECT ok FROM allowed)
                  AND (${!!retryFailed}::boolean OR EXISTS (SELECT 1 FROM draw_update))
             RETURNING id
        ), reserved AS (
             SELECT (SELECT COUNT(*) FROM participant_claim)::int + (SELECT COUNT(*) FROM draw_update)::int as emails
        ), reserve AS (
             INSERT INTO EmailSendLog (hour_start, emails_sent)
             SELECT date_trunc('hour', now()), reserved.emails
             FROM reserved
             WHERE reserved.emails > 0
             ON CONFLICT (hour_start) DO UPDATE SET emails_sent = EmailSendLog.emails_sent + EXCLUDED.emails_sent
             RETURNING hour_start
        ), ip_reserve AS (
             INSERT INTO RateLimits (bucket, window_start, hits)
             SELECT ${budgetBucket}, date_trunc('hour', now()), reserved.emails
             FROM reserved
             WHERE reserved.emails > 0 AND ${budgetBucket}::text IS NOT NULL
             ON CONFLICT (bucket, window_start) DO UPDATE SET hits = RateLimits.hits + EXCLUDED.hits
        )
        SELECT
             (SELECT ok FROM cap) as cap_ok
            ,(SELECT ok FROM ip_budget) as ip_ok
            ,EXISTS (SELECT 1 FROM draw_update) as draw_updated
            ,ARRAY(SELECT id FROM participant_claim) as claimed_ids
            ,(SELECT hour_start FROM reserve) as reserved_hour
      `,
    ]) as [unknown, ClaimRow[]];
    const claim = claimRows[0];

    if (!claim.cap_ok) return res.status(503).json({ error: `The site's email limit is reached for now. Try again in a few hours, or ${fallback}.` });

    if (!claim.ip_ok) {
      return res.status(429).json({ error: `You've sent the most emails allowed from your connection for now (${IP_EMAIL_BUDGET} in 24 hours). Try again later, or ${fallback}.` });
    }

    if (!retryFailed && !claim.draw_updated) return res.status(409).json({ error: 'Emails have already been sent for this draw.' });

    const claimedIds = new Set(claim.claimed_ids);
    const toSend = unsent.filter(match => claimedIds.has(match.giver_id));

    if (retryFailed && !toSend.length) return res.status(409).json({ error: 'These emails are already being sent.' });

    // On the first send the organizer's link goes out alongside the match emails;
    // if it fails the send still stands, and the page tells the organizer to copy
    // their link
    const organizerLinkSending = retryFailed
      ? Promise.resolve(false)
      : sendOrganizerLinkEmail(safeOrganizerName, safeOrganizerEmail, key).then(() => true, async (err) => {
        await reportError(err);
        return false;
      });

    // Step 2: Send the emails, recording each one as soon as its own send settles,
    // so a request killed mid-batch loses at most the emails still in flight (their
    // claims expire and they show as not delivered). Every email is attempted even
    // if some fail, so partial delivery is possible.
    const sendStartedAt = Date.now();
    // Failed emails go to Sentry as one event per send (below), so a Gmail outage
    // mid-send is one event instead of one per person
    let firstSendError: unknown;
    const delivered = await Promise.all(toSend.map(async match => {
      let ok = true;
      try {
        await sendMatchEmail(match.giver_name, match.giver_email, match.receiver_name, safeOrganizerName, safeOrganizerEmail, match.giver_reveal_code, details);
      } catch (err) {
        console.error(err);
        firstSendError ??= err;
        ok = false;
      }

      try {
        if (ok) {
          // Already counted against the cap by the reservation in step 1
          await sql`
            UPDATE Participants
            SET email_sent_at = now(), email_claimed_at = NULL
            WHERE id = ${match.giver_id}
          `;
        } else {
          // Release the claim so a resend can reach them straight away
          await sql`
            UPDATE Participants
            SET email_claimed_at = NULL
            WHERE id = ${match.giver_id}
          `;
        }
      } catch (err) {
        // The email's outcome stands; the claim is left to expire
        await reportError(err);
      }

      return ok;
    }));

    const organizerLinkSent = await organizerLinkSending;

    const sendSeconds = (Date.now() - sendStartedAt) / 1000;
    if (sendSeconds > SLOW_SEND_SECONDS) await reportWarning(`A send of ${toSend.length} emails took ${Math.round(sendSeconds)}s, close to the 120s function limit`);

    const failed = toSend.filter((_, i) => !delivered[i]);
    if (failed.length) await reportError(new Error(`${failed.length} of ${toSend.length} emails failed to send`, { cause: firstSendError }));
    const failedNames: string[] = failed.map(match => match.giver_name);
    const actualSent = toSend.length - failed.length;
    await releaseReserved(failed.length + (organizerCount && !organizerLinkSent ? 1 : 0), claim.reserved_hour, budgetBucket);

    // With nobody else to email, the organizer's link was the whole send
    if (organizerOnly && !organizerLinkSent) return res.status(500).json({ error: 'Failed to send your organizer link. Please try again.' });

    const allFailed = failed.length > 0 && failed.length === toSend.length;

    if (allFailed && !retryFailed) {
      // Nobody got an email on the first send: reopen the draw so the organizer
      // can start over, including changing their name or email
      await sql`UPDATE Draws SET emails_sent_at = NULL WHERE id = ${draw.id}::uuid`;

      return res.status(500).json({ error: 'Failed to send emails. Please try again.' });
    }

    if (allFailed) {
      return res.status(500).json({ error: 'Failed to send emails. Please try again.', failedNames });
    }

    return res.status(200).json({
      success: true,
      totalSent: actualSent,
      totalFailed: failed.length,
      failedNames,
      organizerLinkSent,
    });
  } catch (err) {
    await reportError(err);
    return res.status(500).json({ error: 'Failed to send emails. Please try again.' });
  }
}
