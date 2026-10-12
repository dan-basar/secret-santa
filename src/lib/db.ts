import { neon } from '@neondatabase/serverless';

/**
 * Neon serverless client. Each query is a single HTTPS request, so there is no
 * connection pool to keep warm or reset between serverless invocations.
 * Tagged-template interpolations are sent as bind parameters, never spliced
 * into the SQL text.
 */
export const sql = neon(process.env.DATABASE_URL!);

// Re-exported so routes get the client and the id check from one import
export { isUuid } from '@/lib/uuid';
