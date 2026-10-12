import { describe, it, expect, afterEach } from 'vitest';
import nextConfig from '../next.config.js';
import { BASE_PATH, siteUrl } from '@/lib/site';

const originalBaseUrl = process.env.NEXT_PUBLIC_BASE_URL;

afterEach(() => {
  process.env.NEXT_PUBLIC_BASE_URL = originalBaseUrl;
});

describe('siteUrl', () => {
  it('adds the basePath to the origin exactly once', () => {
    for (const base of ['https://baseworkshop.app', 'https://baseworkshop.app/', 'https://baseworkshop.app/secret-santa/']) {
      process.env.NEXT_PUBLIC_BASE_URL = base;
      expect(siteUrl()).toBe('https://baseworkshop.app/secret-santa');
      expect(siteUrl('/og-image.png')).toBe('https://baseworkshop.app/secret-santa/og-image.png');
    }
  });
});

describe('base path', () => {
  it('is the same value in next.config.js and site.ts', () => {
    expect(BASE_PATH).toBe('/secret-santa');
    expect(nextConfig.basePath).toBe(BASE_PATH);
  });
});

describe('next.config.js headers', () => {
  it('sends noindex on the organizer page and every reveal page', async () => {
    const rules = await nextConfig.headers!();
    for (const source of ['/draw', '/reveal/:path*']) {
      const rule = rules.find((r: { source: string }) => r.source === source);
      expect(rule?.headers).toContainEqual({ key: 'X-Robots-Tag', value: 'noindex, nofollow' });
    }
  });

  it('sends the security headers on every route', async () => {
    const rules = await nextConfig.headers!();
    const rule = rules.find((r: { source: string }) => r.source === '/:path*');
    expect(rule?.headers).toContainEqual({
      key: 'Content-Security-Policy',
      value: "object-src 'none'; base-uri 'self'; frame-ancestors 'none'",
    });
    expect(rule?.headers).toContainEqual({ key: 'X-Frame-Options', value: 'DENY' });
  });
});
