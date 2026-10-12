// GET /api/get-draw?id=<uuid>: one draw. Anyone may call it. The admin key, if
// any, comes in the X-Admin-Key header, never the query string, so it stays out
// of request logs. Without it: participant names only. With it: emails, groups,
// reveal tokens, per-person email status and matches (as positions in the
// participant list, which already carries each person's email and group).
// Returns 200; 400 missing id; 404 unknown draw; 410 deleted draw.

import type { NextApiRequest, NextApiResponse } from 'next';
import { sql, isUuid } from '@/lib/db';
import type { ApiError, GetDrawResponse } from '@/types/api';

interface DrawRow {
  id: string;
  created_at: Date;
  emails_sent_at: Date | null;
  deleted_at: Date | null;
  admin_key: string;
}

interface ParticipantRow {
  position: number;
  name: string;
  email: string | null;
  group_name: string | null;
  reveal_token: string;
  email_sent_at: Date | null;
}

interface MatchRow {
  giver_position: number;
  receiver_position: number;
}

export default async function handler(req: NextApiRequest, res: NextApiResponse<GetDrawResponse | ApiError>) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).json({ error: 'Method not allowed.' });
  }
  res.setHeader('X-Robots-Tag', 'noindex, nofollow');
  // The organizer's answer holds every email address and reveal token
  res.setHeader('Cache-Control', 'private, no-store');

  const { id } = req.query;
  const key = req.headers['x-admin-key'];
  if (!id || typeof id !== 'string') return res.status(400).json({ error: 'A draw id is required.' });
  if (!isUuid(id)) return res.status(404).json({ error: 'Draw not found.' });

  // The shared link sends no key, so it never runs the matches query
  const hasKey = typeof key === 'string' && key.length > 0;

  try {
    // All reads in one round trip and one consistent snapshot
    const [drawRows, participantRows, matchRows = []] = (await sql.transaction([
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
             position
            ,name
            ,email
            ,group_name
            ,reveal_token
            ,email_sent_at
        FROM Participants
        WHERE draw_id = ${id}::uuid
        ORDER BY position
      `,
      ...(hasKey ? [sql`
        SELECT
             givers.position as giver_position
            ,receivers.position as receiver_position
        FROM Matches as matches
             INNER JOIN Draws as draws ON matches.draw_id = draws.id
             INNER JOIN Participants as givers ON matches.giver_participant_id = givers.id
             INNER JOIN Participants as receivers ON matches.receiver_participant_id = receivers.id
        WHERE matches.draw_id = ${id}::uuid
             AND draws.admin_key = ${key} -- a wrong key gets no rows
        ORDER BY givers.position
      `] : []),
    ], { readOnly: true })) as [DrawRow[], ParticipantRow[], MatchRow[]?];

    if (!drawRows.length) return res.status(404).json({ error: 'Draw not found.' });

    const draw = drawRows[0];

    if (draw.deleted_at) return res.status(410).json({ error: 'This draw has been deleted.' });

    const isAdmin = hasKey && key === draw.admin_key;

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

    const indexByPosition = new Map(participantRows.map((p, i) => [p.position, i]));

    return res.status(200).json({
      ...base,
      isAdmin,
      participants: participantRows.map(p => ({
        name: p.name,
        email: p.email,
        group_name: p.group_name,
        reveal_token: p.reveal_token,
        email_sent_at: p.email_sent_at?.toISOString() ?? null,
      })),
      matches: matchRows.map(m => ({
        giver: indexByPosition.get(m.giver_position)!,
        receiver: indexByPosition.get(m.receiver_position)!,
      })),
    });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: 'Database error. Please try again.' });
  }
}
