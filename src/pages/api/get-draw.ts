// GET /api/get-draw: the organizer's view of one draw, found by its admin key.
// The key comes in the X-Admin-Key header, never the query string, so it stays
// out of request logs. Returns the participants with their emails, groups,
// reveal tokens and per-person email status, the matches (as positions in the
// participant list, which already carries each person's email and group), and
// the organizer's exchange details (note, budget and date) when set, and the
// organizer's name once the emails have gone out.
// Returns 200; 404 missing, malformed or unknown key; 410 deleted draw.

import type { NextApiRequest, NextApiResponse } from 'next';
import { reportError } from '@/lib/report';
import { sql } from '@/lib/db';
import { isAdminKey } from '@/lib/tokens';
import type { ApiError, GetDrawResponse } from '@/types/api';

interface DrawRow {
  created_at: Date;
  emails_sent_at: Date | null;
  deleted_at: Date | null;
  organizer_name: string | null;
  organizer_note: string | null;
  budget_cents: number | null;
  exchange_date: string | null;
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
  // The answer holds every email address and reveal token
  res.setHeader('Cache-Control', 'private, no-store');

  const key = req.headers['x-admin-key'];
  if (typeof key !== 'string' || !isAdminKey(key)) return res.status(404).json({ error: 'Draw not found.' });

  try {
    // All reads in one round trip and one consistent snapshot
    const [drawRows, participantRows, matchRows] = (await sql.transaction([
      sql`
        SELECT
             created_at
            ,emails_sent_at
            ,deleted_at
            ,organizer_name
            ,organizer_note
            ,budget_cents
            ,to_char(exchange_date, 'YYYY-MM-DD') as exchange_date
        FROM Draws
        WHERE admin_key = ${key}
      `,
      sql`
        SELECT
             participants.position
            ,participants.name
            ,participants.email
            ,participants.group_name
            ,participants.reveal_code as reveal_token
            ,participants.email_sent_at
        FROM Participants as participants
             INNER JOIN Draws as draws ON participants.draw_id = draws.id
        WHERE draws.admin_key = ${key}
        ORDER BY participants.position
      `,
      sql`
        SELECT
             givers.position as giver_position
            ,receivers.position as receiver_position
        FROM Matches as matches
             INNER JOIN Draws as draws ON matches.draw_id = draws.id
             INNER JOIN Participants as givers ON matches.giver_participant_id = givers.id
             INNER JOIN Participants as receivers ON matches.receiver_participant_id = receivers.id
        WHERE draws.admin_key = ${key}
        ORDER BY givers.position
      `,
    ], { readOnly: true })) as [DrawRow[], ParticipantRow[], MatchRow[]];

    if (!drawRows.length) return res.status(404).json({ error: 'Draw not found.' });

    const draw = drawRows[0];

    if (draw.deleted_at) return res.status(410).json({ error: 'This draw has been deleted.' });

    const indexByPosition = new Map(participantRows.map((p, i) => [p.position, i]));

    return res.status(200).json({
      created_at: draw.created_at.toISOString(),
      emails_sent_at: draw.emails_sent_at?.toISOString() ?? null,
      organizer_name: draw.organizer_name,
      organizer_note: draw.organizer_note,
      budget_cents: draw.budget_cents,
      exchange_date: draw.exchange_date,
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
    await reportError(err);
    return res.status(500).json({ error: 'Database error. Please try again.' });
  }
}
