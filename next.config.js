/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  serverExternalPackages: ['mssql'],
  basePath: '/secret-santa',
}

module.exports = nextConfig

