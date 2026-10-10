import type { NextApiRequest, NextApiResponse } from 'next';
import { sql, isUuid } from '@/lib/db';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') return res.status(405).end();

  const { id, key } = req.query;
  if (!id || typeof id !== 'string') return res.status(400).end();
  if (!isUuid(id)) return res.status(404).json({ error: 'Draw not found.' });

  try {
    // All three reads in one round trip and one consistent snapshot
    const [drawRows, participantRows, matchRows] = await sql.transaction([
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
    ], { readOnly: true });

    if (!drawRows.length) return res.status(404).json({ error: 'Draw not found.' });

    const draw = drawRows[0];

    if (draw.deleted_at) return res.status(410).json({ deleted: true });

    const isAdmin = typeof key === 'string' && key === draw.admin_key;
    const participantsWithEmailCount = participantRows.filter(p => p.email).length;

    const base = {
      id: draw.id,
      created_at: draw.created_at,
      emails_sent_at: draw.emails_sent_at,
      isAdmin,
    };

    // Pairings stay private on the shared link: each participant sees their
    // own match through their personal reveal link instead
    if (!isAdmin) {
      return res.status(200).json({
        ...base,
        participants: participantRows.map(p => ({ name: p.name })),
      });
    }

    return res.status(200).json({
      ...base,
      participantsWithEmailCount,
      participants: participantRows,
      matches: matchRows,
    });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: 'Database error. Please try again.' });
  }
}
