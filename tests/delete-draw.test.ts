import { describe, it, expect, vi, beforeEach } from 'vitest';
import { callRoute } from './helpers/fake-res';

// No database in tests: each sql`...` call resolves to the rows queued below
vi.mock('@/lib/db', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/db')>();
  return { ...actual, sql: vi.fn(async () => []) };
});

import handler from '@/pages/api/delete-draw';
import { sql } from '@/lib/db';

const DRAW_ID = '0b6f1c2a-8d3e-4f5a-9b7c-1d2e3f4a5b6c';
const ADMIN_KEY = 'Ab3dEf6hIj9kLm';

function post(body: Record<string, unknown>, method = 'POST') {
  return callRoute(handler, { method, body });
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
  it('soft-deletes the draw its key belongs to, in one query', async () => {
    vi.mocked(sql).mockResolvedValueOnce([{ id: DRAW_ID }]);
    const res = await post({ key: ADMIN_KEY });
    expect(res.statusCode).toBe(200);
    expect(res.body).toEqual({ success: true });
    expect(sql).toHaveBeenCalledOnce();
    // An already deleted draw matches too, keeping its first deletion time
    expect(queries()[0]).toContain('SET deleted_at = COALESCE(deleted_at, now())');
    expect(vi.mocked(sql).mock.calls[0].slice(1)).toEqual([ADMIN_KEY]);
  });

  it('never hard-deletes', async () => {
    vi.mocked(sql).mockResolvedValueOnce([{ id: DRAW_ID }]);
    await post({ key: ADMIN_KEY });
    expect(queries().some(q => /DELETE\s+FROM/i.test(q))).toBe(false);
  });

  it('rejects a missing or malformed key with 403 before touching the database', async () => {
    for (const key of [undefined, '', 42, 'wrong-key', ADMIN_KEY.slice(0, 13)]) {
      const res = await post({ key });
      expect(res.statusCode).toBe(403);
      expect(res.body).toEqual({ error: 'Only the organizer can delete this draw.' });
    }
    expect(sql).not.toHaveBeenCalled();
  });

  it('rejects a key that matches no draw with 403', async () => {
    const res = await post({ key: 'Zz9yXx8wVv7uTt' });
    expect(res.statusCode).toBe(403);
    expect(res.body).toEqual({ error: 'Only the organizer can delete this draw.' });
  });

  it('answers a wrong method with 405, an Allow header and an error', async () => {
    const res = await post({ key: ADMIN_KEY }, 'GET');
    expect(res.statusCode).toBe(405);
    expect(res.headers.Allow).toBe('POST');
    expect(res.body).toEqual({ error: 'Method not allowed.' });
    expect(sql).not.toHaveBeenCalled();
  });

  it('returns 500 with an error when the database fails', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.mocked(sql).mockRejectedValueOnce(new Error('Neon unreachable'));
    const res = await post({ key: ADMIN_KEY });
    expect(res.statusCode).toBe(500);
    expect(res.body).toEqual({ error: 'Database error. Please try again.' });
  });
});
