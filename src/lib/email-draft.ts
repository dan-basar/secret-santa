// The draw page's email card as it is typed before the first send, kept in
// sessionStorage so a refresh keeps it. Each draft belongs to one draw, named by
// its admin key, so an unrelated draw opened in the same tab starts empty; Edit &
// Redraw hands it on to the replacement draw (moveEmailDraft), as the exchange is the same

export const EMAIL_DRAFT_KEY = 'drawEmailDraft';

export interface EmailDraft {
  drawKey: string;
  organizerName: string;
  organizerEmail: string;
  organizerNote: string;
  budget: string;
  exchangeDate: string;
}

/** The saved draft for the draw with this admin key, or null for none, another draw's or a malformed one. */
export function readEmailDraft(drawKey: string): EmailDraft | null {
  try {
    const d = JSON.parse(sessionStorage.getItem(EMAIL_DRAFT_KEY) ?? '');
    const fields = [d?.drawKey, d?.organizerName, d?.organizerEmail, d?.organizerNote, d?.budget, d?.exchangeDate];
    if (!fields.every((f) => typeof f === 'string')) return null;
    return d.drawKey === drawKey ? d : null;
  } catch {
    // Nothing saved, something this app didn't write, or storage blocked
    return null;
  }
}

/** Hands the replaced draw's draft on to its replacement after an Edit & Redraw. */
export function moveEmailDraft(fromKey: string, toKey: string) {
  const draft = readEmailDraft(fromKey);
  if (!draft) return;
  try {
    sessionStorage.setItem(EMAIL_DRAFT_KEY, JSON.stringify({ ...draft, drawKey: toKey }));
  } catch {
    // Storage blocked or full; the new draw's card just starts empty
  }
}
