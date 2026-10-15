import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const sendMail = vi.fn();
const createTransport = vi.fn((_options: Record<string, unknown>) => ({ sendMail }));
vi.mock('nodemailer', () => ({
  default: { createTransport },
}));

const { sendMatchEmail, sendOrganizerLinkEmail, revealUrl, organizerUrl } = await import('@/lib/email');
// The transporter is created once at import; copy the calls now, because Vitest clears mocks before each test
const transportCalls = createTransport.mock.calls.slice();

const TOKEN = '3f2a9c1e-5b7d-4e8a-9c21-7d4e5f6a8b90';
const NO_DETAILS = { organizer_note: null, budget_cents: null, exchange_date: null };
const DETAILS = { organizer_note: 'Wrap it & bring it', budget_cents: 3000, exchange_date: '2026-12-19' };

beforeEach(() => {
  sendMail.mockClear();
  vi.stubEnv('NEXT_PUBLIC_BASE_URL', 'https://baseworkshop.app');
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('sendMatchEmail', () => {
  it('escapes every value in the HTML body and keeps the text body as typed', async () => {
    await sendMatchEmail(
      'Tom & Jerry',
      'tom@example.com',
      '<b>Spike</b>',
      `"Santa" O'Claus`,
      'santa@example.com<script>',
      TOKEN,
      NO_DETAILS
    );

    const { html, text } = sendMail.mock.calls[0][0];

    expect(html).toContain('Hi Tom &amp; Jerry,');
    expect(html).toContain('<strong>&lt;b&gt;Spike&lt;/b&gt;</strong>');
    expect(html).toContain('sent by &quot;Santa&quot; O&#39;Claus.');
    expect(html).toContain('organizer at santa@example.com&lt;script&gt; if');
    expect(html).not.toContain('<b>');
    expect(html).not.toContain('<script>');

    expect(text).toContain('Hi Tom & Jerry,');
    expect(text).toContain(`sent by "Santa" O'Claus.`);
  });

  it('links to the personal reveal page', async () => {
    await sendMatchEmail('Alex', 'alex@example.com', 'Sam', 'Pat', 'pat@example.com', TOKEN, NO_DETAILS);

    const { html, text } = sendMail.mock.calls[0][0];
    const link = `https://baseworkshop.app/secret-santa/reveal/${TOKEN}`;

    expect(html).toContain(`href="${link}"`);
    expect(html).toContain('View your match');
    expect(text).toContain(link);
  });

  it('sends replies to the organizer', async () => {
    await sendMatchEmail('Alex', 'alex@example.com', 'Sam', 'Pat', 'pat@example.com', TOKEN, NO_DETAILS);
    expect(sendMail.mock.calls[0][0].replyTo).toBe('pat@example.com');
  });

  it('shows the hosted logo at a fixed size above the greeting', async () => {
    await sendMatchEmail('Alex', 'alex@example.com', 'Sam', 'Pat', 'pat@example.com', TOKEN, NO_DETAILS);

    const { html } = sendMail.mock.calls[0][0];

    expect(html).toContain('<img src="https://baseworkshop.app/secret-santa/icon-192.png" width="96" height="96" alt="Secret Santa Picker"');
    expect(html.indexOf('<img')).toBeLessThan(html.indexOf('Hi Alex,'));
  });

  it('keeps the match name out of the first lines of the body', async () => {
    await sendMatchEmail('Alex', 'alex@example.com', 'Sam', 'Pat', 'pat@example.com', TOKEN, NO_DETAILS);

    const { text } = sendMail.mock.calls[0][0];
    const opening = text.split('\n').slice(0, 3).join('\n');

    expect(opening).toContain('Hi Alex,');
    expect(opening).not.toContain('Sam');
  });

  it('goes straight to the match when no details are set', async () => {
    await sendMatchEmail('Alex', 'alex@example.com', 'Sam', 'Pat', 'pat@example.com', TOKEN, NO_DETAILS);

    const { html, text } = sendMail.mock.calls[0][0];

    expect(text).toContain("your match is below.\n\nYou have drawn Sam's name for the gift exchange!\n\n");
    expect(html).not.toContain('First, some details:');
    expect(html).not.toContain('big reveal');
    expect(html).toContain('<p style="font-size: 20px; line-height: 1.5; margin-top: 32px;">');
  });

  it('puts the note, budget and date before the match, the note escaped in HTML', async () => {
    await sendMatchEmail('Alex', 'alex@example.com', 'Sam', 'Pat', 'pat@example.com', TOKEN, DETAILS);

    const { html, text } = sendMail.mock.calls[0][0];

    expect(text).toContain([
      'The Secret Santa draw is done, and your match is below.',
      '',
      'First, some details:',
      'A note from your organizer:',
      '"Wrap it & bring it"',
      'Budget: $30',
      'Exchange: Saturday, December 19',
      '',
      'And now the big reveal:',
      '',
      "You have drawn Sam's name for the gift exchange!",
    ].join('\n'));

    expect(html).toContain('&ldquo;Wrap it &amp; bring it&rdquo;');
    expect(html).toContain('<strong>Budget:</strong> $30');
    expect(html).toContain('<strong>Exchange:</strong> Saturday, December 19');
    const order = ['First, some details:', 'A note from your organizer:', 'Budget:', 'Exchange:', 'And now the big reveal:', '<strong>Sam</strong>'];
    const positions = order.map(part => html.indexOf(part));
    expect(positions.every(p => p > 0)).toBe(true);
    expect([...positions].sort((a, b) => a - b)).toEqual(positions);
  });

  it('leaves out each detail that is not set, and shows a $0 budget as "No limit set"', async () => {
    await sendMatchEmail('Alex', 'alex@example.com', 'Sam', 'Pat', 'pat@example.com', TOKEN, { organizer_note: null, budget_cents: 0, exchange_date: null });

    const { html, text } = sendMail.mock.calls[0][0];

    expect(text).toContain('First, some details:\nBudget: No limit set\n\nAnd now the big reveal:');
    expect(html).toContain('<strong>Budget:</strong> No limit set');
    expect(html).not.toContain('A note from your organizer');
    expect(html).not.toContain('Exchange:');
  });
});

describe('Gmail trimming', () => {
  it('gives every email its own X-Entity-Ref-ID so Gmail does not group them', async () => {
    await sendMatchEmail('Alex', 'alex@example.com', 'Sam', 'Pat', 'pat@example.com', TOKEN, NO_DETAILS);
    await sendMatchEmail('Alex', 'alex@example.com', 'Sam', 'Pat', 'pat@example.com', TOKEN, NO_DETAILS);
    await sendOrganizerLinkEmail('Pat', 'pat@example.com', 'aB3dE5gH7jK9mN');

    const ids = sendMail.mock.calls.map(call => call[0].headers['X-Entity-Ref-ID']);
    for (const id of ids) expect(id).toMatch(/^[0-9a-f-]{36}$/);
    expect(new Set(ids).size).toBe(3);
  });

  it('ends the match email with its own personal link, after the button and footer', async () => {
    await sendMatchEmail('Alex', 'alex@example.com', 'Sam', 'Pat', 'pat@example.com', TOKEN, NO_DETAILS);

    const { html } = sendMail.mock.calls[0][0];
    const link = `https://baseworkshop.app/secret-santa/reveal/${TOKEN}`;

    expect(html).toMatch(new RegExp(`Your personal link: ${link}</p>\\s*</div>\\s*$`));
    expect(html.indexOf('View your match')).toBeLessThan(html.indexOf('Happy Gifting'));
    expect(html.indexOf('Happy Gifting')).toBeLessThan(html.indexOf('Your personal link'));
  });

  it('uses no quoted-reply markup Gmail could fold away', async () => {
    await sendMatchEmail('Alex', 'alex@example.com', 'Sam', 'Pat', 'pat@example.com', TOKEN, DETAILS);
    const { html } = sendMail.mock.calls[0][0];
    expect(html).not.toMatch(/blockquote|gmail_quote|display:\s*none/i);
  });
});

describe('transporter', () => {
  it('pools 3 reused SMTP connections', () => {
    expect(transportCalls).toHaveLength(1);
    expect(transportCalls[0][0]).toMatchObject({ service: 'gmail', pool: true, maxConnections: 3 });
  });

  it('gives up on a stalled connection well within the 60s send-emails limit', () => {
    const options = transportCalls[0][0];
    for (const timeout of ['connectionTimeout', 'greetingTimeout', 'socketTimeout']) {
      expect(options[timeout]).toBeGreaterThan(0);
      expect(options[timeout]).toBeLessThanOrEqual(15_000);
    }
  });
});

describe('revealUrl', () => {
  it('adds the basePath once, whether or not the setting includes it', () => {
    const expected = `https://baseworkshop.app/secret-santa/reveal/${TOKEN}`;
    for (const base of [
      'https://baseworkshop.app',
      'https://baseworkshop.app/',
      'https://baseworkshop.app/secret-santa',
      'https://baseworkshop.app/secret-santa/',
    ]) {
      vi.stubEnv('NEXT_PUBLIC_BASE_URL', base);
      expect(revealUrl(TOKEN)).toBe(expected);
    }
  });
});

describe('sendOrganizerLinkEmail', () => {
  const KEY = 'aB3dE5gH7jK9mN';

  it('links to the organizer page with the key in the fragment', async () => {
    await sendOrganizerLinkEmail('Pat', 'pat@example.com', KEY);

    const { to, html, text, subject } = sendMail.mock.calls[0][0];
    const link = `https://baseworkshop.app/secret-santa/draw#${KEY}`;

    expect(organizerUrl(KEY)).toBe(link);
    expect(to).toBe('pat@example.com');
    expect(subject).toBe('🎁 Your Secret Santa organizer link');
    expect(html).toContain(`href="${link}"`);
    expect(text).toContain(link);
    expect(text).toContain('Keep it private');
  });

  it('escapes the organizer name in the HTML body', async () => {
    await sendOrganizerLinkEmail('<b>Pat</b>', 'pat@example.com', KEY);

    const { html, text } = sendMail.mock.calls[0][0];
    expect(html).toContain('Hi &lt;b&gt;Pat&lt;/b&gt;,');
    expect(html).not.toContain('<b>');
    expect(text).toContain('Hi <b>Pat</b>,');
  });
});
