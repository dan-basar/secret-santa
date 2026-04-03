import { NextRequest, NextResponse } from 'next/server';

// Simple in-memory rate limiter using a Map
// Note: On Vercel serverless, each cold start gets a fresh Map, so this is
// per-instance. For a low-traffic app this is sufficient. For heavier traffic,
// consider Vercel KV or Upstash Redis.

interface RateEntry {
  count: number;
  resetAt: number;
}

const rateLimitMap = new Map<string, RateEntry>();

// Clean up expired entries periodically to prevent memory leaks
function cleanupExpired() {
  const now = Date.now();
  rateLimitMap.forEach((entry, key) => {
    if (now > entry.resetAt) {
      rateLimitMap.delete(key);
    }
  });
}

// Run cleanup every 60 seconds
let lastCleanup = Date.now();

function rateLimit(ip: string, limit: number, windowMs: number): boolean {
  const now = Date.now();

  // Periodic cleanup
  if (now - lastCleanup > 60_000) {
    cleanupExpired();
    lastCleanup = now;
  }

  const entry = rateLimitMap.get(ip);

  if (!entry || now > entry.resetAt) {
    rateLimitMap.set(ip, { count: 1, resetAt: now + windowMs });
    return true; // allowed
  }

  if (entry.count < limit) {
    entry.count++;
    return true; // allowed
  }

  return false; // blocked
}

// Rate limit configuration per route
const RATE_LIMITS: Record<string, { limit: number; windowMs: number }> = {
  '/api/create-draw': { limit: 10, windowMs: 60 * 60 * 1000 }, // 10 per hour per IP
  '/api/send-emails': { limit: 5, windowMs: 60 * 60 * 1000 },  // 5 per hour per IP
  '/api/delete-draw': { limit: 10, windowMs: 60 * 60 * 1000 }, // 10 per hour per IP
};

const BASE_PATH = '/secret-santa';

// IPs exempt from rate limiting — loaded from RATE_LIMIT_IP_WHITELIST env var
// (comma-separated, e.g. "1.2.3.4,5.6.7.8"). Set in .env.local, never commit IPs.
const WHITELISTED_IPS = new Set(
  (process.env.RATE_LIMIT_IP_WHITELIST ?? '').split(',').map(s => s.trim()).filter(Boolean)
);

export function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;
  // Normalize: strip basePath if present (request.nextUrl.pathname includes it)
  const apiPath = pathname.startsWith(BASE_PATH)
    ? pathname.slice(BASE_PATH.length)
    : pathname;

  const config = RATE_LIMITS[apiPath];
  if (!config) {
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

  const key = `${ip}:${apiPath}`;
  const allowed = rateLimit(key, config.limit, config.windowMs);

  if (!allowed) {
    return NextResponse.json(
      { error: 'Sorry, too many requests from your IP address. Please try again later.' },
      { status: 429 }
    );
  }

  return NextResponse.next();
}

// Only run middleware on API routes
export const config = {
  matcher: '/api/:path*',
};
