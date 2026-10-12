// POST /api/send-emails: emails each participant their match and reveal link.
// Admin key required. Body: { id, key, turnstileToken } plus organizerName and
// organizerEmail on the first send, or retryFailed: true to resend only the failed.
// Returns 200 { success, totalSent, totalFailed, failedNames }; 400 bad input;
// 403 wrong key or CAPTCHA; 409 already sent / nothing to resend; 410 deleted;
// 503 daily cap hit (495 emails in any 24 hours, across all draws).

import type { NextApiRequest, NextApiResponse } from 'next';
import { sql, isUuid } from '@/lib/db';
import { sendMatchEmail } from '@/lib/email';
import { hasHtmlTag } from '@/lib/sanitize';
import { isValidEmail } from '@/lib/email-address';
import { verifyTurnstile } from '@/lib/turnstile';
import type { SendEmailsError, SendEmailsResponse } from '@/types/api';

// Gmail's free SMTP plan allows ~500 emails in a rolling 24 hours; 495 gives a
// 5-email safety margin
const DAILY_EMAIL_LIMIT = 495;

// Any fixed number: the advisory lock that makes cap reservations take turns
const EMAIL_CAP_LOCK_ID = 495;

// A participant's claim normally lasts only as long as their own send. One older
// than this belongs to a request that was killed mid-send (the function limit is
// 60s), so that person can be claimed again
const CLAIM_EXPIRY_MINUTES = 5;

interface DrawRow {
  id: string;
  emails_sent_at: Date | null;
  deleted_at: Date | null;
  admin_key: string;
  organizer_name: string | null;
  organizer_email: string | null;
}

interface MatchRow {
  giver_id: number;
  giver_name: string;
  giver_email: string | null;
  giver_email_sent_at: Date | null;
  giver_reveal_token: string;
  receiver_name: string;
}

export default async function handler(req: NextApiRequest, res: NextApiResponse<SendEmailsResponse | SendEmailsError>) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method not allowed.' });
  }

  const { id, key, organizerName, organizerEmail, turnstileToken, retryFailed } = req.body;
  if (!id || typeof id !== 'string') return res.status(400).json({ error: 'A draw id is required.' });
  if (!isUuid(id)) return res.status(404).json({ error: 'Draw not found.' });
  if (!key || typeof key !== 'string') return res.status(403).json({ error: 'Only the organizer can send emails for this draw.' });
  if (retryFailed !== undefined && typeof retryFailed !== 'boolean') return res.status(400).json({ error: 'retryFailed must be true or false.' });

  // A resend reuses the organizer name and email saved by the first send, so
  // they're only read from the body for the first send
  let safeOrganizerName = '';
  let safeOrganizerEmail = '';

  if (!retryFailed) {
    if (!organizerName || typeof organizerName !== 'string' || !organizerName.trim()) return res.status(400).json({ error: 'Organizer name is required.' });
    if (!organizerEmail || typeof organizerEmail !== 'string' || !organizerEmail.trim()) return res.status(400).json({ error: 'Organizer email is required.' });

    // Stored and emailed as plain text; email.ts escapes both before they go into HTML
    safeOrganizerName = organizerName.trim();
    safeOrganizerEmail = organizerEmail.trim().toLowerCase();

    if (hasHtmlTag(safeOrganizerName)) return res.status(400).json({ error: 'Organizer name cannot contain HTML.' });

    if (!isValidEmail(safeOrganizerEmail)) return res.status(400).json({ error: 'Invalid organizer email format.' });
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

  try {
    const [drawRows, matchRows] = (await sql.transaction([
      sql`
        SELECT
             id
            ,emails_sent_at
            ,deleted_at
            ,admin_key
            ,organizer_name
            ,organizer_email
        FROM Draws
        WHERE id = ${id}::uuid
      `,
      sql`
        SELECT
             givers.id as giver_id
            ,givers.name as giver_name
            ,givers.email as giver_email
            ,givers.email_sent_at as giver_email_sent_at
            ,givers.reveal_token as giver_reveal_token
            ,receivers.name as receiver_name
        FROM Matches as matches
             INNER JOIN Participants as givers ON matches.giver_participant_id = givers.id
             INNER JOIN Participants as receivers ON matches.receiver_participant_id = receivers.id
        WHERE matches.draw_id = ${id}::uuid
      `,
    ], { readOnly: true })) as [DrawRow[], MatchRow[]];

    if (!drawRows.length) return res.status(404).json({ error: 'Draw not found.' });

    const draw = drawRows[0];

    if (key !== draw.admin_key) return res.status(403).json({ error: 'Only the organizer can send emails for this draw.' });

    if (draw.deleted_at) return res.status(410).json({ error: 'This draw has been deleted.' });

    if (retryFailed) {
      if (!draw.emails_sent_at) return res.status(409).json({ error: 'Emails haven\'t been sent for this draw yet.' });
      // Saved together with emails_sent_at by the first send, so never null here
      safeOrganizerName = draw.organizer_name ?? '';
      safeOrganizerEmail = draw.organizer_email ?? '';
    } else if (draw.emails_sent_at) {
      return res.status(409).json({ error: 'Emails have already been sent for this draw.' });
    }

    const unsent = matchRows.filter((match): match is MatchRow & { giver_email: string } => !!match.giver_email && !match.giver_email_sent_at);

    if (retryFailed && !unsent.length) return res.status(409).json({ error: 'Everyone has already been sent their email.' });

    // Step 1: Reserve room under the email cap BEFORE sending.
    //
    // Sends are counted in hourly rows, and the cap covers every row that can
    // hold a send from the last 24 hours (so up to 25 hours, erring on the safe
    // side), matching Gmail's rolling limit rather than the calendar day. The
    // advisory lock makes concurrent requests reserve one at a time, so two big
    // sends can't both pass the check; the INSERT adds this request's count only
    // when it fits, and returns no row when it doesn't. Whatever ends up not
    // being sent is given back below; a request that dies keeps its reservation,
    // since some of those emails may have gone out.
    const [, reservedRows] = await sql.transaction([
      sql`SELECT pg_advisory_xact_lock(${EMAIL_CAP_LOCK_ID}::bigint)`,
      sql`
        INSERT INTO EmailSendLog (hour_start, emails_sent)
        SELECT date_trunc('hour', now()), ${unsent.length}::int
        WHERE (
             SELECT COALESCE(SUM(emailSendLog.emails_sent), 0)
             FROM EmailSendLog as emailSendLog
             WHERE emailSendLog.hour_start > now() - interval '25 hours'
        ) + ${unsent.length}::int <= ${DAILY_EMAIL_LIMIT}::int
        ON CONFLICT (hour_start) DO UPDATE SET emails_sent = EmailSendLog.emails_sent + EXCLUDED.emails_sent
        RETURNING hour_start
      `,
    ]) as [unknown, { hour_start: Date }[]];

    if (!reservedRows.length) {
      return res.status(503).json({
        error: `The daily email limit of ${DAILY_EMAIL_LIMIT} has been reached. Please try again tomorrow.`,
      });
    }

    // Hands back reserved emails that won't be sent. A failure here only leaves
    // the cap counting too many for a day, so it never fails the request
    const reservedHour = reservedRows[0].hour_start;
    const releaseReserved = async (count: number) => {
      if (count <= 0) return;
      try {
        await sql`
          UPDATE EmailSendLog
          SET emails_sent = emails_sent - ${count}::int
          WHERE hour_start = ${reservedHour}::timestamptz
        `;
      } catch (err) {
        console.error(err);
      }
    };

    // Step 2: On the first send, claim the draw BEFORE sending.
    //
    // This stops two concurrent first sends from both saving organizer details.
    // The UPDATE is atomic: only the first request matches `emails_sent_at IS NULL`,
    // so only it gets a row back from RETURNING. Any other request stops here.
    if (!retryFailed) {
      const drawClaimRows = await sql`
        UPDATE Draws
        SET emails_sent_at = now(), organizer_name = ${safeOrganizerName}, organizer_email = ${safeOrganizerEmail}
        WHERE id = ${id}::uuid
             AND emails_sent_at IS NULL
        RETURNING id
      `;

      if (!drawClaimRows.length) {
        await releaseReserved(unsent.length);
        return res.status(409).json({ error: 'Emails have already been sent for this draw.' });
      }
    }

    // Step 3: Claim each participant BEFORE sending their email.
    //
    // The same pattern per person, in one statement: a participant comes back
    // only to the request that set their email_claimed_at, so two clicks of Send
    // or Resend can never email anyone twice. A claim older than
    // CLAIM_EXPIRY_MINUTES was left by a request that died, so it can be taken.
    const participantClaimRows = await sql`
      UPDATE Participants
      SET email_claimed_at = now()
      WHERE id = ANY(${unsent.map(match => match.giver_id)}::int[])
           AND email_sent_at IS NULL
           AND (email_claimed_at IS NULL OR email_claimed_at < now() - make_interval(mins => ${CLAIM_EXPIRY_MINUTES}))
      RETURNING id
    ` as { id: number }[];
    const claimedIds = new Set(participantClaimRows.map(row => row.id));
    const toSend = unsent.filter(match => claimedIds.has(match.giver_id));
    await releaseReserved(unsent.length - toSend.length);

    if (retryFailed && !toSend.length) return res.status(409).json({ error: 'These emails are already being sent.' });

    // Step 4: Send the emails, recording each one as soon as its own send settles,
    // so a request killed mid-batch loses at most the emails still in flight (their
    // claims expire and they show as not delivered). Every email is attempted even
    // if some fail, so partial delivery is possible.
    const delivered = await Promise.all(toSend.map(async match => {
      let ok = true;
      try {
        await sendMatchEmail(match.giver_name, match.giver_email, match.receiver_name, safeOrganizerName, safeOrganizerEmail, match.giver_reveal_token);
      } catch (err) {
        console.error(err);
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
        console.error(err);
      }

      return ok;
    }));

    const failed = toSend.filter((_, i) => !delivered[i]);
    const failedNames: string[] = failed.map(match => match.giver_name);
    const actualSent = toSend.length - failed.length;
    await releaseReserved(failed.length);

    const allFailed = failed.length > 0 && failed.length === toSend.length;

    if (allFailed && !retryFailed) {
      // Nobody got an email on the first send: reopen the draw so the organizer
      // can start over, including changing their name or email
      await sql`UPDATE Draws SET emails_sent_at = NULL WHERE id = ${id}::uuid`;

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
    });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: 'Failed to send emails. Please try again.' });
  }
}
