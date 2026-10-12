// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import type { AdminDraw } from '@/types/api';

// Stands in for the Cloudflare widget, so a test can see whether it was rendered
vi.mock('@/components/draw/TurnstileWidget', () => ({ default: () => <div data-testid="turnstile" /> }));

import EmailSection from '@/components/draw/EmailSection';

function drawWith(emails: Array<string | null>): AdminDraw {
  return {
    id: 'draw-1',
    created_at: '2026-12-01T00:00:00.000Z',
    emails_sent_at: null,
    isAdmin: true,
    participants: emails.map((email, i) => ({ name: `P${i}`, email, group_name: null, reveal_token: `token-${i}`, email_sent_at: null })),
    matches: [],
  };
}

function renderSection(draw: AdminDraw) {
  render(
    <EmailSection
      draw={draw}
      unsentCount={draw.participants.filter((p) => p.email).length}
      organizerName=""
      organizerEmail=""
      onOrganizerNameChange={() => {}}
      onOrganizerEmailChange={() => {}}
      loading={false}
      error=""
      turnstileKey={0}
      onTurnstileToken={() => {}}
      hasTurnstileToken={false}
      onSend={() => {}}
    />,
  );
}

afterEach(() => {
  cleanup();
});

describe('email section before the first send', () => {
  it('disables the organizer fields and skips the CAPTCHA when nobody has an email', () => {
    renderSection(drawWith([null, null]));
    expect((screen.getByLabelText('Organizer Name') as HTMLInputElement).disabled).toBe(true);
    expect((screen.getByLabelText('Organizer Email') as HTMLInputElement).disabled).toBe(true);
    expect(screen.queryByTestId('turnstile')).toBeNull();
  });

  it('enables the organizer fields and shows the CAPTCHA when someone has an email', () => {
    renderSection(drawWith(['a@example.com', null]));
    expect((screen.getByLabelText('Organizer Name') as HTMLInputElement).disabled).toBe(false);
    expect((screen.getByLabelText('Organizer Email') as HTMLInputElement).disabled).toBe(false);
    expect(screen.getByTestId('turnstile')).toBeTruthy();
  });
});
