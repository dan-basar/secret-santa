import type { NextApiRequest, NextApiResponse } from 'next';
import { ping } from '@/lib/db';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  try {
    await ping();
    res.status(200).json({ ok: true });
  } catch {
    res.status(503).json({ ok: false });
  }
}
