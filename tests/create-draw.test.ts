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

  it('rejects "Family" and "family" together as one oversized group', async () => {
    const res = await post([person('A', 'Family'), person('B', 'family'), person('C')]);
    expect(res.statusCode).toBe(422);
    expect(sql.transaction).not.toHaveBeenCalled();
  });
});
