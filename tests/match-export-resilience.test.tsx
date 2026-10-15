// @vitest-environment jsdom
// Odd but allowed names, groups and emails through every export: the CSV, the PDF
// and the print sheet. create-draw refuses HTML and web addresses and Postgres
// refuses NUL; anything else typed (or sent straight to the API) can reach these.
import { describe, it, expect, afterEach } from 'vitest';
import { render, cleanup } from '@testing-library/react';
import { matchesCsv } from '@/lib/match-list';
import { buildMatchesPdf, pdfText } from '@/lib/match-pdf';
import PrintSheet from '@/components/draw/PrintSheet';
import type { AdminParticipant, GetDrawResponse } from '@/types/api';

afterEach(cleanup);

const NAMES = [
  '🎅', '👨‍👩‍👧 Family', 'Ñandú 👍🏽', '🇺🇸 Flag',
  'Al\tex', 'Line\nBreak', 'Car\rriage', 'Win\r\ndows',
  '"Quoted"', 'Smith, Jo', 'It\'s', 'back\\slash;semi',
  '=SUM(A1)', '+1 Bob', '-Dash', '@at', '\t=tab',
  'Zoë', 'éclair', '李雷', 'محمد', 'Ελένη',
  '‮abc', 'zero​width', 'bell\u0007', 'nb sp',
  'X'.repeat(200), '<3 & co',
];

const participants: AdminParticipant[] = NAMES.map((name, i) => ({
  name,
  // Addresses only need an @ and a dot, so these pass isValidEmail()
  email: i % 3 === 0 ? `=x,y"${i}@ex.com` : null,
  group_name: i % 4 === 0 ? NAMES[(i + 5) % NAMES.length] : null,
  reveal_token: `Tok${i}`,
  email_sent_at: null,
}));
const matches = participants.map((_, i) => ({ giver: i, receiver: (i + 1) % participants.length }));

const draw: GetDrawResponse = {
  id: 'f59fac1f-4e1f-45c8-96f6-9c6c738c3876', created_at: '2026-10-15T12:00:00.000Z', emails_sent_at: null,
  organizer_name: '🎅 Dan, "the" organizer', participants, matches,
  organizer_note: null, budget_cents: null, exchange_date: null,
};

// RFC 4180, as spreadsheet apps read it: quoted fields may hold commas, quotes and line breaks
function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"' && text[i + 1] === '"') { field += '"'; i++; }
      else if (ch === '"') quoted = false;
      else field += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ',') { row.push(field); field = ''; }
    else if (ch === '\r' && text[i + 1] === '\n') { row.push(field); rows.push(row); row = []; field = ''; i++; }
    else field += ch;
  }
  return rows;
}

describe('CSV with odd names', () => {
  it('reads back as one row per Secret Santa, every value in its own cell and unchanged', () => {
    const rows = parseCsv(matchesCsv(participants, matches));
    expect(rows).toHaveLength(participants.length + 1);
    for (const row of rows) expect(row).toHaveLength(6);

    // Values a spreadsheet would run as a formula carry a leading apostrophe; everything else is exact
    const asWritten = (value: string) => (/^[=+\-@\t\r]/.test(value) ? `'${value}` : value);
    const giverNames = rows.slice(1).map((r) => r[0]);
    expect(new Set(giverNames)).toEqual(new Set(NAMES.map(asWritten)));
    for (const row of rows.slice(1)) {
      const giver = participants.find((p) => asWritten(p.name) === row[0])!;
      expect(row[1]).toBe(asWritten(giver.group_name ?? 'No group'));
      expect(row[2]).toBe(asWritten(giver.email ?? 'No email'));
    }
  });
});

describe('pdfText', () => {
  it('keeps what the PDF font can show and cleans up the rest', () => {
    expect(pdfText('Line\nBreak\tand\r\nmore')).toBe('Line Break and more');
    expect(pdfText('éclair')).toBe('éclair');
    expect(pdfText('zero​width ‮abc bell\u0007')).toBe('zerowidth abc bell');
    expect(pdfText('👨‍👩‍👧 Family 🇺🇸 👍🏽')).toBe('Family');
    expect(pdfText('🎅')).toBe('?');
    expect(pdfText('Ελένη')).toBe('?????');
    expect(pdfText('Pat “PJ” O’Neil, €5')).toBe('Pat “PJ” O’Neil, €5');
  });
});

describe('PDF with odd names', () => {
  it('builds, keeps every row and only uses characters its font has', async () => {
    const doc = await buildMatchesPdf(draw, { organizer_note: 'Line one\nline two 🎄', budget_cents: 0, exchange_date: null }, draw.organizer_name!);
    const pdf = doc.output();
    expect(pdf).toContain('Smith, Jo');
    expect(pdf).toContain('Organized by Dan, "the" organizer');
    expect(doc.getNumberOfPages()).toBeGreaterThanOrEqual(2);
    // Every text string jsPDF wrote is single-byte (WinAnsi), so nothing prints as garbage
    for (const name of NAMES) expect([...pdfText(name)].every((ch) => ch.charCodeAt(0) <= 0xff || '€‚ƒ„…†‡ˆ‰Š‹ŒŽ‘’“”•–—˜™š›œžŸ'.includes(ch))).toBe(true);
  });
});

describe('print sheet with odd names', () => {
  it('shows every name as plain text', () => {
    const { container } = render(<PrintSheet draw={draw} details={{ organizer_note: null, budget_cents: null, exchange_date: null }} organizerName="Dan" />);
    expect(container.querySelectorAll('tbody tr')).toHaveLength(participants.length);
    expect(container.innerHTML).toContain('&lt;3 &amp; co');
    expect(container.textContent).toContain('李雷');
    expect(container.textContent).toContain('👨‍👩‍👧 Family');
  });
});
