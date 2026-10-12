import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { NextApiHandler, NextApiRequest, NextApiResponse } from 'next';

// The other route tests answer each query with canned rows. This one runs the
// routes' real SQL against the real schema (sql/setup.sql) in an in-memory
// Postgres, so a typo in a column name, a bad cast or a broken constraint fails
// here. Only email and Cloudflare are stubbed.
vi.mock('@/lib/db', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/db')>();
  const { createTestSql } = await import('./helpers/pglite-sql');
  const { sql } = await createTestSql();
  return { ...actual, sql };
});

const sendMatchEmail = vi.hoisted(() => vi.fn(async () => {}));
vi.mock('@/lib/email', () => ({ sendMatchEmail }));
vi.mock('@/lib/turnstile', () => ({ verifyTurnstile: async () => true }));

import { NextRequest } from 'next/server';
import { sql } from '@/lib/db';
import { proxy } from '@/proxy';
import { BASE_PATH } from '@/lib/site';
import createDraw from '@/pages/api/create-draw';
import getDraw from '@/pages/api/get-draw';
import sendEmails from '@/pages/api/send-emails';
import reveal from '@/pages/api/reveal';
import deleteDraw from '@/pages/api/delete-draw';
import health from '@/pages/api/health';
import type { GetDrawResponse, CreateDrawResponse, RevealResponse, SendEmailsResponse } from '@/types/api';

interface Result { statusCode: number; body: unknown }

async function call(handler: NextApiHandler, req: { method: string; body?: unknown; query?: Record<string, string>; headers?: Record<string, string> }): Promise<Result> {
  const res = {
    statusCode: 200,
    body: undefined as unknown,
    setHeader() { return this; },
    status(code: number) { this.statusCode = code; return this; },
    json(body: unknown) { this.body = body; return this; },
    end() { return this; },
  };
  await handler({ query: {}, headers: {}, ...req } as unknown as NextApiRequest, res as unknown as NextApiResponse);
  return res;
}

const people = [
  { name: 'Alex', email: 'alex@example.com', group: 'Smiths' },
  { name: 'Sam', email: 'sam@example.com', group: 'smiths ' },
  { name: 'Jo', email: '', group: 'Lees' },
  { name: 'Kim', email: 'kim@example.com', group: 'Lees' },
];

async function create(body: Record<string, unknown> = {}) {
  const res = await call(createDraw, { method: 'POST', body: { participants: people, ...body } });
  expect(res.statusCode).toBe(200);
  return res.body as CreateDrawResponse;
}

async function adminView(adminKey: string) {
  const res = await call(getDraw, { method: 'GET', headers: { 'x-admin-key': adminKey } });
  expect(res.statusCode).toBe(200);
  return res.body as GetDrawResponse;
}

beforeEach(() => {
  sendMatchEmail.mockReset();
  sendMatchEmail.mockImplementation(async () => {});
  vi.stubEnv('NEXT_PUBLIC_BASE_URL', 'https://baseworkshop.app');
});

describe('routes against a real Postgres', () => {
  it('creates a draw, shows it, sends it once and reveals each match', async () => {
    const { adminKey } = await create();
    expect(adminKey).toMatch(/^[0-9A-Za-z]{14}$/);
    const draw = await adminView(adminKey);
    const drawId = draw.id;
    expect(draw.participants.every(p => /^[0-9A-Za-z]{8}$/.test(p.reveal_token))).toBe(true);
    expect(draw.participants.map(p => p.name)).toEqual(['Alex', 'Sam', 'Jo', 'Kim']);
    expect(draw.matches).toHaveLength(4);
    for (const m of draw.matches) {
      expect(m.giver).not.toBe(m.receiver);
      const groups = [draw.participants[m.giver].group_name, draw.participants[m.receiver].group_name];
      expect(groups[0]!.trim().toLowerCase()).not.toBe(groups[1]!.trim().toLowerCase());
    }

    const send = await call(sendEmails, { method: 'POST', body: { id: drawId, key: adminKey, organizerName: 'Pat', organizerEmail: 'pat@example.com', turnstileToken: 't' } });
    expect(send.statusCode).toBe(200);
    expect((send.body as SendEmailsResponse).totalSent).toBe(3);
    expect(sendMatchEmail.mock.calls.map(c => (c as unknown[])[1]).sort()).toEqual(['alex@example.com', 'kim@example.com', 'sam@example.com']);

    const again = await call(sendEmails, { method: 'POST', body: { id: drawId, key: adminKey, organizerName: 'Pat', organizerEmail: 'pat@example.com', turnstileToken: 't' } });
    expect(again.statusCode).toBe(409);

    const after = await adminView(adminKey);
    expect(after.emails_sent_at).not.toBeNull();
    expect(after.participants.filter(p => p.email_sent_at).map(p => p.name)).toEqual(['Alex', 'Sam', 'Kim']);

    for (const m of after.matches) {
      const r = await call(reveal, { method: 'GET', query: { token: after.participants[m.giver].reveal_token } });
      expect(r.statusCode).toBe(200);
      const body = r.body as RevealResponse;
      expect(body.name).toBe(after.participants[m.giver].name);
      expect(body.match_name).toBe(after.participants[m.receiver].name);
      expect(body.organizer_name).toBe('Pat');
    }

    const [log] = await sql`SELECT COALESCE(SUM(emails_sent), 0)::int as sent FROM EmailSendLog`;
    expect(log.sent).toBeGreaterThanOrEqual(3);
  });

  it('resends only to someone whose email failed', async () => {
    const { adminKey } = await create();
    const drawId = (await adminView(adminKey)).id;
    sendMatchEmail.mockImplementation(async (...args: unknown[]) => {
      if (args[1] === 'kim@example.com') throw new Error('SMTP down');
    });
    const first = await call(sendEmails, { method: 'POST', body: { id: drawId, key: adminKey, organizerName: 'Pat', organizerEmail: 'pat@example.com', turnstileToken: 't' } });
    expect((first.body as SendEmailsResponse).failedNames).toEqual(['Kim']);

    sendMatchEmail.mockReset();
    const retry = await call(sendEmails, { method: 'POST', body: { id: drawId, key: adminKey, retryFailed: true, turnstileToken: 't' } });
    expect(retry.statusCode).toBe(200);
    expect(sendMatchEmail.mock.calls.map(c => (c as unknown[])[1])).toEqual(['kim@example.com']);
    expect((await adminView(adminKey)).participants.every(p => !p.email || p.email_sent_at)).toBe(true);
  });

  it('redraws by replacing the old draw, then refuses to replace it twice', async () => {
    const old = await create();
    const oldId = (await adminView(old.adminKey)).id;
    const fresh = await create({ replacesDrawId: oldId, replacesKey: old.adminKey });
    expect(fresh.adminKey).not.toBe(old.adminKey);
    const oldView = await call(getDraw, { method: 'GET', headers: { 'x-admin-key': old.adminKey } });
    expect(oldView.statusCode).toBe(410);

    const twice = await call(createDraw, { method: 'POST', body: { participants: people, replacesDrawId: oldId, replacesKey: old.adminKey } });
    expect(twice.statusCode).toBe(410);
  });

  it('soft-deletes a draw, so its links answer 410', async () => {
    const { adminKey } = await create();
    const draw = await adminView(adminKey);
    const drawId = draw.id;
    const token = draw.participants[0].reveal_token;

    expect((await call(deleteDraw, { method: 'POST', body: { id: drawId, key: 'wrong' } })).statusCode).toBe(403);
    expect((await call(deleteDraw, { method: 'POST', body: { id: drawId, key: adminKey } })).statusCode).toBe(200);

    expect((await call(getDraw, { method: 'GET', headers: { 'x-admin-key': adminKey } })).statusCode).toBe(410);
    expect((await call(reveal, { method: 'GET', query: { token } })).statusCode).toBe(410);
    const [row] = await sql`SELECT deleted_at FROM Draws WHERE id = ${drawId}::uuid`;
    expect(row.deleted_at).toBeInstanceOf(Date);
  });

  it('answers 404 for keys and tokens that are well formed but unknown', async () => {
    expect((await call(getDraw, { method: 'GET', headers: { 'x-admin-key': '00000000000000' } })).statusCode).toBe(404);
    expect((await call(reveal, { method: 'GET', query: { token: '00000000' } })).statusCode).toBe(404);
  });

  it('draws fresh tokens when a new one repeats one already saved', async () => {
    const { adminKey } = await create();
    const taken = (await adminView(adminKey)).participants[0].reveal_token;
    // The first attempt reuses a saved personal link token; the retry gets fresh ones
    const tokens = await import('@/lib/tokens');
    const newToken = vi.spyOn(tokens, 'newToken');
    newToken.mockImplementationOnce(() => 'Ab3dEf6hIj9kLm').mockImplementationOnce(() => taken);
    const second = await create();
    expect(second.adminKey).not.toBe('Ab3dEf6hIj9kLm');
    const tokensNow = (await adminView(second.adminKey)).participants.map(p => p.reveal_token);
    expect(tokensNow).not.toContain(taken);
    // A key and 4 tokens for the refused attempt, then again for the retry
    expect(newToken).toHaveBeenCalledTimes(10);
    newToken.mockRestore();
  });

  it('reports the database healthy', async () => {
    expect((await call(health, { method: 'GET' })).statusCode).toBe(200);
  });

  it('rate limits the sixth send from one IP in an hour, and clears out old counters', async () => {
    // The proxy lets requests through if its query fails, so a broken query would look like no limit
    const errors = vi.spyOn(console, 'error');
    const random = vi.spyOn(Math, 'random').mockReturnValue(0); // run the cleanup every time
    const send = () => proxy(new NextRequest(`http://localhost${BASE_PATH}/api/send-emails`, {
      method: 'POST',
      headers: { 'x-forwarded-for': '203.0.113.9' },
    }));
    await sql`INSERT INTO RateLimits (bucket, window_start, hits) VALUES ('old', now() - interval '3 days', 1)`;

    for (let i = 0; i < 5; i++) expect((await send()).status).toBe(200);
    expect((await send()).status).toBe(429);
    expect(errors).not.toHaveBeenCalled();
    expect(await sql`SELECT 1 FROM RateLimits WHERE bucket = 'old'`).toEqual([]);
    random.mockRestore();
    errors.mockRestore();
  });
});
