import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const sendMail = vi.fn();
const createTransport = vi.fn((_options: Record<string, unknown>) => ({ sendMail }));
vi.mock('nodemailer', () => ({
  default: { createTransport },
}));

const { sendMatchEmail, revealUrl } = await import('@/lib/email');

const TOKEN = '3f2a9c1e-5b7d-4e8a-9c21-7d4e5f6a8b90';

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
      TOKEN
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
    await sendMatchEmail('Alex', 'alex@example.com', 'Sam', 'Pat', 'pat@example.com', TOKEN);

    const { html, text } = sendMail.mock.calls[0][0];
    const link = `https://baseworkshop.app/secret-santa/reveal/${TOKEN}`;

    expect(html).toContain(`href="${link}"`);
    expect(html).toContain('View your match');
    expect(text).toContain(link);
  });

  it('shows the hosted logo at a fixed size above the greeting', async () => {
    await sendMatchEmail('Alex', 'alex@example.com', 'Sam', 'Pat', 'pat@example.com', TOKEN);

    const { html } = sendMail.mock.calls[0][0];

    expect(html).toContain('<img src="https://baseworkshop.app/secret-santa/icon-192.png" width="96" height="96" alt="Secret Santa Picker"');
    expect(html.indexOf('<img')).toBeLessThan(html.indexOf('Hi Alex,'));
  });

  it('keeps the match name out of the first lines of the body', async () => {
    await sendMatchEmail('Alex', 'alex@example.com', 'Sam', 'Pat', 'pat@example.com', TOKEN);

    const { text } = sendMail.mock.calls[0][0];
    const opening = text.split('\n').slice(0, 3).join('\n');

    expect(opening).toContain('Hi Alex,');
    expect(opening).not.toContain('Sam');
  });
});

describe('transporter', () => {
  it('pools 3 reused SMTP connections', () => {
    expect(createTransport).toHaveBeenCalledOnce();
    expect(createTransport.mock.calls[0][0]).toMatchObject({ service: 'gmail', pool: true, maxConnections: 3 });
  });

  it('gives up on a stalled connection well within the 60s send-emails limit', () => {
    const options = createTransport.mock.calls[0][0];
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
