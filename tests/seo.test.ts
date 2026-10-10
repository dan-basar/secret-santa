import { describe, it, expect, afterEach } from 'vitest';
import nextConfig from '../next.config.js';
import { siteUrl } from '@/lib/site';

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

describe('next.config.js headers', () => {
  it('sends noindex on every draw and reveal page', async () => {
    const rules = await nextConfig.headers!();
    for (const source of ['/draw/:path*', '/reveal/:path*']) {
      const rule = rules.find((r: { source: string }) => r.source === source);
      expect(rule?.headers).toContainEqual({ key: 'X-Robots-Tag', value: 'noindex, nofollow' });
    }
  });

  it('sends the security headers on every route', async () => {
    const rules = await nextConfig.headers!();
    const rule = rules.find((r: { source: string }) => r.source === '/:path*');
    expect(rule?.headers).toContainEqual({ key: 'Content-Security-Policy', value: "frame-ancestors 'none'" });
    expect(rule?.headers).toContainEqual({ key: 'X-Frame-Options', value: 'DENY' });
  });
});
