import { neon } from '@neondatabase/serverless';

/**
 * Neon serverless client. Each query is a single HTTPS request, so there is no
 * connection pool to keep warm or reset between serverless invocations.
 * Tagged-template interpolations are sent as bind parameters, never spliced
 * into the SQL text.
 */
export const sql = neon(process.env.DATABASE_URL!);

// Postgres rejects malformed uuid input with an error, so routes check the
// shape first and treat a bad id as "not found" / bad input instead of a 500
const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isUuid(value: string): boolean {
  return UUID_REGEX.test(value);
}
