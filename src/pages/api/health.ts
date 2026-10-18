// GET /api/health: liveness check for the uptime monitor. Anyone may call it.
// Returns 200 { ok: true }, showing the site's functions run. It never touches
// the database, so polling it every few minutes doesn't keep Neon awake (the
// daily check job exercises the database). Any method works, so HEAD-only
// uptime monitors can use it too.

import type { NextApiRequest, NextApiResponse } from 'next';
import type { HealthResponse } from '@/types/api';

export default function handler(_req: NextApiRequest, res: NextApiResponse<HealthResponse>) {
  res.status(200).json({ ok: true });
}
