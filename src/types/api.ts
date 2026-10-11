// The JSON each API route sends, shared by the routes and the pages that read it.
// Timestamps are ISO 8601 strings: the database driver returns them as Date
// objects, and the routes convert them when building the response.

// Every 4xx and 5xx, including 405 for a wrong method and 429 from src/proxy.ts
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

// Indexes into AdminDraw.participants, which holds each person's name, email
// and group, so they aren't repeated here
export interface AdminMatch {
  giver: number;
  receiver: number;
}

export interface AdminDraw {
  id: string;
  created_at: string;
  emails_sent_at: string | null;
  isAdmin: true;
  participants: AdminParticipant[];
  matches: AdminMatch[];
}

export type GetDrawResponse = SharedDraw | AdminDraw;

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
