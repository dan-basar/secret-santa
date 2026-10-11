// GET /api/get-draw?id=<uuid>: one draw. Anyone may call it. The admin key, if
// any, comes in the X-Admin-Key header, never the query string, so it stays out
// of request logs. Without it: participant names only. With it: emails, groups,
// reveal tokens, per-person email status and matches.
// Returns 200; 400 missing id; 404 unknown draw; 410 deleted draw.

import type { NextApiRequest, NextApiResponse } from 'next';
import { sql, isUuid } from '@/lib/db';
import type { AdminMatch, ApiError, GetDrawResponse } from '@/types/api';

interface DrawRow {
  id: string;
  created_at: Date;
  emails_sent_at: Date | null;
  deleted_at: Date | null;
  admin_key: string | null;
}

interface ParticipantRow {
  name: string;
  email: string | null;
  group_name: string | null;
  reveal_token: string;
  email_sent_at: Date | null;
}

export default async function handler(req: NextApiRequest, res: NextApiResponse<GetDrawResponse | ApiError>) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).json({ error: 'Method not allowed.' });
  }
  res.setHeader('X-Robots-Tag', 'noindex, nofollow');

  const { id } = req.query;
  const key = req.headers['x-admin-key'];
  if (!id || typeof id !== 'string') return res.status(400).json({ error: 'A draw id is required.' });
  if (!isUuid(id)) return res.status(404).json({ error: 'Draw not found.' });

  try {
    // All three reads in one round trip and one consistent snapshot
    const [drawRows, participantRows, matchRows] = (await sql.transaction([
      sql`
        SELECT
             id
            ,created_at
            ,emails_sent_at
            ,deleted_at
            ,admin_key
        FROM Draws
        WHERE id = ${id}::uuid
      `,
      sql`
        SELECT
             name
            ,email
            ,group_name
            ,reveal_token
            ,email_sent_at
        FROM Participants
        WHERE draw_id = ${id}::uuid
        ORDER BY position
      `,
      sql`
        SELECT
             givers.name as giver_name
            ,givers.email as giver_email
            ,givers.group_name as giver_group
            ,receivers.name as receiver_name
            ,receivers.group_name as receiver_group
        FROM Matches as matches
             INNER JOIN Participants as givers ON matches.giver_participant_id = givers.id
             INNER JOIN Participants as receivers ON matches.receiver_participant_id = receivers.id
        WHERE matches.draw_id = ${id}::uuid
        ORDER BY givers.position
      `,
    ], { readOnly: true })) as [DrawRow[], ParticipantRow[], AdminMatch[]];

    if (!drawRows.length) return res.status(404).json({ error: 'Draw not found.' });

    const draw = drawRows[0];

    if (draw.deleted_at) return res.status(410).json({ error: 'This draw has been deleted.' });

    const isAdmin = typeof key === 'string' && key === draw.admin_key;
    const participantsWithEmailCount = participantRows.filter(p => p.email).length;

    const base = {
      id: draw.id,
      created_at: draw.created_at.toISOString(),
      emails_sent_at: draw.emails_sent_at?.toISOString() ?? null,
    };

    // Pairings stay private on the shared link: each participant sees their
    // own match through their personal reveal link instead
    if (!isAdmin) {
      return res.status(200).json({
        ...base,
        isAdmin,
        participants: participantRows.map(p => ({ name: p.name })),
      });
    }

    return res.status(200).json({
      ...base,
      isAdmin,
      participantsWithEmailCount,
      participants: participantRows.map(p => ({ ...p, email_sent_at: p.email_sent_at?.toISOString() ?? null })),
      matches: matchRows,
    });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: 'Database error. Please try again.' });
  }
}
