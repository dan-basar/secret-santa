import { describe, expect, it } from 'vitest';
import {
  budgetLine, formatBudget, formatExchangeDate, hasDetails, isExchangeDate, noteError, parseBudget, shortExchangeDate,
} from '@/lib/details';

describe('parseBudget', () => {
  it('reads dollar amounts as cents, with or without "$", commas and cents', () => {
    expect(parseBudget('30')).toBe(3000);
    expect(parseBudget('$25.50')).toBe(2550);
    expect(parseBudget(' 1,000 ')).toBe(100000);
    expect(parseBudget('19.9')).toBe(1990);
    expect(parseBudget('0')).toBe(0);
    expect(parseBudget('10000')).toBe(1000000);
  });

  it('reads an empty box as no budget', () => {
    expect(parseBudget('')).toBeNull();
    expect(parseBudget(' $ ')).toBeNull();
  });

  it('refuses anything else, and more than $10,000', () => {
    for (const input of ['abc', '12.345', '-5', '1e3', '.5', '10000.01']) {
      expect(parseBudget(input)).toBe('invalid');
    }
  });
});

describe('budget display', () => {
  it('shows cents only when there are some', () => {
    expect(formatBudget(3000)).toBe('$30');
    expect(formatBudget(2550)).toBe('$25.50');
    expect(formatBudget(100000)).toBe('$1,000');
  });

  it('shows a $0 budget as "No limit set"', () => {
    expect(budgetLine(0)).toBe('No limit set');
    expect(budgetLine(3000)).toBe('$30');
  });
});

describe('exchange dates', () => {
  it('accepts only real days written YYYY-MM-DD', () => {
    expect(isExchangeDate('2026-12-19')).toBe(true);
    expect(isExchangeDate('2028-02-29')).toBe(true);
    expect(isExchangeDate('2026-02-29')).toBe(false);
    expect(isExchangeDate('2026-13-01')).toBe(false);
    expect(isExchangeDate('12/19/2026')).toBe(false);
  });

  it('formats the day without shifting it for the time zone', () => {
    expect(formatExchangeDate('2026-12-19')).toBe('Saturday, December 19');
    expect(shortExchangeDate('2026-12-19')).toBe('dec 19');
    expect(shortExchangeDate('2027-01-01')).toBe('jan 1');
  });
});

describe('noteError', () => {
  it('passes plain notes, and refuses links, HTML and more than 150 characters', () => {
    expect(noteError("Bring your gift wrapped to Grandma's. We open them after dinner!")).toBe('');
    expect(noteError('Ideas at www.example.com')).toBe('Links aren’t allowed in the note.');
    expect(noteError('<i>hi</i>')).toBe('The note can’t contain HTML.');
    expect(noteError('n'.repeat(150))).toBe('');
    expect(noteError('n'.repeat(151))).toBe('The note must be 150 characters or fewer.');
  });
});

describe('hasDetails', () => {
  it('counts a $0 budget as a detail', () => {
    expect(hasDetails({ organizer_note: null, budget_cents: null, exchange_date: null })).toBe(false);
    expect(hasDetails({ organizer_note: null, budget_cents: 0, exchange_date: null })).toBe(true);
    expect(hasDetails({ organizer_note: 'Hi', budget_cents: null, exchange_date: null })).toBe(true);
  });
});
