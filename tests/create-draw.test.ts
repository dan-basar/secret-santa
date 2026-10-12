import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { NextApiRequest, NextApiResponse } from 'next';

// No database in tests: queries become inert values and the transaction
// resolves without running them
vi.mock('@/lib/db', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/db')>();
  const sql = Object.assign(vi.fn(() => ({})), { transaction: vi.fn(async () => []) });
  return { ...actual, sql };
});

import handler from '@/pages/api/create-draw';
import { sql } from '@/lib/db';

function person(name: string, group = '') {
  return { name, email: '', group };
}

async function post(participants: unknown, extra: Record<string, unknown> = {}) {
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
    end() {
      return this;
    },
  };
  await handler(
    { method: 'POST', body: { participants, ...extra } } as NextApiRequest,
    res as unknown as NextApiResponse
  );
  return res;
}

beforeEach(() => {
  vi.mocked(sql).mockClear();
  vi.mocked(sql.transaction).mockClear();
});

const OLD_ID = '11111111-2222-4333-8444-555555555555';
const OLD_KEY = 'old-admin-key';
const threePeople = [person('A'), person('B'), person('C')];

// The next sql`...` call is the old-draw lookup; it resolves to this row
function oldDraw(row: { admin_key: string; deleted_at: string | null; emails_sent_at: string | null } | null) {
  vi.mocked(sql).mockImplementationOnce((() => Promise.resolve(row ? [row] : [])) as never);
}

// The SQL text of every sql`...` call so far, with the values bound to it
function queries() {
  return vi.mocked(sql).mock.calls.map(([strings, ...values]) => ({
    text: (strings as unknown as string[]).join('$'),
    values: values as unknown[],
  }));
}

describe('POST /api/create-draw replacing an earlier draw', () => {
  it('soft-deletes the old draw in the same transaction when the key matches', async () => {
    oldDraw({ admin_key: OLD_KEY, deleted_at: null, emails_sent_at: null });
    const res = await post(threePeople, { replacesDrawId: OLD_ID, replacesKey: OLD_KEY });
    expect(res.statusCode).toBe(200);
    expect(sql.transaction).toHaveBeenCalledOnce();
    // Old-draw update plus the three inserts
    expect(vi.mocked(sql.transaction).mock.calls[0][0]).toHaveLength(4);
    const update = queries().find(q => q.text.includes('SET deleted_at = now()'));
    expect(update?.text).toContain('AND emails_sent_at IS NULL');
    expect(update?.values).toEqual([OLD_ID, OLD_KEY]);
  });

  it('rejects a wrong or missing key with 403 and changes nothing', async () => {
    for (const replacesKey of ['wrong-key', undefined]) {
      oldDraw({ admin_key: OLD_KEY, deleted_at: null, emails_sent_at: null });
      const res = await post(threePeople, { replacesDrawId: OLD_ID, replacesKey });
      expect(res.statusCode).toBe(403);
    }
    expect(sql.transaction).not.toHaveBeenCalled();
  });

  it('rejects an unknown draw with 403 and changes nothing', async () => {
    oldDraw(null);
    const res = await post(threePeople, { replacesDrawId: OLD_ID, replacesKey: OLD_KEY });
    expect(res.statusCode).toBe(403);
    expect(sql.transaction).not.toHaveBeenCalled();
  });

  it('rejects an already-deleted draw with 410 and changes nothing', async () => {
    oldDraw({ admin_key: OLD_KEY, deleted_at: '2026-10-01T00:00:00Z', emails_sent_at: null });
    const res = await post(threePeople, { replacesDrawId: OLD_ID, replacesKey: OLD_KEY });
    expect(res.statusCode).toBe(410);
    expect(sql.transaction).not.toHaveBeenCalled();
  });

  it('rejects a draw whose emails were sent with 409 and changes nothing', async () => {
    oldDraw({ admin_key: OLD_KEY, deleted_at: null, emails_sent_at: '2026-10-01T00:00:00Z' });
    const res = await post(threePeople, { replacesDrawId: OLD_ID, replacesKey: OLD_KEY });
    expect(res.statusCode).toBe(409);
    expect(sql.transaction).not.toHaveBeenCalled();
  });

  it('returns 409 when the old draw changes between the check and the transaction', async () => {
    oldDraw({ admin_key: OLD_KEY, deleted_at: null, emails_sent_at: null });
    // Postgres division_by_zero from the replace guard; the transaction rolls back
    vi.mocked(sql.transaction).mockRejectedValueOnce(Object.assign(new Error('division by zero'), { code: '22012' }));
    const res = await post(threePeople, { replacesDrawId: OLD_ID, replacesKey: OLD_KEY });
    expect(res.statusCode).toBe(409);
  });

  it('rejects a replacesDrawId that is not a uuid', async () => {
    for (const replacesDrawId of ['not-a-uuid', 42]) {
      const res = await post(threePeople, { replacesDrawId, replacesKey: OLD_KEY });
      expect(res.statusCode).toBe(400);
    }
    expect(sql).not.toHaveBeenCalled();
    expect(sql.transaction).not.toHaveBeenCalled();
  });

  it('touches no other draw when replacesDrawId is absent', async () => {
    const res = await post(threePeople);
    expect(res.statusCode).toBe(200);
    expect(vi.mocked(sql.transaction).mock.calls[0][0]).toHaveLength(3);
    expect(queries().some(q => q.text.includes('UPDATE Draws') || q.text.includes('FROM Draws'))).toBe(false);
  });
});

describe('POST /api/create-draw', () => {
  it('creates a draw with groups', async () => {
    const res = await post([person('A', 'Smiths'), person('B', 'Smiths'), person('C'), person('D')]);
    expect(res.statusCode).toBe(200);
    expect(sql.transaction).toHaveBeenCalledOnce();
  });

  it('saves one match per person by position, never within a group', async () => {
    const participants = [person('Sam', 'A'), person('Sam', 'B'), person('Alex', 'A'), person('Jo', 'B')];
    const res = await post(participants);
    expect(res.statusCode).toBe(200);
    const insert = queries().find(q => q.text.includes('INSERT INTO Matches'))!;
    const [givers, receivers] = insert.values.slice(1, 3) as [number[], number[]];
    expect(givers).toEqual([1, 2, 3, 4]);
    expect([...receivers].sort()).toEqual([1, 2, 3, 4]);
    receivers.forEach((r, i) => expect(participants[r - 1].group).not.toBe(participants[i].group));
  });

  it('rejects more than 20 groups', async () => {
    const participants = Array.from({ length: 21 }, (_, i) => person(`P${i}`, `Group ${i}`));
    const res = await post(participants);
    expect(res.statusCode).toBe(400);
    expect(res.body).toEqual({ error: 'Maximum 20 groups allowed.' });
    expect(sql.transaction).not.toHaveBeenCalled();
  });

  it('counts groups that differ only in case once toward the limit', async () => {
    const participants = Array.from({ length: 20 }, (_, i) => person(`P${i}`, `Group ${i}`));
    participants.push(person('Extra', 'GROUP 0'));
    const res = await post(participants);
    expect(res.statusCode).toBe(200);
  });

  it('rejects group names over 200 characters', async () => {
    const res = await post([person('A', 'x'.repeat(201)), person('B')]);
    expect(res.statusCode).toBe(400);
    expect(sql.transaction).not.toHaveBeenCalled();
  });

  it('stores names and groups as typed, without HTML entities', async () => {
    const res = await post([person('Tom & Jerry', 'Smith & Co'), person('B'), person('C')]);
    expect(res.statusCode).toBe(200);
    // sql`...` calls receive the bound values after the template strings
    const values = vi.mocked(sql).mock.calls.flatMap(call => call.slice(1) as unknown[]);
    expect(values).toContainEqual(expect.arrayContaining(['Tom & Jerry']));
    expect(values).toContainEqual(expect.arrayContaining(['Smith & Co']));
  });

  it('rejects names and groups that contain HTML tags', async () => {
    for (const participants of [
      [person('<b>Tom</b>'), person('B')],
      [person('A', '<img src=x onerror=alert(1)>'), person('B')],
    ]) {
      const res = await post(participants);
      expect(res.statusCode).toBe(400);
      expect(res.body).toEqual({ error: 'Names and groups cannot contain HTML.' });
    }
    expect(sql.transaction).not.toHaveBeenCalled();
  });

  it('rejects names with a web address, which would be clickable in the emails', async () => {
    const res = await post([person('Win a prize at bit.ly/x'), person('B'), person('Get gifts www.example')]);
    expect(res.statusCode).toBe(400);
    expect(res.body).toEqual({ error: 'Names cannot contain web addresses: Win a prize at bit.ly/x, Get gifts www.example' });
    expect(sql.transaction).not.toHaveBeenCalled();
  });

  it('allows a group name that looks like a web address, since groups are never emailed', async () => {
    const res = await post([person('A', 'example.com'), person('B'), person('C')]);
    expect(res.statusCode).toBe(200);
  });

  it('rejects "Family" and "family" together as one oversized group', async () => {
    const res = await post([person('A', 'Family'), person('B', 'family'), person('C')]);
    expect(res.statusCode).toBe(422);
    expect(sql.transaction).not.toHaveBeenCalled();
  });

  it('rejects a participants value that is not a list', async () => {
    for (const participants of [undefined, null, 'A,B', { 0: person('A'), 1: person('B'), length: 2 }]) {
      const res = await post(participants);
      expect(res.statusCode).toBe(400);
      expect(res.body).toEqual({ error: 'Participants must be a list.' });
    }
    expect(sql.transaction).not.toHaveBeenCalled();
  });

  it('rejects participants with a non-text name, email or group', async () => {
    for (const bad of [
      null,
      'A',
      { name: 42, email: '', group: '' },
      { email: '', group: '' },
      { name: 'A', email: 7, group: '' },
      { name: 'A', email: '', group: ['Smiths'] },
    ]) {
      const res = await post([bad, person('B'), person('C')]);
      expect(res.statusCode).toBe(400);
      expect(res.body).toEqual({ error: 'Each participant needs a text name; email and group must be text if given.' });
    }
    expect(sql.transaction).not.toHaveBeenCalled();
  });

  it('accepts a missing or null email and group', async () => {
    const res = await post([{ name: 'A' }, { name: 'B', email: null, group: null }, person('C')]);
    expect(res.statusCode).toBe(200);
  });

  it('rejects names over 200 characters', async () => {
    const res = await post([person('x'.repeat(201)), person('B')]);
    expect(res.statusCode).toBe(400);
    expect(res.body).toEqual({ error: 'Names must be 200 characters or fewer.' });
    expect(sql.transaction).not.toHaveBeenCalled();
  });

  it('rejects email addresses over 320 characters', async () => {
    const email = `${'x'.repeat(309)}@example.com`; // 321 characters
    const res = await post([{ name: 'A', email, group: '' }, person('B')]);
    expect(res.statusCode).toBe(400);
    expect(res.body).toEqual({ error: 'Email addresses must be 320 characters or fewer.' });
    expect(sql.transaction).not.toHaveBeenCalled();
  });

  it('rejects participant emails with angle brackets or quotes, as send-emails does', async () => {
    for (const email of ['<alex@example.com>', '"alex"@example.com']) {
      const res = await post([{ name: 'Alex', email, group: '' }, person('B')]);
      expect(res.statusCode).toBe(400);
      expect(res.body).toEqual({ error: 'Invalid email address for: Alex' });
    }
    expect(sql.transaction).not.toHaveBeenCalled();
  });

  it('accepts a 200-character name and a 320-character email', async () => {
    const email = `${'x'.repeat(308)}@example.com`;
    const res = await post([{ name: 'x'.repeat(200), email, group: '' }, person('B')]);
    expect(res.statusCode).toBe(200);
  });
});
