import sql from 'mssql';

const config: sql.config = {
  server: process.env.AZURE_SQL_SERVER!,
  database: process.env.AZURE_SQL_DATABASE!,
  user: process.env.AZURE_SQL_USER!,
  password: process.env.AZURE_SQL_PASSWORD!,
  options: {
    encrypt: true,
    trustServerCertificate: false,
  },
  // Kept under Vercel's 10s function timeout to leave headroom for the rest of the request
  connectionTimeout: 8000,
  requestTimeout: 8000,
};

// Singleton pool — reused across requests within the same serverless instance
let pool: sql.ConnectionPool | null = null;

/**
 * Returns the shared connection pool, creating it if necessary.
 * If the pool exists but has lost its connection (e.g. Azure SQL closed an
 * idle connection), it is reset before a new one is established.
 */
export async function getPool(): Promise<sql.ConnectionPool> {
  if (pool && !pool.connected) {
    // Pool object exists but the underlying connection was dropped — reset so
    // we don't try to reuse a broken socket
    resetPool();
  }
  if (!pool) {
    pool = await sql.connect(config);
  }
  return pool;
}

/**
 * Closes the current pool (fire-and-forget) and nulls the reference so the
 * next `getPool()` call creates a fresh connection.
 */
export function resetPool(): void {
  if (pool) {
    pool.close().catch(() => {});
    pool = null;
  }
}

/**
 * Wraps a DB operation with retry logic for transient Azure SQL timeouts.
 *
 * Azure SQL will close idle connections, and the mssql driver surfaces this
 * as an `ETIMEOUT` error rather than a connection error. When that happens we
 * reset the pool so the next attempt gets a fresh connection. Up to `retries`
 * attempts are made; all other error codes are re-thrown immediately.
 *
 * 8 retries at an 8 s timeout each is enough to outlast a typical Azure SQL
 * reconnect (~4–6 s), while staying within Vercel's function time limit.
 */
export async function withRetry<T>(fn: () => Promise<T>, retries = 8): Promise<T> {
  try {
    return await fn();
  } catch (err: any) {
    if (retries > 0 && err.code === 'ETIMEOUT') {
      console.warn('DB connection timed out, resetting pool and retrying...');
      resetPool();
      return withRetry(fn, retries - 1);
    }
    throw err;
  }
}

/**
 * Sends a trivial query to verify the connection is alive.
 * Called on server startup (via instrumentation.ts) to warm the pool.
 */
export async function ping(): Promise<void> {
  const p = await getPool();
  await p.request().query('SELECT 1');
}

export { sql };
