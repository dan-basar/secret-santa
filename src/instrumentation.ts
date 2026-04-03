/**
 * Next.js server instrumentation hook — runs once per server startup, not per request.
 * Used to warm the DB connection pool so the first real request doesn't pay the
 * full cold-start cost of establishing a new Azure SQL connection.
 *
 * See: https://nextjs.org/docs/app/building-your-application/optimizing/instrumentation
 */
export async function register() {
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    const { getPool } = await import('@/lib/db');
    // Fire-and-forget: pool warm-up failure is non-fatal. The retry logic in
    // withRetry() will handle connectivity issues at request time.
    getPool().catch(() => {});
  }
}
