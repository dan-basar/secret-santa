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
const ADMIN_KEY = 'Ab3dEf6hIj9kLm';

// The driver returns timestamptz columns as Date objects
const drawRow = {
  id: DRAW_ID,
  created_at: new Date('2026-10-01T12:00:00.000Z'),
  emails_sent_at: null,
  deleted_at: null,
};

// Positions with gaps, so the test shows matches map by position, not by row number
const participantRows = [
  { position: 10, name: 'Alex', email: 'alex@example.com', group_name: 'Smiths', reveal_token: 'Aa111111', email_sent_at: new Date('2026-10-02T09:00:00.000Z') },
  { position: 20, name: 'Sam', email: 'sam@example.com', group_name: null, reveal_token: 'Bb222222', email_sent_at: null },
  { position: 30, name: 'Jo', email: null, group_name: 'Smiths', reveal_token: 'Cc333333', email_sent_at: null },
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
  it('gives the organizer the matches, every personal reveal token and each email status', async () => {
    const res = await get({}, { 'x-admin-key': ADMIN_KEY });
    expect(res.statusCode).toBe(200);
    expect(res.body).toEqual({
      id: DRAW_ID,
      created_at: '2026-10-01T12:00:00.000Z',
      emails_sent_at: null,
      participants: participantRows.map(({ position: _position, ...p }) => ({ ...p, email_sent_at: p.email_sent_at?.toISOString() ?? null })),
      // Indexes into participants, which already carry each email and group
      matches: [{ giver: 0, receiver: 1 }, { giver: 1, receiver: 2 }, { giver: 2, receiver: 0 }],
    });
    expect(JSON.stringify(res.body)).not.toContain(ADMIN_KEY);
  });

  it('finds the draw, its participants and its matches by the admin key alone', async () => {
    await get({}, { 'x-admin-key': ADMIN_KEY });
    const queries = sentQueries();
    expect(queries).toHaveLength(3);
    for (const query of queries) expect(query.values).toEqual([ADMIN_KEY]);
  });

  it('returns 404 for an unknown key', async () => {
    vi.mocked(sql.transaction).mockImplementation((async () => [[], [], []]) as never);
    const res = await get({}, { 'x-admin-key': ADMIN_KEY });
    expect(res.statusCode).toBe(404);
    expect(res.body).toEqual({ error: 'Draw not found.' });
  });

  it('returns 404 without querying for a missing, malformed or query-string key', async () => {
    for (const [query, headers] of [
      [{}, {}],
      [{}, { 'x-admin-key': 'Ab3dEf6hIj9k' }], // cut short
      [{}, { 'x-admin-key': 'Ab3dEf6hIj9kL-' }], // not letters and digits
      [{ key: ADMIN_KEY }, {}],
    ] as [Record<string, unknown>, Record<string, string>][]) {
      const res = await get(query, headers);
      expect(res.statusCode).toBe(404);
      expect(res.body).toEqual({ error: 'Draw not found.' });
    }
    expect(sql.transaction).not.toHaveBeenCalled();
  });

  it('keeps draw data out of search engines', async () => {
    const res = await get({}, { 'x-admin-key': ADMIN_KEY });
    expect(res.headers['X-Robots-Tag']).toBe('noindex, nofollow');
  });

  it('keeps draw data out of every cache', async () => {
    const res = await get({}, { 'x-admin-key': ADMIN_KEY });
    expect(res.headers['Cache-Control']).toBe('private, no-store');
  });

  it('returns 410 for a deleted draw', async () => {
    queueRows({ ...drawRow, deleted_at: new Date('2026-10-03T12:00:00.000Z') });
    const res = await get({}, { 'x-admin-key': ADMIN_KEY });
    expect(res.statusCode).toBe(410);
    expect(res.body).toEqual({ error: 'This draw has been deleted.' });
  });

  it('answers a wrong method with 405, an Allow header and an error', async () => {
    const res = await get({}, {}, 'POST');
    expect(res.statusCode).toBe(405);
    expect(res.headers.Allow).toBe('GET');
    expect(res.body).toEqual({ error: 'Method not allowed.' });
  });
});
