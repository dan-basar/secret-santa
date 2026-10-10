import { describe, expect, it, vi } from 'vitest';

const sendMail = vi.fn();
vi.mock('nodemailer', () => ({
  default: { createTransport: () => ({ sendMail }) },
}));

const { sendMatchEmail } = await import('@/lib/email');

describe('sendMatchEmail', () => {
  it('escapes every value in the HTML body and keeps the text body as typed', async () => {
    await sendMatchEmail(
      'Tom & Jerry',
      'tom@example.com',
      '<b>Spike</b>',
      `"Santa" O'Claus`,
      'santa@example.com<script>'
    );

    const { html, text } = sendMail.mock.calls[0][0];

    expect(html).toContain('Dear Tom &amp; Jerry,');
    expect(html).toContain('<strong>&lt;b&gt;Spike&lt;/b&gt;</strong>');
    expect(html).toContain('sent by &quot;Santa&quot; O&#39;Claus.');
    expect(html).toContain('organizer at santa@example.com&lt;script&gt; if');
    expect(html).not.toContain('<b>');
    expect(html).not.toContain('<script>');

    expect(text).toContain('Dear Tom & Jerry,');
    expect(text).toContain(`sent by "Santa" O'Claus.`);
  });
});
