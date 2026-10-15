import { hasHtmlTag, hasLink } from '@/lib/sanitize';
import type { ExchangeDetails } from '@/types/api';

// The organizer's optional note, budget and exchange date (F1). They are typed on
// the organizer page, go into each match email and show on each personal link page.
// Shared by the organizer page, send-emails, the email and the reveal page.

// Column sizes in sql/setup.sql
export const NOTE_MAX_LENGTH = 150;
export const BUDGET_MAX_CENTS = 1_000_000;

/**
 * Turns what was typed in the budget box into cents: null when it's empty, or
 * 'invalid' unless it is a dollar amount with at most 2 decimals ("30", "25.50",
 * "$1,000"). A budget of 0 is allowed: it shows as "No limit set".
 */
export function parseBudget(input: string): number | null | 'invalid' {
  const value = input.replace(/[$,\s]/g, '');
  if (!value) return null;
  if (!/^\d+(\.\d{1,2})?$/.test(value)) return 'invalid';
  const cents = Math.round(Number(value) * 100);
  return cents <= BUDGET_MAX_CENTS ? cents : 'invalid';
}

/** "$30", or "$25.50" when there are cents */
export function formatBudget(cents: number): string {
  const dollars = cents / 100;
  return '$' + (cents % 100 === 0
    ? dollars.toLocaleString('en-US')
    : dollars.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }));
}

/** The budget as the emails and personal link pages show it. $0 is a small Easter egg */
export function budgetLine(cents: number): string {
  return cents === 0 ? 'No limit set' : formatBudget(cents);
}

/** True for a real calendar day written YYYY-MM-DD, as a date input gives it */
export function isExchangeDate(input: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input)) return false;
  const date = new Date(`${input}T00:00:00Z`);
  return !isNaN(date.getTime()) && date.toISOString().startsWith(input);
}

// The date has no time zone: read and write it as UTC so no one sees the day before
function utcDate(isoDate: string): Date {
  return new Date(`${isoDate}T00:00:00Z`);
}

/** "Saturday, December 19" */
export function formatExchangeDate(isoDate: string): string {
  return utcDate(isoDate).toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', timeZone: 'UTC' });
}

/** "dec 19", for the summary beside the folded details row */
export function shortExchangeDate(isoDate: string): string {
  return utcDate(isoDate).toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' }).toLowerCase();
}

/** The note's problem, if any: the server refuses the same things */
export function noteError(note: string): string {
  if (note.length > NOTE_MAX_LENGTH) return `The note must be ${NOTE_MAX_LENGTH} characters or fewer.`;
  if (hasHtmlTag(note)) return 'The note can’t contain HTML.';
  // It is written into every email, where a mail app would make a web address clickable
  if (hasLink(note)) return 'Links aren’t allowed in the note.';
  return '';
}

export function hasDetails(details: ExchangeDetails): boolean {
  return !!details.organizer_note || details.budget_cents !== null || !!details.exchange_date;
}
