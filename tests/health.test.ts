import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { NextApiRequest, NextApiResponse } from 'next';

// No database in tests: the sql`SELECT 1` call resolves or rejects as queued below
vi.mock('@/lib/db', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/db')>();
  return { ...actual, sql: vi.fn(async () => []) };
});

import handler from '@/pages/api/health';
import { sql } from '@/lib/db';

async function get(method = 'GET') {
  const res = {
    statusCode: 0,
    body: undefined as unknown,
    status(code: number) {
      this.statusCode = code;
      return this;
    },
    json(body: unknown) {
      this.body = body;
      return this;
    },
  };
  await handler({ method } as NextApiRequest, res as unknown as NextApiResponse);
  return res;
}

beforeEach(() => {
  vi.mocked(sql).mockReset();
  vi.mocked(sql).mockResolvedValue([{ '?column?': 1 }]);
});

describe('GET /api/health', () => {
  it('returns 200 { ok: true } when the database answers', async () => {
    const res = await get();
    expect(res.statusCode).toBe(200);
    expect(res.body).toEqual({ ok: true });
    expect(sql).toHaveBeenCalledOnce();
  });

  it('returns 503 with ok: false and an error when the database is unreachable', async () => {
    vi.mocked(sql).mockRejectedValueOnce(new Error('Neon unreachable'));
    const res = await get();
    expect(res.statusCode).toBe(503);
    expect(res.body).toEqual({ ok: false, error: 'Database unreachable.' });
  });

  it('answers HEAD too, for uptime monitors', async () => {
    const res = await get('HEAD');
    expect(res.statusCode).toBe(200);
  });
});
