import * as Sentry from '@sentry/nextjs';

// Runs once when a server instance starts. Sentry only starts when SENTRY_DSN
// is set, and only in the Node.js runtime (the routes); the proxy has its own
// fail-open handling.
export async function register() {
  if (process.env.NEXT_RUNTIME === 'nodejs' && process.env.SENTRY_DSN) {
    await import('./sentry.server.config');
  }
}

// Errors a route doesn't catch itself
export const onRequestError = Sentry.captureRequestError;
