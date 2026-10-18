// POST /api/delete-draw: soft-deletes a draw (sets deleted_at). Idempotent.
// Admin key required. Body: { key }.
// Returns 200 { success: true }, also when already deleted; 403 missing,
// malformed or unknown key.

import type { NextApiRequest, NextApiResponse } from 'next';
import { reportError } from '@/lib/report';
import { sql } from '@/lib/db';
import { isAdminKey } from '@/lib/tokens';
import type { ApiError, DeleteDrawResponse } from '@/types/api';

export default async function handler(req: NextApiRequest, res: NextApiResponse<DeleteDrawResponse | ApiError>) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method not allowed.' });
  }

  const { key } = req.body;
  if (typeof key !== 'string' || !isAdminKey(key)) return res.status(403).json({ error: 'Only the organizer can delete this draw.' });

  try {
    // One round trip; a draw that was already deleted keeps its first deletion time
    const deleted = await sql`
      UPDATE Draws
      SET deleted_at = COALESCE(deleted_at, now())
      WHERE admin_key = ${key}
      RETURNING id
    `;
    if (!deleted.length) return res.status(403).json({ error: 'Only the organizer can delete this draw.' });

    return res.status(200).json({ success: true }); // covers newly deleted and already deleted
  } catch (err) {
    await reportError(err);
    return res.status(500).json({ error: 'Database error. Please try again.' });
  }
}
