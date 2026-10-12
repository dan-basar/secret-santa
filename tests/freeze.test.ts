import { describe, it, expect } from 'vitest';
import { currentFreeze, freezeStart, freezeEnd } from '../scripts/freeze';

describe('freezeStart', () => {
  it('is 08:00 UTC (3am Eastern) on the Tuesday before Thanksgiving', () => {
    expect(freezeStart(2026).toISOString()).toBe('2026-11-24T08:00:00.000Z'); // Thanksgiving 26 Nov
    expect(freezeStart(2027).toISOString()).toBe('2027-11-23T08:00:00.000Z'); // 25 Nov
    expect(freezeStart(2028).toISOString()).toBe('2028-11-21T08:00:00.000Z'); // 23 Nov
    expect(freezeStart(2029).toISOString()).toBe('2029-11-20T08:00:00.000Z'); // 22 Nov, earliest possible
    expect(freezeStart(2030).toISOString()).toBe('2030-11-26T08:00:00.000Z'); // 28 Nov, latest possible
  });

  it('always lands on a Tuesday between 20 and 26 November', () => {
    for (let year = 2025; year < 2060; year++) {
      const start = freezeStart(year);
      expect(start.getUTCDay()).toBe(2);
      expect(start.getUTCMonth()).toBe(10);
      expect(start.getUTCDate()).toBeGreaterThanOrEqual(20);
      expect(start.getUTCDate()).toBeLessThanOrEqual(26);
    }
  });
});

describe('currentFreeze', () => {
  const at = (iso: string) => currentFreeze(new Date(iso));

  it('is off before the start and on from 3am Eastern', () => {
    expect(at('2026-11-24T07:59:59Z')).toBeNull();
    expect(at('2026-11-24T08:00:00Z')).toEqual({ start: freezeStart(2026), end: freezeEnd(2027) });
  });

  it('stays on across New Year and ends at 3am Eastern on 2 January', () => {
    expect(at('2026-12-31T23:59:59Z')?.end.toISOString()).toBe('2027-01-02T08:00:00.000Z');
    expect(at('2027-01-01T12:00:00Z')).toEqual({ start: freezeStart(2026), end: freezeEnd(2027) });
    expect(at('2027-01-02T07:59:59Z')).not.toBeNull();
    expect(at('2027-01-02T08:00:00Z')).toBeNull();
  });

  it('is off the rest of the year', () => {
    expect(at('2026-10-12T12:00:00Z')).toBeNull();
    expect(at('2027-06-01T00:00:00Z')).toBeNull();
  });
});
