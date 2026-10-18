import { beforeEach, describe, expect, it, vi } from 'vitest';
import { callRoute as call } from './helpers/fake-res';

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
const sendOrganizerLinkEmail = vi.hoisted(() => vi.fn(async () => {}));
const sendOpsEmail = vi.hoisted(() => vi.fn(async (..._args: string[]) => {}));
vi.mock('@/lib/email', () => ({ sendMatchEmail, sendOrganizerLinkEmail, sendOpsEmail }));
vi.mock('@/lib/turnstile', () => ({ verifyTurnstile: async () => true }));

import { NextRequest } from 'next/server';
import { sql } from '@/lib/db';
import { proxy } from '@/proxy';
import { rateLimitBucket } from '@/lib/rate-limit';
import { BASE_PATH } from '@/lib/site';
import createDraw from '@/pages/api/create-draw';
import getDraw from '@/pages/api/get-draw';
import sendEmails from '@/pages/api/send-emails';
import reveal from '@/pages/api/reveal';
import deleteDraw from '@/pages/api/delete-draw';
import saveDetails from '@/pages/api/save-details';
import opsCheck from '@/pages/api/ops-check';
import type { GetDrawResponse, CreateDrawResponse, RevealResponse, SendEmailsResponse } from '@/types/api';

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
  vi.stubEnv('RATE_LIMIT_HASH_SECRET', 'test-secret');
});

describe('routes against a real Postgres', () => {
  it('creates a draw, shows it, sends it once and reveals each match', async () => {
    const { adminKey } = await create();
    expect(adminKey).toMatch(/^[0-9A-Za-z]{14}$/);
    const draw = await adminView(adminKey);
    expect(draw.participants.every(p => /^[0-9A-Za-z]{8}$/.test(p.reveal_token))).toBe(true);
    expect(draw.participants.map(p => p.name)).toEqual(['Alex', 'Sam', 'Jo', 'Kim']);
    expect(draw.matches).toHaveLength(4);
    for (const m of draw.matches) {
      expect(m.giver).not.toBe(m.receiver);
      const groups = [draw.participants[m.giver].group_name, draw.participants[m.receiver].group_name];
      expect(groups[0]!.trim().toLowerCase()).not.toBe(groups[1]!.trim().toLowerCase());
    }

    const send = await call(sendEmails, { method: 'POST', body: { key: adminKey, organizerName: 'Pat', organizerEmail: 'pat@example.com', turnstileToken: 't' } });
    expect(send.statusCode).toBe(200);
    expect((send.body as SendEmailsResponse).totalSent).toBe(3);
    expect(sendMatchEmail.mock.calls.map(c => (c as unknown[])[1]).sort()).toEqual(['alex@example.com', 'kim@example.com', 'sam@example.com']);

    const again = await call(sendEmails, { method: 'POST', body: { key: adminKey, organizerName: 'Pat', organizerEmail: 'pat@example.com', turnstileToken: 't' } });
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
    expect(log.sent).toBeGreaterThanOrEqual(4);
    expect(sendOrganizerLinkEmail).toHaveBeenCalledWith('Pat', 'pat@example.com', adminKey);
  });

  it('emails just the organizer their link when nobody has an email address', async () => {
    const { adminKey } = await create({ participants: people.map(p => ({ ...p, email: '' })) });
    const sent = async () => (await sql`SELECT COALESCE(SUM(emails_sent), 0)::int as sent FROM EmailSendLog`)[0].sent as number;
    const before = await sent();
    sendOrganizerLinkEmail.mockClear();
    const body = { key: adminKey, organizerName: 'Pat', organizerEmail: 'pat@example.com', turnstileToken: 't' };

    const send = await call(sendEmails, { method: 'POST', body });
    expect(send.statusCode).toBe(200);
    expect((send.body as SendEmailsResponse).organizerLinkSent).toBe(true);
    expect(sendOrganizerLinkEmail).toHaveBeenCalledWith('Pat', 'pat@example.com', adminKey);
    expect(sendMatchEmail).not.toHaveBeenCalled();
    expect((await adminView(adminKey)).emails_sent_at).toBeNull();
    expect(await sent()).toBe(before + 1);

    // When the organizer's link email fails, its reservation is given back
    vi.spyOn(console, 'error').mockImplementationOnce(() => {});
    sendOrganizerLinkEmail.mockImplementationOnce(async () => { throw new Error('SMTP down'); });
    const failed = await call(sendEmails, { method: 'POST', body });
    expect(failed.statusCode).toBe(500);
    expect(failed.body).toEqual({ error: 'Failed to send your organizer link. Please try again.' });
    expect(await sent()).toBe(before + 1);
  });

  it('saves the exchange details with the first send and shows them to the organizer and on personal links', async () => {
    const { adminKey } = await create();
    const send = await call(sendEmails, { method: 'POST', body: {
      key: adminKey, organizerName: 'Pat', organizerEmail: 'pat@example.com', turnstileToken: 't',
      organizerNote: 'Bring it wrapped', budget: '0', exchangeDate: '2026-12-19',
    } });
    expect(send.statusCode).toBe(200);
    const details = { organizer_note: 'Bring it wrapped', budget_cents: 0, exchange_date: '2026-12-19' };
    expect(sendMatchEmail.mock.calls.every(c => JSON.stringify((c as unknown[])[6]) === JSON.stringify(details))).toBe(true);

    const view = await adminView(adminKey);
    expect(view).toMatchObject({ ...details, organizer_name: 'Pat' });
    const r = await call(reveal, { method: 'GET', query: { token: view.participants[0].reveal_token } });
    expect(r.body).toMatchObject(details);
  });

  it('saves the exchange details with the organizer link email when nobody has an email address', async () => {
    const { adminKey } = await create({ participants: people.map(p => ({ ...p, email: '' })) });
    await call(sendEmails, { method: 'POST', body: {
      key: adminKey, organizerName: 'Pat', organizerEmail: 'pat@example.com', turnstileToken: 't',
      budget: '30', exchangeDate: '2027-01-02',
    } });
    const view = await adminView(adminKey);
    expect(view).toMatchObject({ organizer_note: null, budget_cents: 3000, exchange_date: '2027-01-02', emails_sent_at: null });
  });

  it('saves the details without any email, shows them on personal links, clears them, and locks them once sent', async () => {
    const { adminKey } = await create();
    const view = await adminView(adminKey);
    const save = (body: Record<string, unknown>) => call(saveDetails, { method: 'POST', body: { key: adminKey, ...body } });

    const saved = await save({ organizerNote: ' Bring it wrapped ', budget: '$25.50', exchangeDate: '2026-12-19' });
    expect(saved.statusCode).toBe(200);
    const details = { organizer_note: 'Bring it wrapped', budget_cents: 2550, exchange_date: '2026-12-19' };
    expect(saved.body).toEqual(details);
    expect(sendMatchEmail).not.toHaveBeenCalled();
    expect(await adminView(adminKey)).toMatchObject({ ...details, emails_sent_at: null });
    const r = await call(reveal, { method: 'GET', query: { token: view.participants[0].reveal_token } });
    expect(r.body).toMatchObject({ ...details, organizer_name: null });

    expect((await save({ organizerNote: '', budget: '', exchangeDate: '' })).body).toEqual({ organizer_note: null, budget_cents: null, exchange_date: null });
    expect(await adminView(adminKey)).toMatchObject({ organizer_note: null, budget_cents: null, exchange_date: null });

    expect((await save({ budget: '30', key: 'Zz9yXx8wVv7uTt' })).statusCode).toBe(403);
    await call(sendEmails, { method: 'POST', body: { key: adminKey, organizerName: 'Pat', organizerEmail: 'pat@example.com', turnstileToken: 't', budget: '40' } });
    expect((await save({ budget: '30' })).statusCode).toBe(409);
    expect((await adminView(adminKey)).budget_cents).toBe(4000);
  });

  it('carries saved details over on Edit & Redraw, but never into a brand new draw', async () => {
    const old = await create();
    await call(saveDetails, { method: 'POST', body: { key: old.adminKey, organizerNote: 'Wrap it', budget: '20', exchangeDate: '2026-12-24' } });

    const redrawn = await create({ replacesKey: old.adminKey });
    expect(await adminView(redrawn.adminKey)).toMatchObject({ organizer_note: 'Wrap it', budget_cents: 2000, exchange_date: '2026-12-24' });

    const brandNew = await create();
    expect(await adminView(brandNew.adminKey)).toMatchObject({ organizer_note: null, budget_cents: null, exchange_date: null });
  });

  it('resends only to someone whose email failed', async () => {
    const { adminKey } = await create();
    sendMatchEmail.mockImplementation(async (...args: unknown[]) => {
      if (args[1] === 'kim@example.com') throw new Error('SMTP down');
    });
    const first = await call(sendEmails, { method: 'POST', body: { key: adminKey, organizerName: 'Pat', organizerEmail: 'pat@example.com', turnstileToken: 't' } });
    expect((first.body as SendEmailsResponse).failedNames).toEqual(['Kim']);

    sendMatchEmail.mockReset();
    const retry = await call(sendEmails, { method: 'POST', body: { key: adminKey, retryFailed: true, turnstileToken: 't' } });
    expect(retry.statusCode).toBe(200);
    expect(sendMatchEmail.mock.calls.map(c => (c as unknown[])[1])).toEqual(['kim@example.com']);
    expect((await adminView(adminKey)).participants.every(p => !p.email || p.email_sent_at)).toBe(true);
  });

  it('counts each IP\'s emails, gives back the failed ones, and refuses a send over 100 with 429', async () => {
    const ip = '203.0.113.77';
    const headers = { 'x-forwarded-for': ip };
    const bucket = await rateLimitBucket(ip, 'email-budget');
    const used = async () => (await sql`SELECT COALESCE(SUM(hits), 0)::int as hits FROM RateLimits WHERE bucket = ${bucket}`)[0].hits;
    const { adminKey } = await create();
    sendMatchEmail.mockImplementation(async (...args: unknown[]) => {
      if (args[1] === 'kim@example.com') throw new Error('SMTP down');
    });
    const first = await call(sendEmails, { method: 'POST', headers, body: { key: adminKey, organizerName: 'Pat', organizerEmail: 'pat@example.com', turnstileToken: 't' } });
    expect(first.statusCode).toBe(200);
    // Two match emails and the organizer's link; Kim's failed email is given back
    expect(await used()).toBe(3);

    await sql`UPDATE RateLimits SET hits = 100 WHERE bucket = ${bucket}`;
    sendMatchEmail.mockReset();
    const retry = await call(sendEmails, { method: 'POST', headers, body: { key: adminKey, retryFailed: true, turnstileToken: 't' } });
    expect(retry.statusCode).toBe(429);
    expect(sendMatchEmail).not.toHaveBeenCalled();
    expect(await sql`
      SELECT 1
      FROM Participants as participants
           INNER JOIN Draws as draws ON participants.draw_id = draws.id
      WHERE draws.admin_key = ${adminKey}
           AND participants.email_claimed_at IS NOT NULL
    `).toEqual([]);

    const noEmails = await create({ participants: people.map(p => ({ ...p, email: '' })) });
    const organizerOnly = await call(sendEmails, { method: 'POST', headers, body: { key: noEmails.adminKey, organizerName: 'Pat', organizerEmail: 'pat@example.com', turnstileToken: 't' } });
    expect(organizerOnly.statusCode).toBe(429);
    expect(await used()).toBe(100);
  });

  it('redraws by replacing the old draw, then refuses to replace it twice or once emailed', async () => {
    const old = await create();
    const fresh = await create({ replacesKey: old.adminKey });
    expect(fresh.adminKey).not.toBe(old.adminKey);
    const oldView = await call(getDraw, { method: 'GET', headers: { 'x-admin-key': old.adminKey } });
    expect(oldView.statusCode).toBe(410);

    const twice = await call(createDraw, { method: 'POST', body: { participants: people, replacesKey: old.adminKey } });
    expect(twice.statusCode).toBe(410);

    await call(sendEmails, { method: 'POST', body: { key: fresh.adminKey, organizerName: 'Pat', organizerEmail: 'pat@example.com', turnstileToken: 't' } });
    const emailed = await call(createDraw, { method: 'POST', body: { participants: people, replacesKey: fresh.adminKey } });
    expect(emailed.statusCode).toBe(409);
    // The refused redraw saved nothing, so the emailed draw still shows
    expect((await adminView(fresh.adminKey)).emails_sent_at).not.toBeNull();
  });

  it('soft-deletes a draw once, so its links answer 410', async () => {
    const { adminKey } = await create();
    const token = (await adminView(adminKey)).participants[0].reveal_token;
    const deletedAt = async () => (await sql`SELECT deleted_at FROM Draws WHERE admin_key = ${adminKey}`)[0].deleted_at as Date | null;

    expect((await call(deleteDraw, { method: 'POST', body: { key: 'wrong' } })).statusCode).toBe(403);
    expect((await call(deleteDraw, { method: 'POST', body: { key: adminKey } })).statusCode).toBe(200);

    expect((await call(getDraw, { method: 'GET', headers: { 'x-admin-key': adminKey } })).statusCode).toBe(410);
    expect((await call(reveal, { method: 'GET', query: { token } })).statusCode).toBe(410);
    const first = await deletedAt();
    expect(first).toBeInstanceOf(Date);

    // Deleting again succeeds and keeps the first deletion time
    expect((await call(deleteDraw, { method: 'POST', body: { key: adminKey } })).statusCode).toBe(200);
    expect(await deletedAt()).toEqual(first);
  });

  it('answers keys and tokens that are well formed but unknown with 404 when reading and 403 when changing', async () => {
    const unknown = '00000000000000';
    expect((await call(getDraw, { method: 'GET', headers: { 'x-admin-key': unknown } })).statusCode).toBe(404);
    expect((await call(reveal, { method: 'GET', query: { token: '00000000' } })).statusCode).toBe(404);
    const sendBody = { key: unknown, organizerName: 'Pat', organizerEmail: 'pat@example.com', turnstileToken: 't' };
    expect((await call(sendEmails, { method: 'POST', body: sendBody })).statusCode).toBe(403);
    expect((await call(saveDetails, { method: 'POST', body: { key: unknown, budget: '20' } })).statusCode).toBe(403);
    expect((await call(deleteDraw, { method: 'POST', body: { key: unknown } })).statusCode).toBe(403);
    expect((await call(createDraw, { method: 'POST', body: { participants: people, replacesKey: unknown } })).statusCode).toBe(403);
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

  it('records the first time each personal link is opened', async () => {
    const { adminKey } = await create();
    const view = await adminView(adminKey);
    const token = view.participants[0].reveal_token;
    const opened = async () => await sql`SELECT revealed_at FROM Participants WHERE reveal_code = ${token}` as { revealed_at: Date | null }[];
    expect((await opened())[0].revealed_at).toBeNull();

    expect((await call(reveal, { method: 'GET', query: { token } })).statusCode).toBe(200);
    const first = (await opened())[0].revealed_at;
    expect(first).toBeInstanceOf(Date);

    await call(reveal, { method: 'GET', query: { token } });
    expect((await opened())[0].revealed_at).toEqual(first);
  });

  it('writes the daily stats row for yesterday and warns about people left unemailed', async () => {
    vi.stubEnv('CRON_SECRET', 'cron-secret');
    vi.stubEnv('OPS_ALERT_EMAIL', 'owner@example.com');
    sendOpsEmail.mockClear();
    const headers = { authorization: 'Bearer cron-secret' };
    const yesterday = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
    await sql`DELETE FROM DailyStats`;

    // A draw made yesterday at noon and sent an hour later, where one person's email
    // failed. Fixed times, so the result doesn't depend on the hour the test runs
    const { adminKey } = await create();
    await sql`
      UPDATE Draws
      SET created_at = ${yesterday}::date + interval '12 hours', emails_sent_at = ${yesterday}::date + interval '13 hours'
      WHERE admin_key = ${adminKey}
    `;
    await sql`UPDATE Participants SET email_sent_at = now() WHERE draw_id = (SELECT id FROM Draws WHERE admin_key = ${adminKey}) AND name <> 'Kim'`;
    await sql`UPDATE Participants SET revealed_at = ${yesterday}::date + interval '13 hours' WHERE draw_id = (SELECT id FROM Draws WHERE admin_key = ${adminKey}) AND name = 'Alex'`;

    expect((await call(opsCheck, { method: 'GET', headers: {} })).statusCode).toBe(403);
    const run = await call(opsCheck, { method: 'GET', headers });
    expect(run.statusCode).toBe(200);
    expect((run.body as { statDate: string }).statDate).toBe(yesterday);

    const rows = await sql`SELECT * FROM DailyStats WHERE stat_date = ${yesterday}::date` as Record<string, number>[];
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ draws_created: 1, draws_emailed: 1, participants_created: 4, links_opened: 1, unsent_emails: 1 });
    expect(sendOpsEmail).toHaveBeenCalledOnce();
    expect(sendOpsEmail.mock.calls[0]).toEqual(['owner@example.com', 'Secret Santa: needs a look', expect.stringContaining('1 people on 1 draws')]);

    // Running it again for the same day replaces the row
    expect((await call(opsCheck, { method: 'GET', headers })).statusCode).toBe(200);
    expect(await sql`SELECT 1 FROM DailyStats WHERE stat_date = ${yesterday}::date`).toHaveLength(1);

    sendOpsEmail.mockClear();
    const weekly = await call(opsCheck, { method: 'GET', headers, query: { report: 'weekly' } });
    expect(weekly.statusCode).toBe(200);
    expect(sendOpsEmail.mock.calls[0][1]).toBe('Secret Santa: weekly stats');
    expect(sendOpsEmail.mock.calls[0][2]).toContain('Draws created: 1');
  });
});
