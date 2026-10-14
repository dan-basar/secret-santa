import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { NextApiRequest, NextApiResponse } from 'next';

// A tiny in-memory stand-in for the tables send-emails touches. Each sql`...`
// call is answered by matching its text, and runs synchronously, so a single
// UPDATE ... WHERE email_sent_at IS NULL is atomic just as it is in Postgres.
// Claim times and email-log hours are milliseconds on a fake clock, db.now, so
// tests can age them.
interface FakeParticipant { id: number; name: string; email: string | null; email_sent_at: string | null; email_claimed_at: number | null }
const db = vi.hoisted(() => ({
  now: 0,
  draw: {} as {
    id: string; admin_key: string; deleted_at: string | null; emails_sent_at: string | null; organizer_name: string | null; organizer_email: string | null;
    organizer_note: string | null; budget_cents: number | null; exchange_date: string | null;
  },
  participants: [] as FakeParticipant[],
  receiverOf: {} as Record<number, number>,
  emailLog: [] as { hour: number; sent: number }[],
  // Each awaited query or transaction is one HTTPS request to Neon
  roundTrips: 0,
}));

const { HOUR, hourOf, emailsCounted } = vi.hoisted(() => {
  const HOUR = 3_600_000;
  const hourOf = (ms: number) => Math.floor(ms / HOUR) * HOUR;
  // What the cap counts: every hourly row that can hold a send from the last 24 hours
  const emailsCounted = () => db.emailLog.filter(r => r.hour > db.now - 25 * HOUR).reduce((sum, r) => sum + r.sent, 0);
  return { HOUR, hourOf, emailsCounted };
});

vi.mock('@/lib/db', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/db')>();

  function reserve(count: number): Date {
    const hour = hourOf(db.now);
    const row = db.emailLog.find(r => r.hour === hour);
    if (row) row.sent += count;
    else db.emailLog.push({ hour, sent: count });
    return new Date(hour);
  }

  function run(text: string, values: unknown[]): unknown[] {
    // The one statement that checks the cap, claims the draw and participants,
    // and reserves the cap for whoever was claimed
    if (text.includes('WITH cap AS')) {
      const [count, limit, organizerName, organizerEmail, note, budgetCents, exchangeDate, , retryFailed, ids, expiryMinutes] =
        values as [number, number, string, string, string | null, number | null, string | null, string, boolean, number[], number];
      // The organizer's own link email, reserved with the claims on a first send
      const organizerCount = values[values.length - 1] as number;
      const capOk = emailsCounted() + count <= limit;
      const drawClaimed = capOk && !retryFailed && !db.draw.emails_sent_at;
      if (drawClaimed) {
        db.draw.emails_sent_at = 'now';
        db.draw.organizer_name = organizerName;
        db.draw.organizer_email = organizerEmail;
        db.draw.organizer_note = note;
        db.draw.budget_cents = budgetCents;
        db.draw.exchange_date = exchangeDate;
      }
      const claimed = capOk && (retryFailed || drawClaimed)
        ? db.participants.filter(p => ids.includes(p.id) && !p.email_sent_at
          && (p.email_claimed_at === null || p.email_claimed_at < db.now - expiryMinutes * 60_000))
        : [];
      for (const p of claimed) p.email_claimed_at = db.now;
      let reservedHour: Date | null = null;
      if (claimed.length) {
        reservedHour = reserve(claimed.length + organizerCount);
      }
      return [{ cap_ok: capOk, draw_claimed: drawClaimed, claimed_ids: claimed.map(p => p.id), reserved_hour: reservedHour }];
    }
    // A first send with nobody to email: reserve one email for the organizer's
    // link, and save the exchange details
    if (text.includes('WITH organizer_cap AS')) {
      const [limit, note, budgetCents, exchangeDate] = values as [number, string | null, number | null, string | null];
      const capOk = emailsCounted() + 1 <= limit;
      if (capOk && !db.draw.emails_sent_at) {
        db.draw.organizer_note = note;
        db.draw.budget_cents = budgetCents;
        db.draw.exchange_date = exchangeDate;
      }
      return [{ cap_ok: capOk, reserved_hour: capOk ? reserve(1) : null }];
    }
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
    if (text.includes('pg_advisory_xact_lock')) return [{}];
    if (text.includes('UPDATE EmailSendLog')) {
      const [count, hour] = values as [number, Date];
      db.emailLog.find(r => r.hour === hour.getTime())!.sent -= count;
      return [];
    }
    if (text.includes('UPDATE Draws') && text.includes('emails_sent_at = NULL')) {
      db.draw.emails_sent_at = null;
      return [];
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
    throw new Error(`Unexpected query: ${text}`);
  }

  const sql = Object.assign(
    vi.fn((strings: TemplateStringsArray, ...values: unknown[]) => {
      const text = strings.join('$');
      return { text, values, then: (resolve: (rows: unknown[]) => void, reject: (err: unknown) => void) => {
        db.roundTrips++;
        try { resolve(run(text, values)); } catch (err) { reject(err); }
      } };
    }),
    { transaction: vi.fn(async (queries: Array<{ text: string; values: unknown[] }>) => {
      db.roundTrips++;
      return queries.map(q => run(q.text, q.values));
    }) }
  );
  return { ...actual, sql };
});

const sendMatchEmail = vi.hoisted(() => vi.fn());
const sendOrganizerLinkEmail = vi.hoisted(() => vi.fn());
vi.mock('@/lib/email', () => ({ sendMatchEmail, sendOrganizerLinkEmail }));

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
  db.draw = {
    id: DRAW_ID, admin_key: ADMIN_KEY, deleted_at: null, emails_sent_at: null, organizer_name: null, organizer_email: null,
    organizer_note: null, budget_cents: null, exchange_date: null,
  };
  db.participants = [
    { id: 1, name: 'Alex', email: 'alex@example.com', email_sent_at: null, email_claimed_at: null },
    { id: 2, name: 'Sam', email: 'sam@example.com', email_sent_at: null, email_claimed_at: null },
    { id: 3, name: 'Jo', email: 'jo@example.com', email_sent_at: null, email_claimed_at: null },
    { id: 4, name: 'Lee', email: null, email_sent_at: null, email_claimed_at: null },
  ];
  db.receiverOf = { 1: 2, 2: 3, 3: 4, 4: 1 };
  db.emailLog = [];
  db.now = Date.UTC(2026, 11, 1);
  db.roundTrips = 0;
  sendMatchEmail.mockReset();
  sendOrganizerLinkEmail.mockReset();
  sendOrganizerLinkEmail.mockImplementation(async () => {});
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
    expect(res.body).toEqual({ success: true, totalSent: 3, totalFailed: 0, failedNames: [], organizerLinkSent: true });
    expect(emailed().sort()).toEqual(['alex@example.com', 'jo@example.com', 'sam@example.com']);
    expect(sentNames()).toEqual(['Alex', 'Sam', 'Jo']);
    expect(db.draw.emails_sent_at).not.toBeNull();
    // Three match emails and the organizer's link
    expect(emailsCounted()).toBe(4);
  });

  it('emails the organizer their organizer link on the first send', async () => {
    await post(firstSend);
    expect(sendOrganizerLinkEmail).toHaveBeenCalledTimes(1);
    expect(sendOrganizerLinkEmail).toHaveBeenCalledWith('Pat', 'pat@example.com', ADMIN_KEY);
  });

  it('still completes the send when the organizer link email fails, and gives back its reservation', async () => {
    sendOrganizerLinkEmail.mockImplementation(async () => { throw new Error('SMTP refused pat@example.com'); });
    const res = await post(firstSend);
    expect(res.statusCode).toBe(200);
    expect(res.body).toEqual({ success: true, totalSent: 3, totalFailed: 0, failedNames: [], organizerLinkSent: false });
    expect(sentNames()).toEqual(['Alex', 'Sam', 'Jo']);
    expect(emailsCounted()).toBe(3);
  });

  describe('when nobody has an email address', () => {
    beforeEach(() => {
      for (const p of db.participants) p.email = null;
    });

    it('emails just the organizer their link, without marking the draw sent', async () => {
      const res = await post(firstSend);
      expect(res.statusCode).toBe(200);
      expect(res.body).toEqual({ success: true, totalSent: 0, totalFailed: 0, failedNames: [], organizerLinkSent: true });
      expect(sendMatchEmail).not.toHaveBeenCalled();
      expect(sendOrganizerLinkEmail).toHaveBeenCalledWith('Pat', 'pat@example.com', ADMIN_KEY);
      // Edit & Redraw stays open, and the organizer can ask again
      expect(db.draw.emails_sent_at).toBeNull();
      expect(emailsCounted()).toBe(1);
      expect((await post(firstSend)).statusCode).toBe(200);
      expect(emailsCounted()).toBe(2);
    });

    it('answers 503 when the daily cap is full', async () => {
      db.emailLog = [{ hour: hourOf(db.now), sent: 495 }];
      const res = await post(firstSend);
      expect(res.statusCode).toBe(503);
      expect(sendOrganizerLinkEmail).not.toHaveBeenCalled();
    });

    it('answers 500 and gives back the reservation when the email fails', async () => {
      sendOrganizerLinkEmail.mockImplementation(async () => { throw new Error('SMTP refused pat@example.com'); });
      const res = await post(firstSend);
      expect(res.statusCode).toBe(500);
      expect(res.body).toEqual({ error: 'Failed to send your organizer link. Please try again.' });
      expect(emailsCounted()).toBe(0);
    });

    it('still requires the organizer name and email', async () => {
      const res = await post({ ...firstSend, organizerEmail: '' });
      expect(res.statusCode).toBe(400);
      expect(sendOrganizerLinkEmail).not.toHaveBeenCalled();
    });
  });

  it('leaves the people whose email failed unsent and names them', async () => {
    failFor('sam@example.com');
    const res = await post(firstSend);
    expect(res.statusCode).toBe(200);
    expect(res.body).toEqual({ success: true, totalSent: 2, totalFailed: 1, failedNames: ['Sam'], organizerLinkSent: true });
    expect(sentNames()).toEqual(['Alex', 'Jo']);
    expect(db.draw.emails_sent_at).not.toBeNull();
    expect(emailsCounted()).toBe(3);
  });

  it('reopens the draw when every email on the first send fails', async () => {
    failFor('alex@example.com', 'sam@example.com', 'jo@example.com');
    const res = await post(firstSend);
    expect(res.statusCode).toBe(500);
    expect(sentNames()).toEqual([]);
    expect(db.draw.emails_sent_at).toBeNull();
    // Only the organizer's link went out
    expect(emailsCounted()).toBe(1);
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
    expect(res.body).toEqual({ success: true, totalSent: 1, totalFailed: 0, failedNames: [], organizerLinkSent: false });
    expect(emailed()).toEqual(['sam@example.com']);
    expect(sendMatchEmail.mock.calls[0].slice(3, 5)).toEqual(['Pat', 'pat@example.com']);
    expect(sentNames()).toEqual(['Alex', 'Sam', 'Jo']);
    // The resend doesn't email the organizer their link again
    expect(sendOrganizerLinkEmail).toHaveBeenCalledTimes(1);
    expect(emailsCounted()).toBe(4);
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

  it('rejects a CAPTCHA token that is not a string with 400', async () => {
    const res = await post({ ...firstSend, turnstileToken: { token: 'x' } });
    expect(res.statusCode).toBe(400);
    expect(res.body.error).toBe('CAPTCHA verification required.');
  });

  it('answers 403 with an error, not a crash, when Cloudflare cannot be reached', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new TypeError('fetch failed'); }));
    const res = await post(firstSend);
    expect(res.statusCode).toBe(403);
    expect(res.body).toEqual({ error: 'CAPTCHA verification failed.' });
    expect(sendMatchEmail).not.toHaveBeenCalled();
    expect(db.draw.emails_sent_at).toBeNull();
  });

  it('answers 403 with an error, not a crash, when Cloudflare replies with something other than JSON', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ json: async () => { throw new SyntaxError('Unexpected token <'); } })));
    const res = await post(firstSend);
    expect(res.statusCode).toBe(403);
    expect(res.body).toEqual({ error: 'CAPTCHA verification failed.' });
    expect(sendMatchEmail).not.toHaveBeenCalled();
  });

  it('still counts a resend against the daily cap', async () => {
    failFor('sam@example.com');
    await post(firstSend);
    sendMatchEmail.mockClear();

    db.emailLog[0].sent = 495;
    const res = await post(resend);
    expect(res.statusCode).toBe(503);
    expect(sendMatchEmail).not.toHaveBeenCalled();
    expect(sentNames()).toEqual(['Alex', 'Jo']);
  });

  it('counts the last 24 hours, not the calendar day', async () => {
    // 493 sent at 23:30 UTC; ten minutes past midnight they still count
    db.now = Date.UTC(2026, 11, 2, 0, 10);
    db.emailLog = [{ hour: Date.UTC(2026, 11, 1, 23), sent: 493 }];
    const blocked = await post(firstSend);
    expect(blocked.statusCode).toBe(503);
    expect(blocked.body.error).toBe('The site\'s email limit is reached for now. Try again in a few hours, or send each person their personal link below.');
    expect(sendMatchEmail).not.toHaveBeenCalled();
    expect(db.draw.emails_sent_at).toBeNull();

    // A day later that hour has rolled out of the window
    db.now += 24 * HOUR;
    const res = await post(firstSend);
    expect(res.statusCode).toBe(200);
    expect(emailsCounted()).toBe(4);
  });

  it('sends right up to the cap and no further', async () => {
    // Three match emails and the organizer's link fill it exactly
    db.emailLog = [{ hour: hourOf(db.now) - 5 * HOUR, sent: 491 }];
    const res = await post(firstSend);
    expect(res.statusCode).toBe(200);
    expect(emailsCounted()).toBe(495);
  });

  it('reserves nothing for a second first send that is refused', async () => {
    sendMatchEmail.mockImplementation(() => new Promise(resolve => setTimeout(resolve, 10)));
    await Promise.all([post(firstSend), post(firstSend)]);
    expect(emailsCounted()).toBe(4);
  });

  it('reserves the cap before sending and records each email as soon as it goes out', async () => {
    const pending: Record<string, () => void> = {};
    sendMatchEmail.mockImplementation((_name: string, email: string) => new Promise<void>(resolve => { pending[email] = resolve; }));
    const sending = post(firstSend);
    await vi.waitFor(() => expect(Object.keys(pending)).toHaveLength(3));
    expect(claimedNames()).toEqual(['Alex', 'Sam', 'Jo']);
    expect(sentNames()).toEqual([]);
    expect(emailsCounted()).toBe(4);

    pending['sam@example.com']();
    await vi.waitFor(() => expect(sentNames()).toEqual(['Sam']));
    expect(claimedNames()).toEqual(['Alex', 'Jo']);

    pending['alex@example.com']();
    pending['jo@example.com']();
    expect((await sending).statusCode).toBe(200);
    expect(sentNames()).toEqual(['Alex', 'Sam', 'Jo']);
    expect(claimedNames()).toEqual([]);
    expect(emailsCounted()).toBe(4);
  });

  it('makes two database round trips before the first email goes out', async () => {
    let tripsBeforeSending = -1;
    sendMatchEmail.mockImplementation(async () => {
      if (tripsBeforeSending < 0) tripsBeforeSending = db.roundTrips;
    });
    const res = await post(firstSend);
    expect(res.statusCode).toBe(200);
    // The read, then the cap check, claims and reservation together
    expect(tripsBeforeSending).toBe(2);
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
    // Jo's email may have gone out, so the cap keeps counting it
    expect(emailsCounted()).toBe(4);
    expect(claimedNames()).toEqual(['Jo']);

    // Jo shows as not delivered, and once the claim expires a resend reaches them
    failFor();
    sendMatchEmail.mockClear();
    db.now += 6 * 60_000;
    const res = await post(resend);
    expect(res.statusCode).toBe(200);
    expect(emailed()).toEqual(['jo@example.com']);
    expect(sentNames()).toEqual(['Alex', 'Sam', 'Jo']);
    expect(emailsCounted()).toBe(5);
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

  it('rejects an organizer name with a web address before checking the CAPTCHA', async () => {
    const res = await post({ ...firstSend, organizerName: 'Pat at https://evil.example' });
    expect(res.statusCode).toBe(400);
    expect(res.body).toEqual({ error: 'Organizer name cannot contain a web address.' });
    expect(sendMatchEmail).not.toHaveBeenCalled();
  });

  it('rejects an organizer name or email too long for its column with 400', async () => {
    const longName = await post({ ...firstSend, organizerName: 'P'.repeat(201) });
    expect(longName.statusCode).toBe(400);
    expect(longName.body).toEqual({ error: 'Organizer name must be 200 characters or fewer.' });

    const longEmail = await post({ ...firstSend, organizerEmail: `${'p'.repeat(310)}@example.com` });
    expect(longEmail.statusCode).toBe(400);
    expect(longEmail.body).toEqual({ error: 'Organizer email must be 320 characters or fewer.' });
    expect(sendMatchEmail).not.toHaveBeenCalled();
  });

  it('rejects a retryFailed that is not a boolean', async () => {
    const res = await post({ ...resend, retryFailed: 'yes' });
    expect(res.statusCode).toBe(400);
  });
});

describe('exchange details', () => {
  const withDetails = { ...firstSend, organizerNote: '  Wrap it nicely  ', budget: '$25.50', exchangeDate: '2026-12-19' };
  const saved = { organizer_note: 'Wrap it nicely', budget_cents: 2550, exchange_date: '2026-12-19' };
  const none = { organizer_note: null, budget_cents: null, exchange_date: null };

  it('saves them with the first send and puts them in every match email', async () => {
    const res = await post(withDetails);
    expect(res.statusCode).toBe(200);
    expect(db.draw).toMatchObject(saved);
    expect(sendMatchEmail.mock.calls.map(call => call[6])).toEqual([saved, saved, saved]);
  });

  it('leaves them unset when none are given or they are empty', async () => {
    await post({ ...firstSend, organizerNote: '', budget: '', exchangeDate: '' });
    expect(db.draw).toMatchObject(none);
    expect(sendMatchEmail.mock.calls[0][6]).toEqual(none);
  });

  it('keeps a budget of 0, which shows as "No limit set"', async () => {
    await post({ ...firstSend, budget: '0' });
    expect(db.draw.budget_cents).toBe(0);
  });

  it('resends with the details saved by the first send, ignoring any in the body', async () => {
    failFor('sam@example.com');
    await post(withDetails);
    failFor();
    sendMatchEmail.mockClear();

    await post({ ...resend, organizerNote: 'Changed', budget: '99' });
    expect(emailed()).toEqual(['sam@example.com']);
    expect(sendMatchEmail.mock.calls[0][6]).toEqual(saved);
    expect(db.draw).toMatchObject(saved);
  });

  it('saves them with the organizer link email when nobody has an email address', async () => {
    for (const p of db.participants) p.email = null;
    const res = await post(withDetails);
    expect(res.statusCode).toBe(200);
    expect(db.draw).toMatchObject(saved);
    expect(db.draw.emails_sent_at).toBeNull();
  });

  it('rejects a note with a link or HTML, or longer than 150 characters', async () => {
    const link = await post({ ...firstSend, organizerNote: 'See bit.ly/gifts' });
    expect(link.statusCode).toBe(400);
    expect(link.body).toEqual({ error: 'Links aren’t allowed in the note.' });

    const html = await post({ ...firstSend, organizerNote: '<b>Hi</b>' });
    expect(html.statusCode).toBe(400);

    const long = await post({ ...firstSend, organizerNote: 'n'.repeat(151) });
    expect(long.statusCode).toBe(400);
    expect(sendMatchEmail).not.toHaveBeenCalled();
    expect(db.draw.emails_sent_at).toBeNull();
  });

  it('rejects a budget that is not a dollar amount up to $10,000', async () => {
    for (const budget of ['abc', '12.345', '-5', '10000.01', 25]) {
      const res = await post({ ...firstSend, budget });
      expect(res.statusCode).toBe(400);
    }
    expect((await post({ ...firstSend, budget: '10,000' })).statusCode).toBe(200);
  });

  it('rejects an exchange date that is not a real day', async () => {
    for (const exchangeDate of ['2026-02-30', '12/19/2026', 'soon', 20261219]) {
      const res = await post({ ...firstSend, exchangeDate });
      expect(res.statusCode).toBe(400);
    }
    expect(sendMatchEmail).not.toHaveBeenCalled();
  });
});
