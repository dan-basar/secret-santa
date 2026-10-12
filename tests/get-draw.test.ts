import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { NextApiRequest, NextApiResponse } from 'next';

// No database in tests: each query becomes its bound values and the
// transaction resolves to the rows queued below
vi.mock('@/lib/db', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/db')>();
  const sql = Object.assign(
    vi.fn((_strings: TemplateStringsArray, ...values: unknown[]) => ({ values })),
    { transaction: vi.fn(async () => [] as unknown[]) },
  );
  return { ...actual, sql };
});

import handler from '@/pages/api/get-draw';
import { sql } from '@/lib/db';

const DRAW_ID = '0b6f1c2a-8d3e-4f5a-9b7c-1d2e3f4a5b6c';
const ADMIN_KEY = 'admin-key-123';

// The driver returns timestamptz columns as Date objects
const drawRow = {
  id: DRAW_ID,
  created_at: new Date('2026-10-01T12:00:00.000Z'),
  emails_sent_at: null,
  deleted_at: null,
  admin_key: ADMIN_KEY,
};

// Positions with gaps, so the test shows matches map by position, not by row number
const participantRows = [
  { position: 10, name: 'Alex', email: 'alex@example.com', group_name: 'Smiths', reveal_token: '11111111-1111-4111-8111-111111111111', email_sent_at: new Date('2026-10-02T09:00:00.000Z') },
  { position: 20, name: 'Sam', email: 'sam@example.com', group_name: null, reveal_token: '22222222-2222-4222-8222-222222222222', email_sent_at: null },
  { position: 30, name: 'Jo', email: null, group_name: 'Smiths', reveal_token: '33333333-3333-4333-8333-333333333333', email_sent_at: null },
];

// Alex -> Sam -> Jo -> Alex
const matchRows = [
  { giver_position: 10, receiver_position: 20 },
  { giver_position: 20, receiver_position: 30 },
  { giver_position: 30, receiver_position: 10 },
];

async function get(query: Record<string, unknown>, headers: Record<string, string> = {}, method = 'GET') {
  const res = {
    statusCode: 0,
    body: undefined as unknown,
    headers: {} as Record<string, string>,
    setHeader(name: string, value: string) {
      this.headers[name] = value;
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
  await handler({ method, query, headers } as unknown as NextApiRequest, res as unknown as NextApiResponse);
  return res;
}

// Answers only the queries the handler sends, like the database would
function queueRows(draw: Record<string, unknown>) {
  vi.mocked(sql.transaction).mockImplementation((async (queries: unknown[]) =>
    [[draw], participantRows, matchRows].slice(0, queries.length)) as never);
}

// The queries passed to the transaction, each with its bound values
function sentQueries() {
  return vi.mocked(sql.transaction).mock.calls[0][0] as unknown as { values: unknown[] }[];
}

beforeEach(() => {
  vi.mocked(sql.transaction).mockReset();
  queueRows(drawRow);
});

describe('GET /api/get-draw', () => {
  it('gives the shared link participant names only, with no pairings, emails, groups or tokens', async () => {
    for (const headers of [{}, { 'x-admin-key': 'wrong-key' }] as Record<string, string>[]) {
      const res = await get({ id: DRAW_ID }, headers);
      expect(res.statusCode).toBe(200);
      expect(res.body).toEqual({
        id: DRAW_ID,
        created_at: '2026-10-01T12:00:00.000Z',
        emails_sent_at: null,
        isAdmin: false,
        participants: [{ name: 'Alex' }, { name: 'Sam' }, { name: 'Jo' }],
      });

      const serialized = JSON.stringify(res.body);
      for (const p of participantRows) {
        expect(serialized).not.toContain(p.reveal_token);
        if (p.email) expect(serialized).not.toContain(p.email);
      }
      expect(serialized).not.toContain('Smiths');
      expect(serialized).not.toContain('email_sent_at');
      expect(serialized).not.toContain('2026-10-02T09:00:00.000Z');
      expect(serialized).not.toContain(ADMIN_KEY);
    }
  });

  it('gives the organizer the matches, every personal reveal token and each email status', async () => {
    const res = await get({ id: DRAW_ID }, { 'x-admin-key': ADMIN_KEY });
    expect(res.statusCode).toBe(200);
    expect(res.body).toEqual({
      id: DRAW_ID,
      created_at: '2026-10-01T12:00:00.000Z',
      emails_sent_at: null,
      isAdmin: true,
      participants: participantRows.map(({ position: _position, ...p }) => ({ ...p, email_sent_at: p.email_sent_at?.toISOString() ?? null })),
      // Indexes into participants, which already carry each email and group
      matches: [{ giver: 0, receiver: 1 }, { giver: 1, receiver: 2 }, { giver: 2, receiver: 0 }],
    });
    expect(JSON.stringify(res.body)).not.toContain(ADMIN_KEY);
  });

  it('skips the matches query on the shared link', async () => {
    await get({ id: DRAW_ID });
    expect(sentQueries()).toHaveLength(2);
  });

  it('only returns match rows for the draw\'s own admin key', async () => {
    await get({ id: DRAW_ID }, { 'x-admin-key': ADMIN_KEY });
    const queries = sentQueries();
    expect(queries).toHaveLength(3);
    expect(queries[2].values).toEqual([DRAW_ID, ADMIN_KEY]);
  });

  it('ignores an admin key in the query string', async () => {
    const res = await get({ id: DRAW_ID, key: ADMIN_KEY });
    expect(res.statusCode).toBe(200);
    expect(res.body).toMatchObject({ isAdmin: false, participants: [{ name: 'Alex' }, { name: 'Sam' }, { name: 'Jo' }] });
    expect(JSON.stringify(res.body)).not.toContain('alex@example.com');
  });

  it('keeps draw data out of search engines', async () => {
    const res = await get({ id: DRAW_ID });
    expect(res.headers['X-Robots-Tag']).toBe('noindex, nofollow');
  });

  it('keeps draw data out of every cache', async () => {
    const res = await get({ id: DRAW_ID });
    expect(res.headers['Cache-Control']).toBe('private, no-store');
  });

  it('returns 410 for a deleted draw', async () => {
    queueRows({ ...drawRow, deleted_at: new Date('2026-10-03T12:00:00.000Z') });
    const res = await get({ id: DRAW_ID }, { 'x-admin-key': ADMIN_KEY });
    expect(res.statusCode).toBe(410);
    expect(res.body).toEqual({ error: 'This draw has been deleted.' });
  });

  it('returns 400 with an error for a missing id', async () => {
    for (const query of [{}, { id: [DRAW_ID, DRAW_ID] }]) {
      const res = await get(query);
      expect(res.statusCode).toBe(400);
      expect(res.body).toEqual({ error: 'A draw id is required.' });
    }
    expect(sql.transaction).not.toHaveBeenCalled();
  });

  it('answers a wrong method with 405, an Allow header and an error', async () => {
    const res = await get({ id: DRAW_ID }, {}, 'POST');
    expect(res.statusCode).toBe(405);
    expect(res.headers.Allow).toBe('GET');
    expect(res.body).toEqual({ error: 'Method not allowed.' });
  });

  it('returns 404 for a malformed id without querying', async () => {
    const res = await get({ id: 'not-a-uuid' });
    expect(res.statusCode).toBe(404);
    expect(sql.transaction).not.toHaveBeenCalled();
  });
});
