import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { NextApiRequest, NextApiResponse } from 'next';

// A tiny in-memory stand-in for the tables send-emails touches. Each sql`...`
// call is answered by matching its text, and runs synchronously, so a single
// UPDATE ... WHERE email_sent_at IS NULL is atomic just as it is in Postgres.
// Claim times are milliseconds on a fake clock, db.now, so tests can age them.
interface FakeParticipant { id: number; name: string; email: string | null; email_sent_at: string | null; email_claimed_at: number | null }
const db = vi.hoisted(() => ({
  now: 0,
  draw: {} as { id: string; admin_key: string; deleted_at: string | null; emails_sent_at: string | null; organizer_name: string | null; organizer_email: string | null },
  participants: [] as FakeParticipant[],
  receiverOf: {} as Record<number, number>,
  dailySent: 0,
}));

vi.mock('@/lib/db', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/db')>();

  function run(text: string, values: unknown[]): unknown[] {
    if (text.includes('FROM Draws')) return [{ ...db.draw }];
    if (text.includes('FROM Matches')) {
      return db.participants.map(giver => ({
        giver_id: giver.id,
        giver_name: giver.name,
        giver_email: giver.email,
        giver_email_sent_at: giver.email_sent_at,
        giver_reveal_token: `token-${giver.id}`,
        receiver_name: db.participants.find(p => p.id === db.receiverOf[giver.id])!.name,
      }));
    }
    if (text.includes('FROM DailyEmailLog')) return db.dailySent ? [{ emails_sent: db.dailySent }] : [];
    if (text.includes('UPDATE Draws') && text.includes('emails_sent_at = now()')) {
      if (db.draw.emails_sent_at) return [];
      db.draw.emails_sent_at = 'now';
      db.draw.organizer_name = values[0] as string;
      db.draw.organizer_email = values[1] as string;
      return [{ id: db.draw.id }];
    }
    if (text.includes('UPDATE Draws') && text.includes('emails_sent_at = NULL')) {
      db.draw.emails_sent_at = null;
      return [];
    }
    if (text.includes('UPDATE Participants') && text.includes('SET email_claimed_at = now()')) {
      const [ids, expiryMinutes] = values as [number[], number];
      const claimed = db.participants.filter(p => ids.includes(p.id) && !p.email_sent_at
        && (p.email_claimed_at === null || p.email_claimed_at < db.now - expiryMinutes * 60_000));
      for (const p of claimed) p.email_claimed_at = db.now;
      return claimed.map(p => ({ id: p.id }));
    }
    if (text.includes('UPDATE Participants') && text.includes('SET email_sent_at = now(), email_claimed_at = NULL')) {
      const p = db.participants.find(p => p.id === values[0])!;
      p.email_sent_at = 'now';
      p.email_claimed_at = null;
      return [];
    }
    if (text.includes('UPDATE Participants') && text.includes('SET email_claimed_at = NULL')) {
      db.participants.find(p => p.id === values[0])!.email_claimed_at = null;
      return [];
    }
    if (text.includes('INSERT INTO DailyEmailLog') && text.includes(', 1)')) {
      db.dailySent += 1;
      return [];
    }
    throw new Error(`Unexpected query: ${text}`);
  }

  const sql = Object.assign(
    vi.fn((strings: TemplateStringsArray, ...values: unknown[]) => {
      const text = strings.join('$');
      return { text, values, then: (resolve: (rows: unknown[]) => void, reject: (err: unknown) => void) => {
        try { resolve(run(text, values)); } catch (err) { reject(err); }
      } };
    }),
    { transaction: vi.fn(async (queries: Array<{ text: string; values: unknown[] }>) => queries.map(q => run(q.text, q.values))) }
  );
  return { ...actual, sql };
});

const sendMatchEmail = vi.hoisted(() => vi.fn());
vi.mock('@/lib/email', () => ({ sendMatchEmail }));

import handler from '@/pages/api/send-emails';

const DRAW_ID = '0b6f1c2a-8d3e-4f5a-9b7c-1d2e3f4a5b6c';
const ADMIN_KEY = 'admin-key-123';

async function post(body: Record<string, unknown>) {
  const res = {
    statusCode: 0,
    body: undefined as unknown as Record<string, unknown>,
    status(code: number) {
      this.statusCode = code;
      return this;
    },
    json(body: Record<string, unknown>) {
      this.body = body;
      return this;
    },
    end() {
      return this;
    },
  };
  await handler({ method: 'POST', body } as NextApiRequest, res as unknown as NextApiResponse);
  return res;
}

const firstSend = { id: DRAW_ID, key: ADMIN_KEY, organizerName: 'Pat', organizerEmail: 'pat@example.com', turnstileToken: 'token' };
const resend = { id: DRAW_ID, key: ADMIN_KEY, turnstileToken: 'token', retryFailed: true };

// Every address the handler emailed, in order
function emailed() {
  return sendMatchEmail.mock.calls.map(call => call[1] as string);
}

function sentNames() {
  return db.participants.filter(p => p.email_sent_at).map(p => p.name);
}

function claimedNames() {
  return db.participants.filter(p => p.email_claimed_at !== null).map(p => p.name);
}

// Emails to these addresses fail; everything else succeeds
function failFor(...addresses: string[]) {
  sendMatchEmail.mockImplementation(async (_name: string, email: string) => {
    if (addresses.includes(email)) throw new Error(`SMTP refused ${email}`);
  });
}

beforeEach(() => {
  db.draw = { id: DRAW_ID, admin_key: ADMIN_KEY, deleted_at: null, emails_sent_at: null, organizer_name: null, organizer_email: null };
  db.participants = [
    { id: 1, name: 'Alex', email: 'alex@example.com', email_sent_at: null, email_claimed_at: null },
    { id: 2, name: 'Sam', email: 'sam@example.com', email_sent_at: null, email_claimed_at: null },
    { id: 3, name: 'Jo', email: 'jo@example.com', email_sent_at: null, email_claimed_at: null },
    { id: 4, name: 'Lee', email: null, email_sent_at: null, email_claimed_at: null },
  ];
  db.receiverOf = { 1: 2, 2: 3, 3: 4, 4: 1 };
  db.dailySent = 0;
  db.now = Date.UTC(2026, 11, 1);
  sendMatchEmail.mockReset();
  failFor();
  vi.stubEnv('NEXT_PUBLIC_BASE_URL', 'https://baseworkshop.app');
  vi.stubGlobal('fetch', vi.fn(async () => ({ json: async () => ({ success: true }) })));
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.mocked(console.error).mockRestore();
});

describe('POST /api/send-emails', () => {
  it('sends to everyone with an email and marks each of them sent', async () => {
    const res = await post(firstSend);
    expect(res.statusCode).toBe(200);
    expect(res.body).toEqual({ success: true, totalSent: 3, totalFailed: 0, failedNames: [] });
    expect(emailed().sort()).toEqual(['alex@example.com', 'jo@example.com', 'sam@example.com']);
    expect(sentNames()).toEqual(['Alex', 'Sam', 'Jo']);
    expect(db.draw.emails_sent_at).not.toBeNull();
    expect(db.dailySent).toBe(3);
  });

  it('leaves the people whose email failed unsent and names them', async () => {
    failFor('sam@example.com');
    const res = await post(firstSend);
    expect(res.statusCode).toBe(200);
    expect(res.body).toEqual({ success: true, totalSent: 2, totalFailed: 1, failedNames: ['Sam'] });
    expect(sentNames()).toEqual(['Alex', 'Jo']);
    expect(db.draw.emails_sent_at).not.toBeNull();
    expect(db.dailySent).toBe(2);
  });

  it('reopens the draw when every email on the first send fails', async () => {
    failFor('alex@example.com', 'sam@example.com', 'jo@example.com');
    const res = await post(firstSend);
    expect(res.statusCode).toBe(500);
    expect(sentNames()).toEqual([]);
    expect(db.draw.emails_sent_at).toBeNull();
    expect(db.dailySent).toBe(0);
  });

  it('still refuses a second full send with 409', async () => {
    await post(firstSend);
    sendMatchEmail.mockClear();
    const res = await post(firstSend);
    expect(res.statusCode).toBe(409);
    expect(sendMatchEmail).not.toHaveBeenCalled();
  });

  it('resends only to the people whose email failed, with the saved organizer details', async () => {
    failFor('sam@example.com');
    await post(firstSend);

    failFor();
    sendMatchEmail.mockClear();
    const res = await post(resend);
    expect(res.statusCode).toBe(200);
    expect(res.body).toEqual({ success: true, totalSent: 1, totalFailed: 0, failedNames: [] });
    expect(emailed()).toEqual(['sam@example.com']);
    expect(sendMatchEmail.mock.calls[0].slice(3, 5)).toEqual(['Pat', 'pat@example.com']);
    expect(sentNames()).toEqual(['Alex', 'Sam', 'Jo']);
    expect(db.dailySent).toBe(3);
  });

  it('keeps someone unsent when their resend fails again', async () => {
    failFor('sam@example.com');
    await post(firstSend);
    const res = await post(resend);
    expect(res.statusCode).toBe(500);
    expect(res.body.failedNames).toEqual(['Sam']);
    expect(sentNames()).toEqual(['Alex', 'Jo']);
    expect(db.draw.emails_sent_at).not.toBeNull();
  });

  it('sends nobody twice when two resends run at once', async () => {
    failFor('sam@example.com', 'jo@example.com');
    await post(firstSend);

    sendMatchEmail.mockReset();
    sendMatchEmail.mockImplementation(() => new Promise(resolve => setTimeout(resolve, 10)));
    const [first, second] = await Promise.all([post(resend), post(resend)]);

    expect(emailed().sort()).toEqual(['jo@example.com', 'sam@example.com']);
    expect([first.statusCode, second.statusCode].sort()).toEqual([200, 409]);
    expect(sentNames()).toEqual(['Alex', 'Sam', 'Jo']);
  });

  it('sends nobody twice when two first sends run at once', async () => {
    sendMatchEmail.mockImplementation(() => new Promise(resolve => setTimeout(resolve, 10)));
    const [first, second] = await Promise.all([post(firstSend), post(firstSend)]);
    expect(emailed().sort()).toEqual(['alex@example.com', 'jo@example.com', 'sam@example.com']);
    expect([first.statusCode, second.statusCode].sort()).toEqual([200, 409]);
  });

  it('rejects a resend without the admin key with 403', async () => {
    failFor('sam@example.com');
    await post(firstSend);
    sendMatchEmail.mockClear();

    for (const key of [undefined, 'wrong-key']) {
      const res = await post({ ...resend, key });
      expect(res.statusCode).toBe(403);
    }
    expect(sendMatchEmail).not.toHaveBeenCalled();
    expect(sentNames()).toEqual(['Alex', 'Jo']);
  });

  it('rejects a resend before the first send with 409', async () => {
    const res = await post(resend);
    expect(res.statusCode).toBe(409);
    expect(sendMatchEmail).not.toHaveBeenCalled();
  });

  it('rejects a resend when everyone already has their email with 409', async () => {
    await post(firstSend);
    sendMatchEmail.mockClear();
    const res = await post(resend);
    expect(res.statusCode).toBe(409);
    expect(sendMatchEmail).not.toHaveBeenCalled();
  });

  it('still requires Turnstile for a resend', async () => {
    failFor('sam@example.com');
    await post(firstSend);
    sendMatchEmail.mockClear();

    const missing = await post({ ...resend, turnstileToken: undefined });
    expect(missing.statusCode).toBe(400);

    vi.stubGlobal('fetch', vi.fn(async () => ({ json: async () => ({ success: false }) })));
    const rejected = await post(resend);
    expect(rejected.statusCode).toBe(403);
    expect(sendMatchEmail).not.toHaveBeenCalled();
  });

  it('still counts a resend against the daily cap', async () => {
    failFor('sam@example.com');
    await post(firstSend);
    sendMatchEmail.mockClear();

    db.dailySent = 495;
    const res = await post(resend);
    expect(res.statusCode).toBe(503);
    expect(sendMatchEmail).not.toHaveBeenCalled();
    expect(sentNames()).toEqual(['Alex', 'Jo']);
  });

  it('records each email and its daily count as soon as that email goes out', async () => {
    const pending: Record<string, () => void> = {};
    sendMatchEmail.mockImplementation((_name: string, email: string) => new Promise<void>(resolve => { pending[email] = resolve; }));
    const sending = post(firstSend);
    await vi.waitFor(() => expect(Object.keys(pending)).toHaveLength(3));
    expect(claimedNames()).toEqual(['Alex', 'Sam', 'Jo']);
    expect(sentNames()).toEqual([]);

    pending['sam@example.com']();
    await vi.waitFor(() => expect(sentNames()).toEqual(['Sam']));
    expect(db.dailySent).toBe(1);
    expect(claimedNames()).toEqual(['Alex', 'Jo']);

    pending['alex@example.com']();
    pending['jo@example.com']();
    expect((await sending).statusCode).toBe(200);
    expect(sentNames()).toEqual(['Alex', 'Sam', 'Jo']);
    expect(claimedNames()).toEqual([]);
    expect(db.dailySent).toBe(3);
  });

  it('releases the claim on someone whose email failed', async () => {
    failFor('sam@example.com');
    await post(firstSend);
    expect(claimedNames()).toEqual([]);
    expect(sentNames()).toEqual(['Alex', 'Jo']);
  });

  it('keeps the successes recorded when the request dies mid-send', async () => {
    // Jo's send never settles, like a function killed at its time limit
    sendMatchEmail.mockImplementation(async (_name: string, email: string) => {
      if (email === 'jo@example.com') await new Promise(() => {});
    });
    void post(firstSend);
    await vi.waitFor(() => expect(sentNames()).toEqual(['Alex', 'Sam']));
    expect(db.dailySent).toBe(2);
    expect(claimedNames()).toEqual(['Jo']);

    // Jo shows as not delivered, and once the claim expires a resend reaches them
    failFor();
    sendMatchEmail.mockClear();
    db.now += 6 * 60_000;
    const res = await post(resend);
    expect(res.statusCode).toBe(200);
    expect(emailed()).toEqual(['jo@example.com']);
    expect(sentNames()).toEqual(['Alex', 'Sam', 'Jo']);
    expect(db.dailySent).toBe(3);
  });

  it('lets a claim older than 5 minutes be taken again, but not a fresh one', async () => {
    failFor('sam@example.com');
    await post(firstSend);
    failFor();
    sendMatchEmail.mockClear();

    const sam = db.participants.find(p => p.name === 'Sam')!;
    sam.email_claimed_at = db.now - 4 * 60_000;
    const fresh = await post(resend);
    expect(fresh.statusCode).toBe(409);
    expect(fresh.body.error).toBe('These emails are already being sent.');
    expect(sendMatchEmail).not.toHaveBeenCalled();

    sam.email_claimed_at = db.now - 6 * 60_000;
    const stale = await post(resend);
    expect(stale.statusCode).toBe(200);
    expect(emailed()).toEqual(['sam@example.com']);
    expect(sentNames()).toEqual(['Alex', 'Sam', 'Jo']);
  });

  it('rejects a retryFailed that is not a boolean', async () => {
    const res = await post({ ...resend, retryFailed: 'yes' });
    expect(res.statusCode).toBe(400);
  });
});
