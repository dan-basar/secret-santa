// The JSON each API route sends, shared by the routes and the pages that read it.
// Timestamps are ISO 8601 strings: the database driver returns them as Date
// objects, and the routes convert them when building the response.

// Every 4xx and 5xx with a body, including 429 from src/proxy.ts. The one
// exception is get-draw's 410, which is GetDrawDeleted
export interface ApiError {
  error: string;
}

// POST /api/create-draw
export interface CreateDrawResponse {
  drawId: string;
  adminKey: string;
}

// POST /api/delete-draw
export interface DeleteDrawResponse {
  success: true;
}

// GET /api/get-draw: the shared link sees names only; the organizer, with the
// admin key, sees everything. isAdmin tells the two apart
export interface SharedDraw {
  id: string;
  created_at: string;
  emails_sent_at: string | null;
  isAdmin: false;
  participants: { name: string }[];
}

export interface AdminParticipant {
  name: string;
  email: string | null;
  group_name: string | null;
  reveal_token: string;
  email_sent_at: string | null;
}

export interface AdminMatch {
  giver_name: string;
  giver_email: string | null;
  giver_group: string | null;
  receiver_name: string;
  receiver_group: string | null;
}

export interface AdminDraw {
  id: string;
  created_at: string;
  emails_sent_at: string | null;
  isAdmin: true;
  participantsWithEmailCount: number;
  participants: AdminParticipant[];
  matches: AdminMatch[];
}

export type GetDrawResponse = SharedDraw | AdminDraw;

// get-draw's 410 for a deleted draw
export interface GetDrawDeleted {
  deleted: true;
}

// GET /api/reveal
export interface RevealResponse {
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
}

// A resend where every email failed also lists who wasn't reached
export interface SendEmailsError extends ApiError {
  failedNames?: string[];
}

// GET /api/health
export interface HealthResponse {
  ok: boolean;
}
