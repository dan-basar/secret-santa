import type { NextApiRequest, NextApiResponse } from 'next';
import { sql, isUuid } from '@/lib/db';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') return res.status(405).end();

  const { id, key } = req.body;
  if (!id || typeof id !== 'string') return res.status(400).end();
  if (!isUuid(id)) return res.status(404).json({ error: 'Draw not found.' });
  if (!key || typeof key !== 'string') return res.status(403).json({ error: 'Only the organizer can delete this draw.' });

  try {
    const drawRows = await sql`
      SELECT
           id
          ,deleted_at
          ,admin_key
      FROM Draws
      WHERE id = ${id}::uuid
    `;

    if (!drawRows.length) return res.status(404).json({ error: 'Draw not found.' });

    // Old draws with no stored admin_key never match, so they can't be deleted
    if (key !== drawRows[0].admin_key) return res.status(403).json({ error: 'Only the organizer can delete this draw.' });

    if (!drawRows[0].deleted_at) {
      await sql`UPDATE Draws SET deleted_at = now() WHERE id = ${id}::uuid`;
    }

    return res.status(200).json({ success: true }); // covers newly deleted and already deleted
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: 'Database error. Please try again.' });
  }
}
