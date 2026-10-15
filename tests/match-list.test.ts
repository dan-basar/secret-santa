import { describe, it, expect } from 'vitest';
import { detailLines, exportFileName, listSubtitle, matchesCsv, sortedPairs } from '@/lib/match-list';
import type { AdminParticipant } from '@/types/api';

function person(name: string, group: string | null = null, email: string | null = null): AdminParticipant {
  return { name, email, group_name: group, reveal_token: `tok-${name}`, email_sent_at: null };
}

// Each person gives to the next one
function ring(participants: AdminParticipant[]) {
  return participants.map((_, i) => ({ giver: i, receiver: (i + 1) % participants.length }));
}

function csvLines(participants: AdminParticipant[]) {
  return matchesCsv(participants, ring(participants)).trimEnd().split('\r\n');
}

describe('matchesCsv', () => {
  it('has all six columns when someone has a group and someone has an email', () => {
    const lines = csvLines([person('Alex', 'Smiths', 'alex@example.com'), person('Sam'), person('Riley', 'Lees')]);
    expect(lines).toEqual([
      'Secret Santa,Group,Email,Match Name,Match Group,Match Email',
      'Riley,Lees,No email,Alex,Smiths,alex@example.com',
      'Alex,Smiths,alex@example.com,Sam,,No email',
      'Sam,,No email,Riley,Lees,No email',
    ]);
  });

  it('leaves a blank for no group, so a group really called "No group" stays distinct', () => {
    const lines = csvLines([person('Alex', 'No group'), person('Sam')]);
    expect(lines).toEqual(['Secret Santa,Group,Match Name,Match Group', 'Alex,No group,Sam,', 'Sam,,Alex,No group']);
  });

  it('leaves out the group columns when nobody has a group', () => {
    const lines = csvLines([person('Alex', null, 'alex@example.com'), person('Sam')]);
    expect(lines).toEqual([
      'Secret Santa,Email,Match Name,Match Email',
      'Alex,alex@example.com,Sam,No email',
      'Sam,No email,Alex,alex@example.com',
    ]);
  });

  it('leaves out the email columns when nobody has an email', () => {
    expect(csvLines([person('Alex', 'Smiths'), person('Sam')])[0]).toBe('Secret Santa,Group,Match Name,Match Group');
  });

  it('is just names when nobody has a group or an email', () => {
    expect(csvLines([person('Alex'), person('Sam')])).toEqual(['Secret Santa,Match Name', 'Alex,Sam', 'Sam,Alex']);
  });

  it('quotes commas and quotes, and keeps a spreadsheet from reading a name as a formula', () => {
    const lines = csvLines([person('Smith, Jo'), person('Pat "PJ" Lee'), person('=1+1')]);
    expect(lines).toContain('"Smith, Jo","Pat ""PJ"" Lee"');
    expect(lines).toContain('\'=1+1,"Smith, Jo"');
  });

  it('ends every row with CRLF', () => {
    expect(matchesCsv([person('Alex'), person('Sam')], ring([person('Alex'), person('Sam')]))).toBe('Secret Santa,Match Name\r\nAlex,Sam\r\nSam,Alex\r\n');
  });
});

describe('sortedPairs', () => {
  it('lists grouped people first, by group, then by name, like the matches table', () => {
    const people = [person('Zed'), person('Bo', 'B'), person('Al'), person('Cy', 'A')];
    expect(sortedPairs(people, ring(people)).map((m) => m.giver.name)).toEqual(['Cy', 'Bo', 'Al', 'Zed']);
  });
});

describe('detailLines', () => {
  it('lists only the details that were filled in', () => {
    expect(detailLines({ organizer_note: null, budget_cents: null, exchange_date: null })).toEqual([]);
    expect(detailLines({ organizer_note: 'Wrap it', budget_cents: 2550, exchange_date: '2026-12-19' })).toEqual([
      { label: 'Note', value: 'Wrap it' },
      { label: 'Budget', value: '$25.50' },
      { label: 'Exchange', value: 'Saturday, December 19' },
    ]);
  });
});

describe('listSubtitle', () => {
  it('starts with the organizer when there is one', () => {
    expect(listSubtitle('Dan', '2026-10-15T12:00:00.000Z', 6)).toBe('Organized by Dan · Draw created October 15, 2026 · 6 participants');
    expect(listSubtitle('', '2026-10-15T12:00:00.000Z', 1)).toBe('Draw created October 15, 2026 · 1 participant');
  });
});

describe('exportFileName', () => {
  it('names the file after the day the draw was made', () => {
    expect(exportFileName('2026-10-15T02:00:00.000Z')).toBe('secret-santa-matches-2026-10-15');
  });
});
