import type { NextApiRequest, NextApiResponse } from 'next';
import { sql, isUuid } from '@/lib/db';
import { sendMatchEmail } from '@/lib/email';
import { hasHtmlTag } from '@/lib/sanitize';

// Gmail's free SMTP plan allows ~500 emails/day; 495 gives a 5-email safety margin
const DAILY_EMAIL_LIMIT = 495;

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') return res.status(405).end();

  const { id, key, organizerName, organizerEmail, turnstileToken } = req.body;
  if (!id || typeof id !== 'string') return res.status(400).end();
  if (!isUuid(id)) return res.status(404).json({ error: 'Draw not found.' });
  if (!key || typeof key !== 'string') return res.status(403).json({ error: 'Only the organizer can send emails for this draw.' });
  if (!organizerName || typeof organizerName !== 'string' || !organizerName.trim()) return res.status(400).json({ error: 'Organizer name is required.' });
  if (!organizerEmail || typeof organizerEmail !== 'string' || !organizerEmail.trim()) return res.status(400).json({ error: 'Organizer email is required.' });

  // Stored and emailed as plain text; email.ts escapes both before they go into HTML
  const safeOrganizerName = organizerName.trim();
  const safeOrganizerEmail = organizerEmail.trim().toLowerCase();

  if (hasHtmlTag(safeOrganizerName)) return res.status(400).json({ error: 'Organizer name cannot contain HTML.' });

  // Also rejects "<", ">" and quotes, which have no place in an address shown in the email
  const emailRegex = /^[^\s@<>"']+@[^\s@<>"']+\.[^\s@<>"']+$/;
  if (!emailRegex.test(safeOrganizerEmail)) return res.status(400).json({ error: 'Invalid organizer email format.' });

  // Verify Turnstile token
  if (!turnstileToken) {
    return res.status(400).json({ error: 'CAPTCHA verification required.' });
  }

  const turnstileResponse = await fetch(
    'https://challenges.cloudflare.com/turnstile/v0/siteverify',
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        secret: process.env.TURNSTILE_SECRET_KEY,
        response: turnstileToken,
      }),
    }
  );

  const turnstileResult = await turnstileResponse.json();

  if (!turnstileResult.success) {
    return res.status(403).json({ error: 'CAPTCHA verification failed.' });
  }

  try {
    const [drawRows, matchRows] = await sql.transaction([
      sql`
        SELECT
             id
            ,emails_sent_at
            ,deleted_at
            ,admin_key
        FROM Draws
        WHERE id = ${id}::uuid
      `,
      sql`
        SELECT
             givers.name as giver_name
            ,givers.email as giver_email
            ,receivers.name as receiver_name
        FROM Matches as matches
             INNER JOIN Participants as givers ON matches.giver_participant_id = givers.id
             INNER JOIN Participants as receivers ON matches.receiver_participant_id = receivers.id
        WHERE matches.draw_id = ${id}::uuid
      `,
    ], { readOnly: true });

    if (!drawRows.length) return res.status(404).json({ error: 'Draw not found.' });

    const draw = drawRows[0];

    // Old draws with no stored admin_key never match, so they can't send
    if (key !== draw.admin_key) return res.status(403).json({ error: 'Only the organizer can send emails for this draw.' });

    if (draw.deleted_at) return res.status(410).json({ error: 'This draw has been deleted.' });

    if (draw.emails_sent_at) return res.status(409).json({ error: 'Emails have already been sent for this draw.' });

    // Step 1: Check global daily email cap
    const toSend = matchRows.filter(match => match.giver_email);

    const capRows = await sql`
      SELECT COALESCE(emails_sent, 0) as emails_sent
      FROM DailyEmailLog
      WHERE log_date = (now() at time zone 'utc')::date
    `;
    const dailyCount: number = capRows[0]?.emails_sent ?? 0;

    if (dailyCount + toSend.length > DAILY_EMAIL_LIMIT) {
      return res.status(503).json({
        error: `The daily email limit of ${DAILY_EMAIL_LIMIT} has been reached. Please try again tomorrow.`,
      });
    }

    // Step 2: Claim the draw BEFORE sending.
    //
    // This prevents two concurrent requests from both passing the checks above
    // and both sending a full set of emails. The UPDATE is atomic: only the first
    // request matches `emails_sent_at IS NULL`, so only it gets a row back from
    // RETURNING. Any other request gets no row and stops here.
    const claimRows = await sql`
      UPDATE Draws
      SET emails_sent_at = now(), organizer_name = ${safeOrganizerName}, organizer_email = ${safeOrganizerEmail}
      WHERE id = ${id}::uuid
           AND emails_sent_at IS NULL
      RETURNING id
    `;

    if (!claimRows.length) {
      return res.status(409).json({ error: 'Emails have already been sent for this draw.' });
    }

    // Step 3: Send the emails.
    // allSettled (rather than all) lets us attempt every email even if some fail,
    // so partial delivery is possible.
    const results = await Promise.allSettled(
      toSend.map(match =>
        sendMatchEmail(match.giver_name, match.giver_email, match.receiver_name, safeOrganizerName, safeOrganizerEmail)
      )
    );

    // Step 4: Check results
    const failures = results.filter(r => r.status === 'rejected');

    if (failures.length > 0 && failures.length === toSend.length) {
      // ALL emails failed — roll back the timestamp so the user can retry.
      // We don't roll back on partial failure: some recipients already received
      // their email, so re-sending to everyone would cause duplicates.
      await sql`UPDATE Draws SET emails_sent_at = NULL WHERE id = ${id}::uuid`;

      return res.status(500).json({ error: 'Failed to send emails. Please try again.' });
    }

    // Step 5: Record successfully sent emails in the daily counter.
    // ON CONFLICT makes the upsert atomic: if two requests on the same UTC date
    // both try to insert, the second one updates the existing row instead.
    const actualSent = toSend.length - failures.length;
    await sql`
      INSERT INTO DailyEmailLog (log_date, emails_sent)
      VALUES ((now() at time zone 'utc')::date, ${actualSent})
      ON CONFLICT (log_date) DO UPDATE SET emails_sent = DailyEmailLog.emails_sent + EXCLUDED.emails_sent
    `;

    return res.status(200).json({
      success: true,
      totalSent: actualSent,
      totalFailed: failures.length,
    });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: 'Failed to send emails. Please try again.' });
  }
}
