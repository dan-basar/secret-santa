// @vitest-environment jsdom
import { describe, it, expect, afterEach, vi } from 'vitest';
import { render, screen, cleanup, fireEvent } from '@testing-library/react';
import PersonalLinks from '@/components/draw/PersonalLinks';
import type { AdminParticipant } from '@/types/api';

afterEach(() => {
  cleanup();
});

const person = (name: string, extra: Partial<AdminParticipant> = {}): AdminParticipant => ({
  name, email: null, group_name: null, reveal_code: `${name}2345`.slice(0, 8), email_sent_at: null, revealed_at: null, ...extra,
});

function renderLinks(participants: AdminParticipant[], props: Partial<Parameters<typeof PersonalLinks>[0]> = {}) {
  const onResend = vi.fn();
  render(
    <PersonalLinks
      participants={participants}
      emailsSent
      linkFor={(token) => `https://example.com/secret-santa/reveal/${token}`}
      onResend={onResend}
      canResend
      resendingPerson={null}
      resendError={null}
      {...props}
    />,
  );
  return onResend;
}

describe('personal links', () => {
  it('fills each Text link with a short message ending in that person’s link', () => {
    renderLinks([person('Sam', { reveal_code: 'k7Qm2xPa' })], { emailsSent: false });
    const href = screen.getByRole('link', { name: 'Text Sam their link' }).getAttribute('href')!;
    expect(href.startsWith('sms:?&body=')).toBe(true);
    expect(decodeURIComponent(href.slice('sms:?&body='.length)))
      .toBe('Hi Sam, your Secret Santa match is ready: https://example.com/secret-santa/reveal/k7Qm2xPa');
  });

  it('says beside each person whether their email went out and whether they opened their link', () => {
    renderLinks([
      person('Alex', { email: 'alex@example.com', email_sent_at: '2026-12-01T00:00:00.000Z', revealed_at: '2026-12-02T00:00:00.000Z' }),
      person('Sam', { email: 'sam@example.com' }),
      person('Jo'),
    ]);
    expect(screen.getByText('✓ Emailed to alex@example.com · Opened their link')).toBeTruthy();
    expect(screen.getByText('Not delivered to sam@example.com')).toBeTruthy();
    expect(screen.getByText('No email address')).toBeTruthy();
    // Only the failed row can be resent
    expect(screen.getAllByRole('button', { name: 'Resend' })).toHaveLength(1);
  });

  it('shows no email status before the emails go out', () => {
    renderLinks([person('Sam', { email: 'sam@example.com' }), person('Jo')], { emailsSent: false });
    expect(screen.queryByText(/sam@example\.com/)).toBeNull();
    expect(screen.queryByText('No email address')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Resend' })).toBeNull();
  });

  it('never says "No email address" when nobody in the draw has one', () => {
    renderLinks([person('Sam'), person('Jo')]);
    expect(screen.queryByText('No email address')).toBeNull();
  });

  it('resends to one person, or to a corrected address', () => {
    const onResend = renderLinks([person('Alex', { email: 'alex@example.com', email_sent_at: 'x' }), person('Sam', { email: 'sam@example' })]);
    fireEvent.click(screen.getByRole('button', { name: 'Resend' }));
    expect(onResend).toHaveBeenLastCalledWith(1);

    fireEvent.click(screen.getByRole('button', { name: 'Change email' }));
    const input = screen.getByLabelText('Sam’s email') as HTMLInputElement;
    expect(input.value).toBe('sam@example');
    const save = screen.getByRole('button', { name: 'Save & send' }) as HTMLButtonElement;
    expect(save.disabled).toBe(true);
    fireEvent.change(input, { target: { value: ' sam@example.com ' } });
    fireEvent.click(save);
    expect(onResend).toHaveBeenLastCalledWith(1, 'sam@example.com');
  });

  it('holds Resend until the security check is ready, and shows a resend error on its row', () => {
    renderLinks([person('Sam', { email: 'sam@example.com' })], { canResend: false, resendError: { person: 0, message: 'Sam already has their email.' } });
    expect((screen.getByRole('button', { name: 'Resend' }) as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByText(/security check/)).toBeTruthy();
    expect(screen.getByRole('alert').textContent).toBe('Sam already has their email.');
  });
});
