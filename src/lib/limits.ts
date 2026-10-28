// Gmail's free SMTP plan allows ~500 emails in a rolling 24 hours; 495 gives a
// 5-email safety margin. Used by send-emails (the cap) and ops-check (the warning)
export const DAILY_EMAIL_LIMIT = 495;

// Each IP's share of the cap, so one person can't use up everyone's emails:
// at most this many in any 24 hours, counted the same way as the cap
export const IP_EMAIL_BUDGET = 100;

// Emails one address can get from the site in any 24 hours, across all draws, so
// a draw can't fill one inbox (names must differ, addresses may repeat). 9 still
// covers a family sharing one address. Addresses in ADDRESS_LIMIT_EXEMPT have none
export const ADDRESS_EMAIL_LIMIT = 9;

// A participant's send claim normally lasts only as long as their own send. One
// older than this belongs to a request that was killed mid-send (send-emails has
// 120s), so that person can be claimed again. Used by send-emails and ops-check
export const CLAIM_EXPIRY_MINUTES = 5;
