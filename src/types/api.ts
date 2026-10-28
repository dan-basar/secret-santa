// The JSON each API route sends, shared by the routes and the pages that read it.
// Timestamps are ISO 8601 strings: the database driver returns them as Date
// objects, and the routes convert them when building the response.

// Every 4xx and 5xx, including 405 for a wrong method and 429 from src/proxy.ts
export interface ApiError {
  error: string;
}

// POST /api/create-draw
// adminKey is the secret in the organizer's /draw#<adminKey> link
export interface CreateDrawResponse {
  adminKey: string;
}

// POST /api/delete-draw
export interface DeleteDrawResponse {
  success: true;
}

export interface AdminParticipant {
  name: string;
  email: string | null;
  group_name: string | null;
  reveal_code: string;
  email_sent_at: string | null;
}

// Indexes into GetDrawResponse.participants, which holds each person's name, email
// and group, so they aren't repeated here
export interface AdminMatch {
  giver: number;
  receiver: number;
}

// The organizer's optional note, budget and exchange date (src/lib/details.ts)
export interface ExchangeDetails {
  organizer_note: string | null;
  budget_cents: number | null; // 0 shows as "No limit set"
  exchange_date: string | null; // YYYY-MM-DD
}

// GET /api/get-draw: the organizer's view of a draw
export interface GetDrawResponse extends ExchangeDetails {
  created_at: string;
  emails_sent_at: string | null;
  organizer_name: string | null; // set by the first send
  participants: AdminParticipant[];
  matches: AdminMatch[];
}

// GET /api/reveal
export interface RevealResponse extends ExchangeDetails {
  name: string;
  match_name: string;
  created_at: string;
  organizer_name: string | null; // null until the emails have been sent
}

// POST /api/send-emails
export interface SendEmailsResponse {
  success: true;
  totalSent: number;
  totalFailed: number;
  failedNames: string[];
  // Whether the organizer was emailed their organizer link (first send only)
  organizerLinkSent: boolean;
}

// A resend where every email failed also lists who wasn't reached
export interface SendEmailsError extends ApiError {
  failedNames?: string[];
}

// POST /api/save-details: the details as saved
export type SaveDetailsResponse = ExchangeDetails;

// GET /api/health
export type HealthResponse = { ok: true };

// GET /api/ops-check: the daily check job's result (the weekly report returns { ok: true, reported: true })
export type OpsCheckResponse =
  | { ok: true; statDate: string; warnings: string[] }
  | { ok: true; reported: true };
