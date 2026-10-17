import * as Sentry from '@sentry/nextjs';

// Error reporting only: no tracing, no replay, no breadcrumbs. Draw links and
// reveal tokens travel in URLs and query strings, so the request and user are
// dropped from every event, leaving just the error and its stack trace.
Sentry.init({
  dsn: process.env.SENTRY_DSN,
  tracesSampleRate: 0,
  maxBreadcrumbs: 0,
  beforeSend(event) {
    delete event.request;
    delete event.user;
    return event;
  },
});
