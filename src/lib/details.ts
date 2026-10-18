import { hasHtmlTag, hasLink } from '@/lib/sanitize';
import type { ExchangeDetails } from '@/types/api';

// The organizer's optional note, budget and exchange date (F1). They are typed on
// the organizer page, go into each match email and show on each personal link page.
// Shared by the organizer page, send-emails, save-details, the emails, the printed
// and PDF match lists and the reveal page.

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

/**
 * The budget and exchange date as label and value lines, each only when set. The
 * emails, their preview and the personal link page show the note on its own above them
 */
export function budgetAndDateLines(budgetCents: number | null, exchangeDate: string | null): { label: string; value: string }[] {
  return [
    ...(budgetCents !== null ? [{ label: 'Budget', value: budgetLine(budgetCents) }] : []),
    ...(exchangeDate ? [{ label: 'Exchange', value: formatExchangeDate(exchangeDate) }] : []),
  ];
}

/** All three details as label and value lines, in the order the emails use: for the printed and PDF lists and the sent details card */
export function detailLines(details: ExchangeDetails): { label: string; value: string }[] {
  return [
    ...(details.organizer_note ? [{ label: 'Note', value: details.organizer_note }] : []),
    ...budgetAndDateLines(details.budget_cents, details.exchange_date),
  ];
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

/**
 * Checks the details as a request body sends them (organizerNote, budget in dollars
 * as typed, exchangeDate YYYY-MM-DD; each optional, empty meaning not set). Returns
 * the details to save, or the 400 message. Shared by send-emails and save-details.
 */
export function readDetails(body: { organizerNote?: unknown; budget?: unknown; exchangeDate?: unknown }): ExchangeDetails | string {
  const { organizerNote, budget, exchangeDate } = body;
  if (organizerNote != null && typeof organizerNote !== 'string') return 'The note must be text.';
  if (budget != null && typeof budget !== 'string') return 'The budget must be text.';
  if (exchangeDate != null && typeof exchangeDate !== 'string') return 'The exchange date must be text.';

  const note = (organizerNote ?? '').trim();
  const badNote = noteError(note);
  if (badNote) return badNote;
  const budgetCents = parseBudget(budget ?? '');
  if (budgetCents === 'invalid') return 'The budget must be a dollar amount of $10,000 or less.';
  const date = (exchangeDate ?? '').trim();
  if (date && !isExchangeDate(date)) return 'The exchange date is not a valid date.';

  return { organizer_note: note || null, budget_cents: budgetCents, exchange_date: date || null };
}

/** The details as typed on the organizer page, leaving out any value the server would refuse */
export function typedDetails(note: string, budget: string, exchangeDate: string): ExchangeDetails {
  const trimmed = note.trim();
  const cents = parseBudget(budget);
  return {
    organizer_note: trimmed && !noteError(trimmed) ? trimmed : null,
    budget_cents: typeof cents === 'number' ? cents : null,
    exchange_date: isExchangeDate(exchangeDate) ? exchangeDate : null,
  };
}

export function sameDetails(a: ExchangeDetails, b: ExchangeDetails): boolean {
  return a.organizer_note === b.organizer_note && a.budget_cents === b.budget_cents && a.exchange_date === b.exchange_date;
}
