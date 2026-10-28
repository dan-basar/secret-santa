// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest';
import { useState } from 'react';
import { render, screen, cleanup, fireEvent } from '@testing-library/react';
import type { GetDrawResponse } from '@/types/api';

// Stands in for the Cloudflare widget, so a test can see whether it was rendered
vi.mock('@/components/draw/TurnstileWidget', () => ({ default: () => <div data-testid="turnstile" /> }));

import EmailSection from '@/components/draw/EmailSection';
import DetailsCard from '@/components/draw/DetailsCard';
import { sameDetails, typedDetails } from '@/lib/details';

function drawWith(emails: Array<string | null>): GetDrawResponse {
  return {
    created_at: '2026-12-01T00:00:00.000Z',
    emails_sent_at: null,
    participants: emails.map((email, i) => ({ name: `P${i}`, email, group_name: null, reveal_code: `token-${i}`, email_sent_at: null, revealed_at: null })),
    matches: emails.map((_, i) => ({ giver: i, receiver: (i + 1) % emails.length })),
    organizer_name: null,
    organizer_note: null,
    budget_cents: null,
    exchange_date: null,
  };
}

// Holds the details as the draw page does, so typing updates the details card above
// and the message preview in the email card
function Section({ draw, organizerLinkNotice, onSave = () => {} }: { draw: GetDrawResponse; organizerLinkNotice: string; onSave?: () => void }) {
  const [note, setNote] = useState('');
  const [budget, setBudget] = useState('');
  const [date, setDate] = useState('');
  const saved = { organizer_note: draw.organizer_note, budget_cents: draw.budget_cents, exchange_date: draw.exchange_date };
  return (
    <>
      <DetailsCard
        saved={saved}
        emailsSent={!!draw.emails_sent_at}
        note={note}
        budget={budget}
        exchangeDate={date}
        onNoteChange={setNote}
        onBudgetChange={setBudget}
        onExchangeDateChange={setDate}
        unsaved={!sameDetails(typedDetails(note, budget, date), saved)}
        valid
        saving={false}
        disabled={false}
        error=""
        onSave={onSave}
      />
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
        loading={false}
        error=""
        organizerLinkNotice={organizerLinkNotice}
        turnstileKey={0}
        onTurnstileToken={() => {}}
        hasTurnstileToken
        onSend={() => {}}
      />
    </>
  );
}

function renderSection(draw: GetDrawResponse, organizerLinkNotice = '', onSave?: () => void) {
  render(<Section draw={draw} organizerLinkNotice={organizerLinkNotice} onSave={onSave} />);
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

describe('details card and message preview', () => {
  it('starts folded, summing up the defaults in lowercase', () => {
    renderSection(drawWith(['a@example.com', 'b@example.com']));
    expect(toggle().getAttribute('aria-expanded')).toBe('false');
    expect(toggle().textContent).toContain('no $ limit · no date');
    expect(screen.getByRole('button', { name: 'No budget set', hidden: true }).getAttribute('aria-pressed')).toBe('true');
  });

  it('shows the message preview in the email card without opening the details', () => {
    renderSection(drawWith(['a@example.com', 'b@example.com']));
    const preview = screen.getByText(/^Message preview/);
    expect(preview.closest('section')!.textContent).toContain('Email notifications');
  });

  it('updates the summary and the message preview as the organizer types', () => {
    renderSection(drawWith(['a@example.com', 'b@example.com']));
    fireEvent.click(toggle());
    // Sample names, never a real person and their match, so the preview gives nothing away
    expect(screen.getByText(/You have drawn/).textContent).toBe('You have drawn Sam’s name for the gift exchange!');
    expect(screen.getByText('Hi Alex,')).toBeTruthy();
    expect(screen.queryByText(/P0|P1/)).toBeNull();
    expect(screen.queryByText('First, some details:')).toBeNull();

    fireEvent.change(screen.getByLabelText('Organizer note'), { target: { value: 'Bring it wrapped' } });
    fireEvent.change(screen.getByLabelText('Budget in dollars'), { target: { value: '30' } });
    fireEvent.change(screen.getByLabelText('Date of the exchange'), { target: { value: '2026-12-19' } });

    expect(toggle().textContent).toContain('note added · $30 · dec 19 · not saved');
    expect(screen.getByText('First, some details:')).toBeTruthy();
    expect(screen.getByText('“Bring it wrapped”')).toBeTruthy();
    expect(screen.getByText('Saturday, December 19')).toBeTruthy();
    expect(screen.getByText('And now the big reveal:')).toBeTruthy();
    expect(screen.getByText('This secret message was sent by Pat.')).toBeTruthy();
  });

  it('lets a long note with no spaces break inside the preview box', () => {
    renderSection(drawWith(['a@example.com', 'b@example.com']));
    fireEvent.click(toggle());
    const note = 'A' + 'a'.repeat(149);
    fireEvent.change(screen.getByLabelText('Organizer note'), { target: { value: note } });
    expect(screen.getByText(`“${note}”`).className).toContain('break-anywhere');
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
    fireEvent.change(screen.getByLabelText('Organizer note'), { target: { value: 'Ideas at bit.ly/gifts' } });
    expect(screen.getByText('Links aren’t allowed in the note.')).toBeTruthy();
    expect((screen.getByRole('button', { name: /Send emails to 2 participants/ }) as HTMLButtonElement).disabled).toBe(true);
  });

  it('has no message preview when nobody has an email', () => {
    renderSection(drawWith([null, null]));
    fireEvent.click(toggle());
    expect(screen.getByLabelText('Organizer note')).toBeTruthy();
    expect(screen.queryByText(/^Message preview/)).toBeNull();
  });

  it('saves only when something changed, and says whether it is saved', () => {
    const onSave = vi.fn();
    renderSection(drawWith(['a@example.com', 'b@example.com']), '', onSave);
    fireEvent.click(toggle());
    const save = screen.getByRole('button', { name: 'Save details' }) as HTMLButtonElement;
    expect(save.disabled).toBe(true);
    expect(screen.queryByText('✓ Saved')).toBeNull();
    fireEvent.change(screen.getByLabelText('Budget in dollars'), { target: { value: '30' } });
    expect(screen.getByText('Not saved yet')).toBeTruthy();
    fireEvent.click(save);
    expect(onSave).toHaveBeenCalledTimes(1);
  });

  it('shows saved details as saved, and as not saved once changed', () => {
    const draw = drawWith(['a@example.com', 'b@example.com']);
    draw.budget_cents = 3000;
    // The test harness starts with empty fields, so they differ from the saved budget
    renderSection(draw);
    expect(toggle().textContent).toContain('no $ limit · no date · not saved');
    fireEvent.click(toggle());
    fireEvent.change(screen.getByLabelText('Budget in dollars'), { target: { value: '30.00' } });
    expect(screen.getByText('✓ Saved')).toBeTruthy();
    expect(toggle().textContent).toContain('$30 · no date');
    expect(toggle().textContent).not.toContain('not saved');
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
