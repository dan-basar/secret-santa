// GET /api/health: database liveness check. Anyone may call it.
// Returns 200 { ok: true }, or 503 { ok: false } when the database is unreachable.

import type { NextApiRequest, NextApiResponse } from 'next';
import { sql } from '@/lib/db';
import type { HealthResponse } from '@/types/api';

export default async function handler(req: NextApiRequest, res: NextApiResponse<HealthResponse>) {
  try {
    await sql`SELECT 1`;
    res.status(200).json({ ok: true });
  } catch {
    res.status(503).json({ ok: false });
  }
}
