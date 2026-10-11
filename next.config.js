// Shared with src/lib/site.ts (BASE_PATH), so the prefix is defined once
const { basePath } = require('./src/lib/base-path.json');

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  basePath,
  async headers() {
    const security = [
      { key: 'Content-Security-Policy', value: "frame-ancestors 'none'" },
      { key: 'X-Frame-Options', value: 'DENY' },
      { key: 'X-Content-Type-Options', value: 'nosniff' },
      { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
      { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=(), payment=(), usb=()' },
    ];
    // Draw and reveal links are private, so keep every state of those pages out of search results
    const noindex = [{ key: 'X-Robots-Tag', value: 'noindex, nofollow' }];
    return [
      { source: '/:path*', headers: security },
      { source: '/draw/:path*', headers: noindex },
      { source: '/reveal/:path*', headers: noindex },
    ];
  },
}

module.exports = nextConfig
