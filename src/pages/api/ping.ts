import type { NextApiRequest, NextApiResponse } from 'next';
import { getPool } from '@/lib/db';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  try {
    await (await getPool()).request().query('SELECT 1');
    res.status(200).json({ ok: true });
  } catch {
    res.status(200).json({ ok: false });
  }
}
