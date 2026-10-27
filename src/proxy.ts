import { NextRequest, NextResponse } from 'next/server';
import { sql } from '@/lib/db';
import { BASE_PATH } from '@/lib/site';
import { clientIp, isWhitelisted, rateLimitBucket } from '@/lib/rate-limit';

// Rate limiter backed by the RateLimits table, so every Vercel instance counts
// against the same numbers. One row per hashed client + route per hour; a single
// atomic upsert bumps the count and returns it.

// Hourly limits per IP, on the two routes that cost something: new draws (rows)
// and sends (emails). The routes that look a draw up by a link's secret aren't
// limited here: the secret's length already puts guessing out of reach
// (docs/ARCHITECTURE.md), and the Firewall's 60 a minute stops floods, so a
// counter write on every page view would buy nothing
const RATE_LIMITS: Record<string, number> = {
  '/api/create-draw': 10,
  '/api/send-emails': 5,
};

// Roughly 1 in this many limited requests also deletes counter rows older than
// 2 days. They're counters, not people's data: a documented exception to the
// soft-delete rule (CLAUDE.md).
const CLEANUP_ONE_IN = 100;

export async function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;
  // Normalize: strip basePath if present (request.nextUrl.pathname includes it)
  const apiPath = pathname.startsWith(BASE_PATH)
    ? pathname.slice(BASE_PATH.length)
    : pathname;

  const limit = RATE_LIMITS[apiPath];
  if (limit === undefined) {
    return NextResponse.next(); // No rate limit for this route
  }

  // Vercel provides these headers
  const ip = clientIp(request.headers.get('x-forwarded-for'), request.headers.get('x-real-ip'));

  if (isWhitelisted(ip)) {
    return NextResponse.next();
  }

  let hits: number;
  try {
    const bucket = await rateLimitBucket(ip, apiPath);
    const rows = await sql`
      INSERT INTO RateLimits (bucket, window_start, hits)
      VALUES (${bucket}, date_bin('1 hour', now(), 'epoch'), 1)
      ON CONFLICT (bucket, window_start) DO UPDATE SET hits = RateLimits.hits + 1
      RETURNING hits` as { hits: number }[];
    hits = rows[0].hits;

    if (Math.random() < 1 / CLEANUP_ONE_IN) {
      await sql`DELETE FROM RateLimits WHERE window_start < now() - interval '2 days'`;
    }
  } catch (error) {
    // Fail open: a database hiccup must never block real organizers
    console.error('Rate limit check failed; allowing request', error);
    return NextResponse.next();
  }

  if (hits > limit) {
    return NextResponse.json(
      { error: 'Sorry, too many requests from your IP address. Please try again later.' },
      { status: 429 }
    );
  }

  return NextResponse.next();
}

// Only run on the routes in RATE_LIMITS: on Vercel the proxy is its own
// invocation, so an unlimited route skips it entirely. Next reads this
// list at build time, so it has to be written out; tests/proxy.test.ts checks it
// matches RATE_LIMITS
export const config = {
  matcher: [
    '/api/create-draw',
    '/api/send-emails',
  ],
};
