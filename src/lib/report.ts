import * as Sentry from '@sentry/nextjs';

// How long to wait for Sentry to deliver before the function is frozen
const FLUSH_TIMEOUT_MS = 2000;

/**
 * Logs an unexpected error and sends it to Sentry. Routes await this in their
 * catch blocks: a serverless function can be frozen as soon as the response goes
 * out, so the report has to be delivered first. Does nothing extra when
 * SENTRY_DSN isn't set (local development, tests).
 */
export async function reportError(err: unknown): Promise<void> {
  console.error(err);
  if (!process.env.SENTRY_DSN) return;
  Sentry.captureException(err);
  await Sentry.flush(FLUSH_TIMEOUT_MS);
}

/** Sends a warning that isn't an exception, e.g. a send that ran close to its time limit */
export async function reportWarning(message: string): Promise<void> {
  console.warn(message);
  if (!process.env.SENTRY_DSN) return;
  Sentry.captureMessage(message, 'warning');
  await Sentry.flush(FLUSH_TIMEOUT_MS);
}
