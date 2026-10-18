import { describe, it, expect, vi, beforeEach } from 'vitest';
import { callRoute } from './helpers/fake-res';

// No database in tests: each sql`...` call resolves to the rows queued below
vi.mock('@/lib/db', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/db')>();
  return { ...actual, sql: vi.fn(async () => []) };
});

import handler from '@/pages/api/save-details';
import { sql } from '@/lib/db';

const DRAW_ID = '0b6f1c2a-8d3e-4f5a-9b7c-1d2e3f4a5b6c';
const ADMIN_KEY = 'Ab3dEf6hIj9kLm';

// The draw as the lookup after a refused save finds it
const drawRow = { deleted_at: null, emails_sent_at: null };

function post(body: Record<string, unknown>, method = 'POST') {
  return callRoute(handler, { method, body });
}

beforeEach(() => {
  vi.mocked(sql).mockReset();
  vi.mocked(sql).mockResolvedValue([]);
});

describe('POST /api/save-details', () => {
  it('saves the details as the first send would, in one query, and returns them', async () => {
    vi.mocked(sql).mockResolvedValueOnce([{ id: DRAW_ID }]);
    const res = await post({ key: ADMIN_KEY, organizerNote: ' Wrap it ', budget: '25', exchangeDate: '2026-12-19' });
    expect(res.statusCode).toBe(200);
    expect(res.body).toEqual({ organizer_note: 'Wrap it', budget_cents: 2500, exchange_date: '2026-12-19' });
    expect(sql).toHaveBeenCalledOnce();
    expect(vi.mocked(sql).mock.calls[0].slice(1)).toEqual(['Wrap it', 2500, '2026-12-19', ADMIN_KEY]);
  });

  it('refuses what the first send would refuse, before touching the database', async () => {
    for (const body of [{ organizerNote: 'See bit.ly/x' }, { budget: 'ten' }, { exchangeDate: '2026-02-30' }, { budget: 30 }]) {
      const res = await post({ key: ADMIN_KEY, ...body });
      expect(res.statusCode).toBe(400);
    }
    expect(sql).not.toHaveBeenCalled();
  });

  it('answers 403 for a missing or malformed key without querying, and for a key that matches no draw', async () => {
    for (const key of [undefined, 'nope', 42]) expect((await post({ key })).statusCode).toBe(403);
    expect(sql).not.toHaveBeenCalled();
    const res = await post({ key: 'Zz9yXx8wVv7uTt' });
    expect(res.statusCode).toBe(403);
    expect(res.body).toEqual({ error: 'Only the organizer can change this draw.' });
  });

  it('answers 410 once deleted and 409 once the emails are sent, looking up why only after the save is refused', async () => {
    vi.mocked(sql).mockResolvedValueOnce([]).mockResolvedValueOnce([{ ...drawRow, deleted_at: new Date() }]);
    expect((await post({ key: ADMIN_KEY })).statusCode).toBe(410);
    vi.mocked(sql).mockResolvedValueOnce([]).mockResolvedValueOnce([{ ...drawRow, emails_sent_at: new Date() }]);
    const sent = await post({ key: ADMIN_KEY });
    expect(sent.statusCode).toBe(409);
    expect(sent.body).toEqual({ error: 'The emails have gone out, so the details can no longer be changed.' });
    expect(sql).toHaveBeenCalledTimes(4);
  });

  it('answers 409 when a failed first send reopened the draw in between', async () => {
    vi.mocked(sql).mockResolvedValueOnce([]).mockResolvedValueOnce([drawRow]);
    const res = await post({ key: ADMIN_KEY, budget: '10' });
    expect(res.statusCode).toBe(409);
    expect(res.body).toEqual({ error: 'This draw changed while you were saving. Refresh the page and try again.' });
  });

  it('answers 405 for other methods', async () => {
    const res = await post({}, 'GET');
    expect(res.statusCode).toBe(405);
    expect(res.headers.Allow).toBe('POST');
  });
});
