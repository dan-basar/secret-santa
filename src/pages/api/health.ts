// GET /api/health: database liveness check. Anyone may call it.
// Returns 200 { ok: true }, or 503 { ok: false, error } when the database is
// unreachable. Any method works, so HEAD-only uptime monitors can use it too.
// With ?shallow=1 it skips the database and only shows that the site's functions
// run, so the uptime monitor can poll every few minutes without keeping Neon awake.

import type { NextApiRequest, NextApiResponse } from 'next';
import { sql } from '@/lib/db';
import type { HealthResponse } from '@/types/api';

export default async function handler(req: NextApiRequest, res: NextApiResponse<HealthResponse>) {
  if (req.query.shallow === '1') return res.status(200).json({ ok: true });

  try {
    await sql`SELECT 1`;
    res.status(200).json({ ok: true });
  } catch {
    res.status(503).json({ ok: false, error: 'Database unreachable.' });
  }
}
