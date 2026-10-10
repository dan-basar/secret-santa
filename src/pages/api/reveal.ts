import type { NextApiRequest, NextApiResponse } from 'next';
import { sql, isUuid } from '@/lib/db';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') return res.status(405).end();

  // The token is the only secret guarding a match, so keep responses out of caches and search
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('X-Robots-Tag', 'noindex');

  const { token } = req.query;
  if (!token || typeof token !== 'string' || !isUuid(token)) {
    return res.status(404).json({ error: 'This link is not valid.' });
  }

  try {
    const rows = await sql`
      SELECT
           givers.name as giver_name
          ,receivers.name as receiver_name
          ,draws.created_at
          ,draws.emails_sent_at
          ,draws.organizer_name
          ,draws.deleted_at
      FROM Participants as givers
           INNER JOIN Draws as draws ON givers.draw_id = draws.id
           INNER JOIN Matches as matches ON matches.giver_participant_id = givers.id
           INNER JOIN Participants as receivers ON matches.receiver_participant_id = receivers.id
      WHERE givers.reveal_token = ${token}::uuid
    `;

    if (!rows.length) return res.status(404).json({ error: 'This link is not valid.' });

    const row = rows[0];

    if (row.deleted_at) return res.status(410).json({ error: 'This draw has been deleted.' });

    // Only the giver's own row is selected, so nothing about other participants can leak
    return res.status(200).json({
      name: row.giver_name,
      match_name: row.receiver_name,
      created_at: row.created_at,
      organizer_name: row.emails_sent_at ? row.organizer_name : null,
    });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: 'Database error. Please try again.' });
  }
}
