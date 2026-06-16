/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  transpilePackages: ['@lumpy/shared'],
  async headers() {
    return [
      {
        // App-shell HTML / navigations must always revalidate so a new deploy is
        // picked up immediately (Next otherwise prerenders "/" with a ~1-year
        // s-maxage, which can serve a stale shell pointing at old chunks). Hashed
        // /_next/static assets are excluded and keep their immutable cache.
        source: '/((?!_next/).*)',
        headers: [{ key: 'Cache-Control', value: 'no-cache, must-revalidate' }],
      },
    ];
  },
};

export default nextConfig;
