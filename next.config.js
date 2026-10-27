// Shared with src/lib/site.ts (BASE_PATH), so the prefix is defined once
const { basePath } = require('./src/lib/base-path.json');

// No plugins, no <base> tag that could redirect relative URLs, no framing. There
// is no script-src: Turbopack builds put a small inline bootstrap script in every
// page, which a script-src without 'unsafe-inline' would block
const contentSecurityPolicy = [
  "object-src 'none'",
  "base-uri 'self'",
  "frame-ancestors 'none'",
].join('; ');

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // Don't advertise the framework in an X-Powered-By header
  poweredByHeader: false,
  basePath,
  async headers() {
    const security = [
      { key: 'Content-Security-Policy', value: contentSecurityPolicy },
      { key: 'X-Frame-Options', value: 'DENY' },
      { key: 'X-Content-Type-Options', value: 'nosniff' },
      { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
      { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=(), payment=(), usb=()' },
    ];
    // Draw and reveal links are private, so keep every state of those pages out of search results
    const noindex = [{ key: 'X-Robots-Tag', value: 'noindex, nofollow' }];
    return [
      { source: '/:path*', headers: security },
      { source: '/draw', headers: noindex },
      { source: '/reveal/:path*', headers: noindex },
    ];
  },
  // Visitors reach the app through www.baseworkshop.app, whose root belongs to
  // baseworkshop-home, so Web Analytics' /_vercel/insights there isn't this
  // project's. _app.tsx asks for it under the base path instead, and this hands
  // it to the copy Vercel serves at the root of this project's own address.
  // Vercel sets the variable at build time; locally there is nothing to proxy
  async rewrites() {
    const host = process.env.VERCEL_PROJECT_PRODUCTION_URL;
    return host ? [{ source: '/_vercel/insights/:path*', destination: `https://${host}/_vercel/insights/:path*` }] : [];
  },
}

module.exports = nextConfig
