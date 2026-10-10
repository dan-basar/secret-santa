import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { NextApiRequest, NextApiResponse } from 'next';

// No database in tests: queries become inert values and the transaction
// resolves without running them
vi.mock('@/lib/db', () => {
  const sql = Object.assign(vi.fn(() => ({})), { transaction: vi.fn(async () => []) });
  return { sql };
});

import handler from '@/pages/api/create-draw';
import { sql } from '@/lib/db';

function person(name: string, group = '') {
  return { name, email: '', group };
}

async function post(participants: unknown) {
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
    { method: 'POST', body: { participants } } as NextApiRequest,
    res as unknown as NextApiResponse
  );
  return res;
}

beforeEach(() => {
  vi.mocked(sql.transaction).mockClear();
});

describe('POST /api/create-draw', () => {
  it('creates a draw with groups', async () => {
    const res = await post([person('A', 'Smiths'), person('B', 'Smiths'), person('C'), person('D')]);
    expect(res.statusCode).toBe(200);
    expect(sql.transaction).toHaveBeenCalledOnce();
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

  it('accepts a 200-character name and a 320-character email', async () => {
    const email = `${'x'.repeat(308)}@example.com`;
    const res = await post([{ name: 'x'.repeat(200), email, group: '' }, person('B')]);
    expect(res.statusCode).toBe(200);
  });
});
