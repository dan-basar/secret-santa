// GET /api/reveal?token=<token>: one participant's own match, for their personal
// link. The reveal token is the only credential and unlocks nothing else.
// Returns 200 { name, match_name, created_at, organizer_name, organizer_note,
// budget_cents, exchange_date } (the last three are the organizer's optional
// exchange details, null when not set); 404 unknown token; 410 deleted draw.
// The first successful call sets the participant's revealed_at, for the usage stats.

import type { NextApiRequest, NextApiResponse } from 'next';
import { reportError } from '@/lib/report';
import { sql } from '@/lib/db';
import { isRevealToken } from '@/lib/tokens';
import type { ApiError, RevealResponse } from '@/types/api';

interface RevealRow {
  giver_id: number;
  revealed_at: Date | null;
  giver_name: string;
  receiver_name: string;
  created_at: Date;
  emails_sent_at: Date | null;
  organizer_name: string | null;
  organizer_note: string | null;
  budget_cents: number | null;
  exchange_date: string | null;
  deleted_at: Date | null;
}

export default async function handler(req: NextApiRequest, res: NextApiResponse<RevealResponse | ApiError>) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).json({ error: 'Method not allowed.' });
  }

  // The token is the only secret guarding a match, so keep responses out of caches and search
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('X-Robots-Tag', 'noindex');

  const { token } = req.query;
  if (!token || typeof token !== 'string' || !isRevealToken(token)) {
    return res.status(404).json({ error: 'This link is not valid.' });
  }

  try {
    const rows = await sql`
      SELECT
           givers.id as giver_id
          ,givers.revealed_at
          ,givers.name as giver_name
          ,receivers.name as receiver_name
          ,draws.created_at
          ,draws.emails_sent_at
          ,draws.organizer_name
          ,draws.organizer_note
          ,draws.budget_cents
          ,to_char(draws.exchange_date, 'YYYY-MM-DD') as exchange_date
          ,draws.deleted_at
      FROM Participants as givers
           INNER JOIN Draws as draws ON givers.draw_id = draws.id
           INNER JOIN Matches as matches ON matches.giver_participant_id = givers.id
           INNER JOIN Participants as receivers ON matches.receiver_participant_id = receivers.id
      WHERE givers.reveal_code = ${token}
    ` as RevealRow[];

    if (!rows.length) return res.status(404).json({ error: 'This link is not valid.' });

    const row = rows[0];

    if (row.deleted_at) return res.status(410).json({ error: 'This draw has been deleted.' });

    // Only the first open is recorded. Failing to record it never keeps someone
    // from their match
    if (!row.revealed_at) {
      try {
        await sql`UPDATE Participants SET revealed_at = now() WHERE id = ${row.giver_id} AND revealed_at IS NULL`;
      } catch (err) {
        await reportError(err);
      }
    }

    // Only the giver's own row is selected, so nothing about other participants can leak
    return res.status(200).json({
      name: row.giver_name,
      match_name: row.receiver_name,
      created_at: row.created_at.toISOString(),
      organizer_name: row.emails_sent_at ? row.organizer_name : null,
      organizer_note: row.organizer_note,
      budget_cents: row.budget_cents,
      exchange_date: row.exchange_date,
    });
  } catch (err) {
    await reportError(err);
    return res.status(500).json({ error: 'Database error. Please try again.' });
  }
}
