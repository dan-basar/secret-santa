import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { NextApiRequest, NextApiResponse } from 'next';

// No database in tests: each sql`...` call resolves to the rows queued below
vi.mock('@/lib/db', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/db')>();
  return { ...actual, sql: vi.fn(async () => []) };
});

import handler from '@/pages/api/reveal';
import { sql } from '@/lib/db';

const TOKEN = '3f2a9c1e-5b7d-4e8a-9c21-7d4e5f6a8b90';

const row = {
  giver_name: 'Alex',
  receiver_name: 'Sam',
  created_at: '2026-10-01T12:00:00.000Z',
  emails_sent_at: '2026-10-02T12:00:00.000Z',
  organizer_name: 'Pat',
  deleted_at: null,
};

async function get(query: Record<string, unknown>) {
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
    end() {
      return this;
    },
  };
  await handler({ method: 'GET', query } as unknown as NextApiRequest, res as unknown as NextApiResponse);
  return res;
}

beforeEach(() => {
  vi.mocked(sql).mockReset();
  vi.mocked(sql).mockResolvedValue([]);
});

describe('GET /api/reveal', () => {
  it('returns only the giver, their match, the draw date and the organizer', async () => {
    vi.mocked(sql).mockResolvedValueOnce([row]);
    const res = await get({ token: TOKEN });
    expect(res.statusCode).toBe(200);
    expect(res.body).toEqual({
      name: 'Alex',
      match_name: 'Sam',
      created_at: '2026-10-01T12:00:00.000Z',
      organizer_name: 'Pat',
    });
    expect(res.headers['Cache-Control']).toBe('no-store');
  });

  it('looks the participant up by the token as a bound parameter', async () => {
    vi.mocked(sql).mockResolvedValueOnce([row]);
    await get({ token: TOKEN });
    expect(vi.mocked(sql).mock.calls[0].slice(1)).toEqual([TOKEN]);
  });

  it('leaves out the organizer until emails are sent', async () => {
    vi.mocked(sql).mockResolvedValueOnce([{ ...row, emails_sent_at: null, organizer_name: null }]);
    const res = await get({ token: TOKEN });
    expect(res.statusCode).toBe(200);
    expect(res.body).toMatchObject({ organizer_name: null });
  });

  it('returns 404 for an unknown token', async () => {
    const res = await get({ token: TOKEN });
    expect(res.statusCode).toBe(404);
    expect(res.body).toEqual({ error: 'This link is not valid.' });
  });

  it('returns 404 for a missing or malformed token without querying', async () => {
    for (const query of [{}, { token: 'not-a-uuid' }, { token: [TOKEN, TOKEN] }]) {
      const res = await get(query);
      expect(res.statusCode).toBe(404);
      expect(res.body).toEqual({ error: 'This link is not valid.' });
    }
    expect(sql).not.toHaveBeenCalled();
  });

  it('returns 410 for a deleted draw without revealing the match', async () => {
    vi.mocked(sql).mockResolvedValueOnce([{ ...row, deleted_at: '2026-10-03T12:00:00.000Z' }]);
    const res = await get({ token: TOKEN });
    expect(res.statusCode).toBe(410);
    expect(JSON.stringify(res.body)).not.toContain('Sam');
  });
});
