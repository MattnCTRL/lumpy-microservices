/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  transpilePackages: ['@lumpy/shared'],
  async redirects() {
    // The old per-tab routes folded into the unified command center at "/".
    // A real server-level 307 (vs a page-level redirect) so old links/bookmarks
    // land cleanly without depending on client hydration.
    return [
      { source: '/tasks', destination: '/', permanent: false },
      { source: '/sessions', destination: '/', permanent: false },
    ];
  },
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
