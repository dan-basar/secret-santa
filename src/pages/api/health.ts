// GET /api/health: database liveness check. Anyone may call it.
// Returns 200 { ok: true }, or 503 { ok: false, error } when the database is
// unreachable. Any method works, so HEAD-only uptime monitors can use it too.

import type { NextApiRequest, NextApiResponse } from 'next';
import { sql } from '@/lib/db';
import type { HealthResponse } from '@/types/api';

export default async function handler(req: NextApiRequest, res: NextApiResponse<HealthResponse>) {
  try {
    await sql`SELECT 1`;
    res.status(200).json({ ok: true });
  } catch {
    res.status(503).json({ ok: false, error: 'Database unreachable.' });
  }
}
