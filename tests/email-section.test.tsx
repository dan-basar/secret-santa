// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest';
import { useState } from 'react';
import { render, screen, cleanup, fireEvent } from '@testing-library/react';
import type { GetDrawResponse } from '@/types/api';

// Stands in for the Cloudflare widget, so a test can see whether it was rendered
vi.mock('@/components/draw/TurnstileWidget', () => ({ default: () => <div data-testid="turnstile" /> }));

import EmailSection from '@/components/draw/EmailSection';

function drawWith(emails: Array<string | null>): GetDrawResponse {
  return {
    id: 'draw-1',
    created_at: '2026-12-01T00:00:00.000Z',
    emails_sent_at: null,
    participants: emails.map((email, i) => ({ name: `P${i}`, email, group_name: null, reveal_token: `token-${i}`, email_sent_at: null })),
    matches: emails.map((_, i) => ({ giver: i, receiver: (i + 1) % emails.length })),
    organizer_note: null,
    budget_cents: null,
    exchange_date: null,
  };
}

// Holds the details as the draw page does, so typing updates the row and preview
function Section({ draw, organizerLinkNotice }: { draw: GetDrawResponse; organizerLinkNotice: string }) {
  const [note, setNote] = useState('');
  const [budget, setBudget] = useState('');
  const [date, setDate] = useState('');
  return (
    <EmailSection
      draw={draw}
      unsentCount={draw.participants.filter((p) => p.email && !p.email_sent_at).length}
      organizerName="Pat"
      organizerEmail="pat@example.com"
      onOrganizerNameChange={() => {}}
      onOrganizerEmailChange={() => {}}
      organizerNote={note}
      budget={budget}
      exchangeDate={date}
      onOrganizerNoteChange={setNote}
      onBudgetChange={setBudget}
      onExchangeDateChange={setDate}
      loading={false}
      error=""
      organizerLinkNotice={organizerLinkNotice}
      turnstileKey={0}
      onTurnstileToken={() => {}}
      hasTurnstileToken
      onSend={() => {}}
    />
  );
}

function renderSection(draw: GetDrawResponse, organizerLinkNotice = '') {
  render(<Section draw={draw} organizerLinkNotice={organizerLinkNotice} />);
}

const toggle = () => screen.getByRole('button', { name: /Add a note, budget, or date/ });

afterEach(() => {
  cleanup();
});

describe('email section before the first send', () => {
  it('offers to email just the organizer their link when nobody has an email', () => {
    renderSection(drawWith([null, null]));
    expect((screen.getByLabelText('Organizer Name') as HTMLInputElement).disabled).toBe(false);
    expect((screen.getByLabelText('Organizer Email') as HTMLInputElement).disabled).toBe(false);
    expect(screen.getByTestId('turnstile')).toBeTruthy();
    expect(screen.getByRole('button', { name: '📧 Email me my organizer link' })).toBeTruthy();
  });

  it('enables the organizer fields and shows the CAPTCHA when someone has an email', () => {
    renderSection(drawWith(['a@example.com', null]));
    expect((screen.getByLabelText('Organizer Name') as HTMLInputElement).disabled).toBe(false);
    expect((screen.getByLabelText('Organizer Email') as HTMLInputElement).disabled).toBe(false);
    expect(screen.getByTestId('turnstile')).toBeTruthy();
  });

  it('says the organizer gets their link too when there are match emails to send', () => {
    renderSection(drawWith(['a@example.com', null]));
    expect(screen.getByText(/You'll get your organizer link by email too/)).toBeTruthy();
    expect(screen.getByRole('button', { name: '📧 Send emails to 1 participant' })).toBeTruthy();
  });

  it('shows whether the organizer link went out', () => {
    renderSection(drawWith([null]), '✓ Your organizer link was emailed to pat@example.com.');
    expect(screen.getByText('✓ Your organizer link was emailed to pat@example.com.')).toBeTruthy();
  });
});

describe('exchange details row', () => {
  it('starts folded, summing up the defaults in lowercase', () => {
    renderSection(drawWith(['a@example.com', 'b@example.com']));
    expect(toggle().getAttribute('aria-expanded')).toBe('false');
    expect(toggle().textContent).toContain('no $ limit · no date');
    expect(screen.getByRole('button', { name: 'No budget set', hidden: true }).getAttribute('aria-pressed')).toBe('true');
  });

  it('updates the summary and the message preview as the organizer types', () => {
    renderSection(drawWith(['a@example.com', 'b@example.com']));
    fireEvent.click(toggle());
    expect(screen.getByText(/You have drawn/).textContent).toBe('You have drawn P1’s name for the gift exchange!');
    expect(screen.queryByText('First, some details:')).toBeNull();

    fireEvent.change(screen.getByLabelText('Organizer Note'), { target: { value: 'Bring it wrapped' } });
    fireEvent.change(screen.getByLabelText('Budget in dollars'), { target: { value: '30' } });
    fireEvent.change(screen.getByLabelText('Date of the exchange'), { target: { value: '2026-12-19' } });

    expect(toggle().textContent).toContain('note added · $30 · dec 19');
    expect(screen.getByText('First, some details:')).toBeTruthy();
    expect(screen.getByText('“Bring it wrapped”')).toBeTruthy();
    expect(screen.getByText('Saturday, December 19')).toBeTruthy();
    expect(screen.getByText('And now the big reveal:')).toBeTruthy();
    expect(screen.getByText('This secret message was sent by Pat.')).toBeTruthy();
  });

  it('shows a $0 budget as "No limit set" in the preview', () => {
    renderSection(drawWith(['a@example.com', 'b@example.com']));
    fireEvent.click(toggle());
    fireEvent.change(screen.getByLabelText('Budget in dollars'), { target: { value: '0' } });
    expect(screen.getByText('No limit set')).toBeTruthy();
    expect(toggle().textContent).toContain('$0 · no date');
  });

  it('blocks sending while the note has a link', () => {
    renderSection(drawWith(['a@example.com', 'b@example.com']));
    fireEvent.click(toggle());
    fireEvent.change(screen.getByLabelText('Organizer Note'), { target: { value: 'Ideas at bit.ly/gifts' } });
    expect(screen.getByText('Links aren’t allowed in the note.')).toBeTruthy();
    expect((screen.getByRole('button', { name: /Send emails to 2 participants/ }) as HTMLButtonElement).disabled).toBe(true);
  });

  it('has no message preview when nobody has an email', () => {
    renderSection(drawWith([null, null]));
    fireEvent.click(toggle());
    expect(screen.getByLabelText('Organizer Note')).toBeTruthy();
    expect(screen.queryByText('Message preview')).toBeNull();
  });

  it('shows the details read-only once the emails are sent', () => {
    const draw = drawWith(['a@example.com']);
    draw.emails_sent_at = '2026-12-01T00:00:00.000Z';
    draw.participants[0].email_sent_at = '2026-12-01T00:00:00.000Z';
    draw.organizer_note = 'Bring it wrapped';
    draw.budget_cents = 0;
    draw.exchange_date = '2026-12-19';
    renderSection(draw);
    expect(screen.queryByRole('button', { name: /Add a note, budget, or date/ })).toBeNull();
    const sent = screen.getByLabelText('Details sent');
    expect(sent.textContent).toBe('NoteBring it wrappedBudgetNo limit setExchangeSaturday, December 19');
  });
});
