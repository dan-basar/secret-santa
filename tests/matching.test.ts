import { describe, it, expect } from 'vitest';
import { isMatchingPossible, createMatches, Participant } from '@/lib/matching';

function person(name: string, group = ''): Participant {
  return { name, email: '', group };
}

function people(count: number, group = '', prefix = group || 'P'): Participant[] {
  return Array.from({ length: count }, (_, i) => person(`${prefix} ${i + 1}`, group));
}

const groupKey = (p: Participant) => p.group.trim().toLowerCase();

// Every participant gives exactly once and receives exactly once, never to
// themselves and never to someone in their own group (case-insensitive).
function expectValid(participants: Participant[], matches: ReturnType<typeof createMatches>) {
  expect(matches).not.toBeNull();
  expect(matches!).toHaveLength(participants.length);
  expect(new Set(matches!.map(m => m.giver)).size).toBe(participants.length);
  expect(new Set(matches!.map(m => m.receiver)).size).toBe(participants.length);
  for (const { giver, receiver } of matches!) {
    expect(participants).toContain(giver);
    expect(participants).toContain(receiver);
    expect(receiver).not.toBe(giver);
    if (groupKey(giver)) expect(groupKey(receiver)).not.toBe(groupKey(giver));
  }
}

describe('isMatchingPossible', () => {
  it('requires at least 2 participants', () => {
    expect(isMatchingPossible([person('Alex')]).possible).toBe(false);
  });

  it('rejects a group holding more than half the participants', () => {
    const check = isMatchingPossible([...people(3, 'Family'), ...people(2)]);
    expect(check.possible).toBe(false);
  });

  it('accepts a group holding exactly half the participants', () => {
    expect(isMatchingPossible([...people(25, 'Family'), ...people(25)]).possible).toBe(true);
  });

  it('treats group names that differ only in case or spacing as one group', () => {
    const participants = [
      ...people(2, 'Family'),
      ...people(2, 'family', 'Lower'),
      ...people(2, ' FAMILY ', 'Upper'),
      ...people(5),
    ];
    const check = isMatchingPossible(participants);
    expect(check.possible).toBe(false);
    expect(check.reason).toMatch(/too many members \(6 out of 11\)/);
  });
});

describe('createMatches', () => {
  it('never self-matches or matches within a group across many runs', () => {
    const participants = [
      ...people(4, 'Smiths'),
      ...people(3, 'smiths', 'Smith cousin'),
      ...people(3, 'Joneses'),
      ...people(5),
    ];
    for (let run = 0; run < 500; run++) {
      expectValid(participants, createMatches(participants));
    }
  });

  it('matches a 50-person draw with one group of exactly 25 quickly', () => {
    // Ungrouped people first: a giver order that sends naive backtracking
    // down dead ends when early givers use up the out-of-group receivers.
    const participants = [...people(25), ...people(25, 'Family')];
    const started = Date.now();
    for (let run = 0; run < 20; run++) {
      expectValid(participants, createMatches(participants));
    }
    expect(Date.now() - started).toBeLessThan(2000);
  });

  it('matches two people who share a name', () => {
    const participants = [person('Sam'), person('Sam')];
    const matches = createMatches(participants);
    expectValid(participants, matches);
    expect(matches![0].receiver).toBe(participants[1]);
    expect(matches![1].receiver).toBe(participants[0]);
  });

  it('matches same-named people in a larger draw', () => {
    const participants = [person('Sam', 'A'), person('Sam', 'B'), person('Sam'), person('Alex', 'A')];
    for (let run = 0; run < 200; run++) {
      expectValid(participants, createMatches(participants));
    }
  });
});
