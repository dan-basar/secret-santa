import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { NextApiRequest, NextApiResponse } from 'next';

vi.mock('@/lib/db', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/db')>();
  return { ...actual, sql: Object.assign(vi.fn(async () => []), { transaction: vi.fn(async () => []) }) };
});
vi.mock('@/lib/email', () => ({ sendOpsEmail: vi.fn(async () => {}) }));

import handler from '@/pages/api/ops-check';
import { sql } from '@/lib/db';

async function call(method: string, authorization?: string) {
  const res = {
    statusCode: 0,
    body: undefined as unknown,
    setHeader() { return this; },
    status(code: number) { this.statusCode = code; return this; },
    json(body: unknown) { this.body = body; return this; },
  };
  await handler({ method, headers: { authorization }, query: {} } as unknown as NextApiRequest, res as unknown as NextApiResponse);
  return res;
}

beforeEach(() => {
  vi.stubEnv('CRON_SECRET', 'cron-secret');
  vi.spyOn(console, 'error').mockImplementation(() => {});
  vi.mocked(sql).mockClear();
});

describe('GET /api/ops-check', () => {
  it('answers 405 to other methods', async () => {
    expect((await call('POST')).statusCode).toBe(405);
  });

  it('answers 500 and does nothing when CRON_SECRET is not set', async () => {
    vi.stubEnv('CRON_SECRET', '');
    expect((await call('GET', 'Bearer ')).statusCode).toBe(500);
    expect(sql.transaction).not.toHaveBeenCalled();
  });

  it('answers 403 without the right secret, before touching the database', async () => {
    expect((await call('GET')).statusCode).toBe(403);
    expect((await call('GET', 'Bearer wrong-secret')).statusCode).toBe(403);
    expect(sql.transaction).not.toHaveBeenCalled();
  });

  it('answers 500 when the database fails', async () => {
    vi.mocked(sql.transaction).mockRejectedValueOnce(new Error('Neon unreachable'));
    const res = await call('GET', 'Bearer cron-secret');
    expect(res.statusCode).toBe(500);
    expect(res.body).toEqual({ error: 'The check failed.' });
  });
});
