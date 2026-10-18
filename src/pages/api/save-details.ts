// POST /api/save-details: saves the organizer's exchange details (note, budget and
// date) so they show on each personal link page, without sending any email.
// Admin key required. Body: { key, organizerNote, budget, exchangeDate }, the
// same fields and checks as the first send; an empty value clears that detail.
// Returns 200 { organizer_note, budget_cents, exchange_date } as saved; 400 bad
// input; 403 missing, malformed or unknown key; 409 emails already sent (the
// details then match what went out and are locked); 410 deleted.

import type { NextApiRequest, NextApiResponse } from 'next';
import { reportError } from '@/lib/report';
import { sql } from '@/lib/db';
import { isAdminKey } from '@/lib/tokens';
import { readDetails } from '@/lib/details';
import type { ApiError, SaveDetailsResponse } from '@/types/api';

interface DrawRow {
  deleted_at: Date | null;
  emails_sent_at: Date | null;
}

export default async function handler(req: NextApiRequest, res: NextApiResponse<SaveDetailsResponse | ApiError>) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method not allowed.' });
  }

  const { key, organizerNote, budget, exchangeDate } = req.body ?? {};
  if (typeof key !== 'string' || !isAdminKey(key)) return res.status(403).json({ error: 'Only the organizer can change this draw.' });

  const details = readDetails({ organizerNote, budget, exchangeDate });
  if (typeof details === 'string') return res.status(400).json({ error: details });

  try {
    // One round trip when it saves. A send or delete that lands first wins
    const updated = await sql`
      UPDATE Draws
      SET organizer_note = ${details.organizer_note}, budget_cents = ${details.budget_cents}::int, exchange_date = ${details.exchange_date}::date
      WHERE admin_key = ${key}
           AND deleted_at IS NULL
           AND emails_sent_at IS NULL
      RETURNING id
    `;
    if (updated.length) return res.status(200).json(details);

    // Nothing was saved: find out why
    const drawRows = await sql`
      SELECT
           deleted_at
          ,emails_sent_at
      FROM Draws
      WHERE admin_key = ${key}
    ` as DrawRow[];
    if (!drawRows.length) return res.status(403).json({ error: 'Only the organizer can change this draw.' });
    if (drawRows[0].deleted_at) return res.status(410).json({ error: 'This draw has been deleted.' });
    if (drawRows[0].emails_sent_at) return res.status(409).json({ error: 'The emails have gone out, so the details can no longer be changed.' });
    // A first send that failed for everyone reopened the draw in between
    return res.status(409).json({ error: 'This draw changed while you were saving. Refresh the page and try again.' });
  } catch (err) {
    await reportError(err);
    return res.status(500).json({ error: 'Database error. Please try again.' });
  }
}
