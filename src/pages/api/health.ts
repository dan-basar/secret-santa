import type { NextApiRequest, NextApiResponse } from 'next';
import { sql } from '@/lib/db';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  try {
    await sql`SELECT 1`;
    res.status(200).json({ ok: true });
  } catch {
    res.status(503).json({ ok: false });
  }
}
