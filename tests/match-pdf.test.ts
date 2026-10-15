import { readFileSync } from 'node:fs';
import { describe, it, expect } from 'vitest';
import { buildMatchesPdf, pdfText } from '@/lib/match-pdf';
import type { GetDrawResponse } from '@/types/api';

const draw: GetDrawResponse = {
  id: 'f59fac1f-4e1f-45c8-96f6-9c6c738c3876', created_at: '2026-10-15T12:00:00.000Z', emails_sent_at: null,
  participants: [
    { name: 'Alex', email: 'alex@example.com', group_name: 'Smiths', reveal_token: 'Aa111111', email_sent_at: null },
    { name: 'Smith, José', email: 'jose@example.com', group_name: null, reveal_token: 'Bb222222', email_sent_at: null },
    { name: 'Sam', email: null, group_name: 'Smiths', reveal_token: 'Cc333333', email_sent_at: null },
  ],
  matches: [{ giver: 0, receiver: 1 }, { giver: 1, receiver: 2 }, { giver: 2, receiver: 0 }],
  organizer_name: null, organizer_note: null, budget_cents: null, exchange_date: null,
};

describe('pdfText', () => {
  it('keeps accents and curly quotes, drops emoji and marks other scripts with ?', () => {
    expect(pdfText('José “PJ” O’Neil 🎄')).toBe('José “PJ” O’Neil');
    expect(pdfText('Zoë 李')).toBe('Zoë ?');
  });
});

describe('buildMatchesPdf', () => {
  it('makes a one-page PDF with the details box, the table and both people\'s emails', async () => {
    const doc = await buildMatchesPdf(draw, { organizer_note: 'Wrap it nicely', budget_cents: 3000, exchange_date: '2026-12-19' }, 'Dan', null);
    expect(doc.getNumberOfPages()).toBe(1);
    const pdf = doc.output();
    expect(pdf.startsWith('%PDF-')).toBe(true);
    for (const text of ['Secret Santa matches', 'Wrap it nicely', 'Saturday, December 19', 'GIFTING TO', 'Smiths', 'No group', 'alex@example.com', 'jose@example.com', 'Smith, José', 'Keep this list private! It shows everyone', 'Organized by Dan  ·  Draw created October 15, 2026  ·  3 participants']) {
      expect(pdf).toContain(text);
    }
  });

  it('runs onto more pages for a big draw, numbering them', async () => {
    const participants = Array.from({ length: 50 }, (_, i) => ({
      name: `Person ${i + 1}`, email: `person${i + 1}@example.com`, group_name: null, reveal_token: `Tok${i}`, email_sent_at: null,
    }));
    const doc = await buildMatchesPdf(
      { ...draw, participants, matches: participants.map((_, i) => ({ giver: i, receiver: (i + 1) % 50 })) },
      { organizer_note: null, budget_cents: null, exchange_date: null },
      '',
      null,
    );
    expect(doc.output()).toContain('Draw created October 15, 2026  ·  50 participants');
    expect(doc.output()).not.toContain('Organized by');
    expect(doc.getNumberOfPages()).toBeGreaterThan(1);
    expect(doc.output()).toContain(`Page 1 of ${doc.getNumberOfPages()}`);
  });
});

describe('the PDF font', () => {
  // The files the page fetches from /fonts
  const fonts = {
    regular: new Uint8Array(readFileSync('public/fonts/noto-sans-pdf-regular.ttf')).buffer,
    bold: new Uint8Array(readFileSync('public/fonts/noto-sans-pdf-bold.ttf')).buffer,
  };

  it('keeps Croatian, Cyrillic and Greek letters with Noto Sans, and still marks Chinese with ?', () => {
    expect(pdfText('Ivana Čačić-Đurđević', 'noto')).toBe('Ivana Čačić-Đurđević');
    expect(pdfText('Иван Петров', 'noto')).toBe('Иван Петров');
    expect(pdfText('Ελένη', 'noto')).toBe('Ελένη');
    expect(pdfText('李雷 🎄', 'noto')).toBe('??');
    // Without it, Helvetica has only some of them
    expect(pdfText('Čačić Šimić', 'helvetica')).toBe('?a?i? Šimi?');
  });

  it('embeds Noto Sans when the font files load', async () => {
    const people = ['Ivana Čačić', 'Иван Петров', 'Ελένη'].map((name, i) => ({
      name, email: null, group_name: null, reveal_token: `Tok${i}`, email_sent_at: null,
    }));
    const doc = await buildMatchesPdf(
      { ...draw, participants: people, matches: people.map((_, i) => ({ giver: i, receiver: (i + 1) % 3 })) },
      { organizer_note: 'Встреча в 18:00', budget_cents: null, exchange_date: null },
      'Đuro',
      fonts,
    );
    const pdf = doc.output();
    expect(pdf).toContain('/BaseFont /NotoSans');
    expect(pdf).toContain('/Identity-H');
  });
});
