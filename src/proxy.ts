import { NextRequest, NextResponse } from 'next/server';
import { sql } from '@/lib/db';
import { BASE_PATH } from '@/lib/site';
import { rateLimitClient } from '@/lib/ip-prefix';

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

// IPs exempt from rate limiting — loaded from RATE_LIMIT_IP_WHITELIST env var
// (comma-separated, e.g. "1.2.3.4,5.6.7.8"). Set in .env.local, never commit IPs.
const WHITELISTED_IPS = new Set(
  (process.env.RATE_LIMIT_IP_WHITELIST ?? '').split(',').map(s => s.trim()).filter(Boolean)
);

// HMAC-SHA-256 hex of the client (IPv4 address or IPv6 /64) and route, keyed
// with RATE_LIMIT_HASH_SECRET. A plain hash of an IPv4 address could be reversed
// by trying all 4 billion of them; without the secret it can't. A missing secret
// throws, and the request fails open like any other rate-limit error
async function bucketFor(ip: string, apiPath: string): Promise<string> {
  const secret = process.env.RATE_LIMIT_HASH_SECRET;
  if (!secret) throw new Error('RATE_LIMIT_HASH_SECRET is not set');
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const digest = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(`${rateLimitClient(ip)}:${apiPath}`));
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
// invocation, so an unlimited route (health) skips it entirely. Next reads this
// list at build time, so it has to be written out; tests/proxy.test.ts checks it
// matches RATE_LIMITS
export const config = {
  matcher: [
    '/api/create-draw',
    '/api/send-emails',
    '/api/delete-draw',
    '/api/get-draw',
    '/api/reveal',
    '/api/save-details',
  ],
};
