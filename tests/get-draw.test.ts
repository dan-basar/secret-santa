import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { NextApiRequest, NextApiResponse } from 'next';

// No database in tests: queries become inert values and the transaction
// resolves to the rows queued below
vi.mock('@/lib/db', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/db')>();
  const sql = Object.assign(vi.fn(() => ({})), { transaction: vi.fn(async () => [] as unknown[]) });
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

const participantRows = [
  { name: 'Alex', email: 'alex@example.com', group_name: 'Smiths', reveal_token: '11111111-1111-4111-8111-111111111111', email_sent_at: new Date('2026-10-02T09:00:00.000Z') },
  { name: 'Sam', email: 'sam@example.com', group_name: null, reveal_token: '22222222-2222-4222-8222-222222222222', email_sent_at: null },
  { name: 'Jo', email: null, group_name: 'Smiths', reveal_token: '33333333-3333-4333-8333-333333333333', email_sent_at: null },
];

const matchRows = [
  { giver_name: 'Alex', giver_email: 'alex@example.com', giver_group: 'Smiths', receiver_name: 'Sam', receiver_group: null },
  { giver_name: 'Sam', giver_email: 'sam@example.com', giver_group: null, receiver_name: 'Jo', receiver_group: 'Smiths' },
  { giver_name: 'Jo', giver_email: null, giver_group: 'Smiths', receiver_name: 'Alex', receiver_group: 'Smiths' },
];

async function get(query: Record<string, unknown>, headers: Record<string, string> = {}) {
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
  await handler({ method: 'GET', query, headers } as unknown as NextApiRequest, res as unknown as NextApiResponse);
  return res;
}

beforeEach(() => {
  vi.mocked(sql.transaction).mockReset();
  vi.mocked(sql.transaction).mockResolvedValue([[drawRow], participantRows, matchRows]);
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
    expect(res.body).toMatchObject({
      isAdmin: true,
      participantsWithEmailCount: 2,
      participants: participantRows.map(p => ({ ...p, email_sent_at: p.email_sent_at?.toISOString() ?? null })),
      matches: matchRows,
    });
    expect(JSON.stringify(res.body)).not.toContain(ADMIN_KEY);
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

  it('returns 410 for a deleted draw', async () => {
    vi.mocked(sql.transaction).mockResolvedValue([[{ ...drawRow, deleted_at: new Date('2026-10-03T12:00:00.000Z') }], participantRows, matchRows]);
    const res = await get({ id: DRAW_ID }, { 'x-admin-key': ADMIN_KEY });
    expect(res.statusCode).toBe(410);
  });

  it('returns 404 for a malformed id without querying', async () => {
    const res = await get({ id: 'not-a-uuid' });
    expect(res.statusCode).toBe(404);
    expect(sql.transaction).not.toHaveBeenCalled();
  });
});
