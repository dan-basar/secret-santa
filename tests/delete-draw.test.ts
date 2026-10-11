import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { NextApiRequest, NextApiResponse } from 'next';

// No database in tests: each sql`...` call resolves to the rows queued below
vi.mock('@/lib/db', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/db')>();
  return { ...actual, sql: vi.fn(async () => []) };
});

import handler from '@/pages/api/delete-draw';
import { sql } from '@/lib/db';

const DRAW_ID = '0b6f1c2a-8d3e-4f5a-9b7c-1d2e3f4a5b6c';
const ADMIN_KEY = 'admin-key-123';

const drawRow = { id: DRAW_ID, deleted_at: null, admin_key: ADMIN_KEY };

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

// The SQL text of every sql`...` call so far
function queries() {
  return vi.mocked(sql).mock.calls.map(([strings]) => (strings as unknown as string[]).join('$'));
}

beforeEach(() => {
  vi.mocked(sql).mockReset();
  vi.mocked(sql).mockResolvedValue([]);
});

describe('POST /api/delete-draw', () => {
  it('soft-deletes the draw with the right key', async () => {
    vi.mocked(sql).mockResolvedValueOnce([drawRow]);
    const res = await post({ id: DRAW_ID, key: ADMIN_KEY });
    expect(res.statusCode).toBe(200);
    expect(res.body).toEqual({ success: true });
    expect(queries()[1]).toContain('UPDATE Draws SET deleted_at = now()');
    expect(vi.mocked(sql).mock.calls[1].slice(1)).toEqual([DRAW_ID]);
  });

  it('never hard-deletes', async () => {
    vi.mocked(sql).mockResolvedValueOnce([drawRow]);
    await post({ id: DRAW_ID, key: ADMIN_KEY });
    expect(queries().some(q => /DELETE\s+FROM/i.test(q))).toBe(false);
  });

  it('succeeds again for an already deleted draw without updating it', async () => {
    vi.mocked(sql).mockResolvedValueOnce([{ ...drawRow, deleted_at: new Date('2026-10-03T12:00:00.000Z') }]);
    const res = await post({ id: DRAW_ID, key: ADMIN_KEY });
    expect(res.statusCode).toBe(200);
    expect(res.body).toEqual({ success: true });
    expect(sql).toHaveBeenCalledTimes(1);
  });

  it('rejects a wrong or missing key with 403 and changes nothing', async () => {
    for (const key of ['wrong-key', undefined, '']) {
      vi.mocked(sql).mockResolvedValueOnce([drawRow]);
      const res = await post({ id: DRAW_ID, key });
      expect(res.statusCode).toBe(403);
      expect(res.body).toEqual({ error: 'Only the organizer can delete this draw.' });
    }
    expect(queries().some(q => q.includes('UPDATE'))).toBe(false);
  });

  it('cannot delete an old draw with no stored admin key', async () => {
    vi.mocked(sql).mockResolvedValueOnce([{ ...drawRow, admin_key: null }]);
    const res = await post({ id: DRAW_ID, key: 'anything' });
    expect(res.statusCode).toBe(403);
    expect(sql).toHaveBeenCalledTimes(1);
  });

  it('returns 404 for an unknown draw', async () => {
    const res = await post({ id: DRAW_ID, key: ADMIN_KEY });
    expect(res.statusCode).toBe(404);
    expect(res.body).toEqual({ error: 'Draw not found.' });
  });

  it('returns 404 for a malformed id without querying', async () => {
    const res = await post({ id: 'not-a-uuid', key: ADMIN_KEY });
    expect(res.statusCode).toBe(404);
    expect(sql).not.toHaveBeenCalled();
  });

  it('returns 400 with an error for a missing id', async () => {
    for (const id of [undefined, 42]) {
      const res = await post({ id, key: ADMIN_KEY });
      expect(res.statusCode).toBe(400);
      expect(res.body).toEqual({ error: 'A draw id is required.' });
    }
    expect(sql).not.toHaveBeenCalled();
  });

  it('answers a wrong method with 405, an Allow header and an error', async () => {
    const res = await post({ id: DRAW_ID, key: ADMIN_KEY }, 'GET');
    expect(res.statusCode).toBe(405);
    expect(res.headers.Allow).toBe('POST');
    expect(res.body).toEqual({ error: 'Method not allowed.' });
    expect(sql).not.toHaveBeenCalled();
  });

  it('returns 500 with an error when the database fails', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.mocked(sql).mockRejectedValueOnce(new Error('Neon unreachable'));
    const res = await post({ id: DRAW_ID, key: ADMIN_KEY });
    expect(res.statusCode).toBe(500);
    expect(res.body).toEqual({ error: 'Database error. Please try again.' });
  });
});
