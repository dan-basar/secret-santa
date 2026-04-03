import type { NextApiRequest, NextApiResponse } from 'next';
import { getPool, withRetry, sql } from '@/lib/db';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') return res.status(405).end();

  const { id, key } = req.query;
  if (!id || typeof id !== 'string') return res.status(400).end();

  try {
    const data = await withRetry(async () => {
      const pool = await getPool();

      const r1 = new sql.Request(pool);
      const drawResult = await r1
        .input('drawId', sql.UniqueIdentifier, id)
        .query(`SELECT id, created_at, emails_sent_at, deleted_at, admin_key FROM Draws WHERE id = @drawId`);

      if (!drawResult.recordset.length) return null;

      const draw = drawResult.recordset[0];

      const r2 = new sql.Request(pool);
      const participantsResult = await r2
        .input('drawId', sql.UniqueIdentifier, id)
        .query(`SELECT id, name, email, group_name FROM Participants WHERE draw_id = @drawId`);

      const r3 = new sql.Request(pool);
      const matchesResult = await r3
        .input('drawId', sql.UniqueIdentifier, id)
        .query(`
          SELECT
            g.name AS giver_name,
            g.email AS giver_email,
            g.group_name AS giver_group,
            rv.name AS receiver_name,
            rv.group_name AS receiver_group
          FROM Matches m
          JOIN Participants g ON m.giver_participant_id = g.id
          JOIN Participants rv ON m.receiver_participant_id = rv.id
          WHERE m.draw_id = @drawId
        `);

      return { draw, participants: participantsResult.recordset, matches: matchesResult.recordset };
    });

    if (!data) return res.status(404).json({ error: 'Draw not found.' });

    if (data.draw.deleted_at) return res.status(410).json({ deleted: true });

    const isAdmin = typeof key === 'string' && key === data.draw.admin_key;
    const participantsWithEmailCount = data.participants.filter((p: { email: string | null }) => p.email).length;

    const participants = isAdmin
      ? data.participants
      : data.participants.map(({ email: _email, ...rest }: { email: string | null; [k: string]: unknown }) => rest);

    const matches = isAdmin
      ? data.matches
      : data.matches.map(({ giver_email: _ge, ...rest }: { giver_email: string | null; [k: string]: unknown }) => rest);

    return res.status(200).json({
      id: data.draw.id,
      created_at: data.draw.created_at,
      emails_sent_at: data.draw.emails_sent_at,
      isAdmin,
      participantsWithEmailCount,
      participants,
      matches,
    });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: 'Database error. Please try again.' });
  }
}
