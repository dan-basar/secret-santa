import { NextRequest, NextResponse } from 'next/server';
import { sql } from '@/lib/db';
import { BASE_PATH } from '@/lib/site';
import { clientIp, isWhitelisted, rateLimitBucket } from '@/lib/rate-limit';

// Rate limiter backed by the RateLimits table, so every Vercel instance counts
// against the same numbers. One row per hashed client + route per hour; a single
// atomic upsert bumps the count and returns it.

// Hourly limits per IP, per route. get-draw and reveal look a draw up by the
// short secret in a link, so their limits are what keep guessing those slow;
// 60 an hour is far more than a household opening its links ever needs
const RATE_LIMITS: Record<string, number> = {
  '/api/create-draw': 10,
  '/api/send-emails': 5,
  '/api/delete-draw': 10,
  '/api/get-draw': 60,
  '/api/reveal': 60,
  '/api/save-details': 30,
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

// Only run proxy on API routes
export const config = {
  matcher: '/api/:path*',
};
