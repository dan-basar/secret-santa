/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  basePath: '/secret-santa',
  async headers() {
    // Draw and reveal links are private, so keep every state of those pages out of search results
    const noindex = [{ key: 'X-Robots-Tag', value: 'noindex, nofollow' }];
    return [
      { source: '/draw/:path*', headers: noindex },
      { source: '/reveal/:path*', headers: noindex },
    ];
  },
}

module.exports = nextConfig
