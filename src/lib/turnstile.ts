// Cloudflare normally answers in well under a second; give up long before the
// send-emails function limit rather than hang on a network problem
const VERIFY_TIMEOUT_MS = 5000;

/**
 * Asks Cloudflare whether a Turnstile token is genuine. Never throws: a network
 * error, timeout or unreadable reply is logged and counts as not verified.
 */
export async function verifyTurnstile(token: string): Promise<boolean> {
  try {
    const response = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ secret: process.env.TURNSTILE_SECRET_KEY, response: token }),
      signal: AbortSignal.timeout(VERIFY_TIMEOUT_MS),
    });
    const result: { success?: unknown } = await response.json();
    return result.success === true;
  } catch (err) {
    console.error('Turnstile verification failed', err);
    return false;
  }
}
