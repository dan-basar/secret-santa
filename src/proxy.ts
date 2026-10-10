import { NextRequest, NextResponse } from 'next/server';
import { sql } from '@/lib/db';

// Rate limiter backed by the RateLimits table, so every Vercel instance counts
// against the same numbers. One row per hashed IP + route per hour; a single
// atomic upsert bumps the count and returns it.

// Hourly limits per IP, per route
const RATE_LIMITS: Record<string, number> = {
  '/api/create-draw': 10,
  '/api/send-emails': 5,
  '/api/delete-draw': 10,
};

// Roughly 1 in this many limited requests also deletes counter rows older than
// 2 days. They're counters, not people's data: a documented exception to the
// soft-delete rule (CLAUDE.md).
const CLEANUP_ONE_IN = 100;

const BASE_PATH = '/secret-santa';

// IPs exempt from rate limiting — loaded from RATE_LIMIT_IP_WHITELIST env var
// (comma-separated, e.g. "1.2.3.4,5.6.7.8"). Set in .env.local, never commit IPs.
const WHITELISTED_IPS = new Set(
  (process.env.RATE_LIMIT_IP_WHITELIST ?? '').split(',').map(s => s.trim()).filter(Boolean)
);

// SHA-256 hex of the IP and route, so raw IPs are never stored
async function bucketFor(ip: string, apiPath: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(`${ip}:${apiPath}`));
  return Array.from(new Uint8Array(digest), b => b.toString(16).padStart(2, '0')).join('');
}

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

  // Get client IP — Vercel provides this header
  const ip =
    request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ||
    request.headers.get('x-real-ip') ||
    'unknown';

  if (WHITELISTED_IPS.has(ip)) {
    return NextResponse.next();
  }

  let hits: number;
  try {
    const bucket = await bucketFor(ip, apiPath);
    const rows = await sql`
      INSERT INTO RateLimits (bucket, window_start, hits)
      VALUES (${bucket}, date_bin('1 hour', now(), 'epoch'), 1)
      ON CONFLICT (bucket, window_start) DO UPDATE SET hits = RateLimits.hits + 1
      RETURNING hits`;
    hits = rows[0].hits as number;

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
