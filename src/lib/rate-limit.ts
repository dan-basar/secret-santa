import { rateLimitClient } from '@/lib/ip-prefix';

// Shared by the proxy's hourly request limits and send-emails' per-IP email
// budget, which both count into the RateLimits table.

/** The client's IP as Vercel passes it on; "unknown" when there is none */
export function clientIp(forwardedFor: string | null | undefined, realIp: string | null | undefined): string {
  return forwardedFor?.split(',')[0]?.trim() || realIp || 'unknown';
}

/**
 * True for IPs in RATE_LIMIT_IP_WHITELIST (comma-separated, e.g. "1.2.3.4,5.6.7.8").
 * Set it in .env.local or Vercel; never commit IPs.
 */
export function isWhitelisted(ip: string): boolean {
  return (process.env.RATE_LIMIT_IP_WHITELIST ?? '').split(',').map(s => s.trim()).includes(ip);
}

/**
 * The RateLimits bucket for one client and one scope (an API route, or
 * "email-budget"): the HMAC-SHA-256 hex of the client (IPv4 address or IPv6 /64)
 * and the scope, keyed with RATE_LIMIT_HASH_SECRET. A plain hash of an IPv4
 * address could be reversed by trying all 4 billion of them; without the secret
 * it can't. A missing secret throws, and callers fail open
 */
export async function rateLimitBucket(ip: string, scope: string): Promise<string> {
  const secret = process.env.RATE_LIMIT_HASH_SECRET;
  if (!secret) throw new Error('RATE_LIMIT_HASH_SECRET is not set');
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const digest = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(`${rateLimitClient(ip)}:${scope}`));
  return Array.from(new Uint8Array(digest), b => b.toString(16).padStart(2, '0')).join('');
}
