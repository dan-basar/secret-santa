// Gmail's free SMTP plan allows ~500 emails in a rolling 24 hours; 495 gives a
// 5-email safety margin. Used by send-emails (the cap) and ops-check (the warning)
export const DAILY_EMAIL_LIMIT = 495;

// Each IP's share of the cap, so one person can't use up everyone's emails:
// at most this many in any 24 hours, counted the same way as the cap
export const IP_EMAIL_BUDGET = 100;
