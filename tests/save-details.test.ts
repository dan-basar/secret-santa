import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { NextApiRequest, NextApiResponse } from 'next';

// No database in tests: each sql`...` call resolves to the rows queued below
vi.mock('@/lib/db', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/db')>();
  return { ...actual, sql: vi.fn(async () => []) };
});

import handler from '@/pages/api/save-details';
import { sql } from '@/lib/db';

const DRAW_ID = '0b6f1c2a-8d3e-4f5a-9b7c-1d2e3f4a5b6c';
const ADMIN_KEY = 'Ab3dEf6hIj9kLm';

const drawRow = { admin_key: ADMIN_KEY, deleted_at: null, emails_sent_at: null };

async function post(body: Record<string, unknown>, method = 'POST') {
  const res = {
    statusCode: 0,
    body: undefined as unknown,
    headers: {} as Record<string, string>,
    setHeader(name: string, value: string) {
      this.headers[name] = value;
      return this;
    },
    status(code: number) {
      this.statusCode = code;
      return this;
    },
    json(body: unknown) {
      this.body = body;
      return this;
    },
  };
  await handler({ method, body } as unknown as NextApiRequest, res as unknown as NextApiResponse);
  return res;
}

beforeEach(() => {
  vi.mocked(sql).mockReset();
  vi.mocked(sql).mockResolvedValue([]);
});

describe('POST /api/save-details', () => {
  it('saves the details as the first send would, and returns them', async () => {
    vi.mocked(sql).mockResolvedValueOnce([drawRow]).mockResolvedValueOnce([{ id: DRAW_ID }]);
    const res = await post({ id: DRAW_ID, key: ADMIN_KEY, organizerNote: ' Wrap it ', budget: '25', exchangeDate: '2026-12-19' });
    expect(res.statusCode).toBe(200);
    expect(res.body).toEqual({ organizer_note: 'Wrap it', budget_cents: 2500, exchange_date: '2026-12-19' });
    expect(vi.mocked(sql).mock.calls[1].slice(1)).toEqual(['Wrap it', 2500, '2026-12-19', DRAW_ID]);
  });

  it('refuses what the first send would refuse, before touching the database', async () => {
    for (const body of [{ organizerNote: 'See bit.ly/x' }, { budget: 'ten' }, { exchangeDate: '2026-02-30' }, { budget: 30 }]) {
      const res = await post({ id: DRAW_ID, key: ADMIN_KEY, ...body });
      expect(res.statusCode).toBe(400);
    }
    expect(sql).not.toHaveBeenCalled();
  });

  it('answers 403 for a wrong key, 410 once deleted and 409 once the emails are sent', async () => {
    vi.mocked(sql).mockResolvedValueOnce([drawRow]);
    expect((await post({ id: DRAW_ID, key: 'Zz9yXx8wVv7uTt' })).statusCode).toBe(403);
    vi.mocked(sql).mockResolvedValueOnce([{ ...drawRow, deleted_at: new Date() }]);
    expect((await post({ id: DRAW_ID, key: ADMIN_KEY })).statusCode).toBe(410);
    vi.mocked(sql).mockResolvedValueOnce([{ ...drawRow, emails_sent_at: new Date() }]);
    expect((await post({ id: DRAW_ID, key: ADMIN_KEY })).statusCode).toBe(409);
    expect(sql).toHaveBeenCalledTimes(3);
  });

  it('answers 409 when a send lands between the check and the save', async () => {
    vi.mocked(sql).mockResolvedValueOnce([drawRow]).mockResolvedValueOnce([]);
    expect((await post({ id: DRAW_ID, key: ADMIN_KEY, budget: '10' })).statusCode).toBe(409);
  });

  it('answers 404 for an unknown or malformed id and 405 for other methods', async () => {
    expect((await post({ id: DRAW_ID, key: ADMIN_KEY })).statusCode).toBe(404);
    expect((await post({ id: 'nope', key: ADMIN_KEY })).statusCode).toBe(404);
    const res = await post({}, 'GET');
    expect(res.statusCode).toBe(405);
    expect(res.headers.Allow).toBe('POST');
  });
});
