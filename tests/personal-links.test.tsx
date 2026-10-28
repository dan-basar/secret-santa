// @vitest-environment jsdom
import { describe, it, expect, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import PersonalLinks from '@/components/draw/PersonalLinks';

afterEach(() => {
  cleanup();
});

describe('personal links', () => {
  it('fills each Text link with a short message ending in that person’s link', () => {
    render(
      <PersonalLinks
        participants={[{ name: 'Sam', email: null, group_name: null, reveal_code: 'k7Qm2xPa', email_sent_at: null }]}
        emailsSent={false}
        linkFor={(token) => `https://example.com/secret-santa/reveal/${token}`}
      />,
    );
    const href = screen.getByRole('link', { name: 'Text Sam their link' }).getAttribute('href')!;
    expect(href.startsWith('sms:?&body=')).toBe(true);
    expect(decodeURIComponent(href.slice('sms:?&body='.length)))
      .toBe('Hi Sam, your Secret Santa match is ready: https://example.com/secret-santa/reveal/k7Qm2xPa');
  });
});
