/** @type {import('next').NextConfig} */
const nextConfig = {
  experimental: { typedRoutes: true },
  output: 'standalone',
  typescript: {
    ignoreBuildErrors: true,
  },
  eslint: {
    ignoreDuringBuilds: true,
  },
};
module.exports = nextConfig;
