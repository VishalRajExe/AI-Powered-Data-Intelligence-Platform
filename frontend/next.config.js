/** @type {import('next').NextConfig} */
// Server-side only. BACKEND_ORIGIN is never exposed to the browser (no NEXT_PUBLIC_* prefix).
// next.config.ts is not supported by Next 14.2.x (CONFIG_FILES = next.config.js | next.config.mjs).
// NOTE: `next build` bakes the resolved destination into .next/routes-manifest.json, so
// BACKEND_ORIGIN must be set for BOTH `next build` and `next start` in production/compose.
// `next dev` reads this file per process and needs it only at startup.
const backendOrigin = (process.env.BACKEND_ORIGIN ?? "http://localhost:8080").replace(/\/+$/, "");

if (!/^https?:\/\//.test(backendOrigin)) {
  throw new Error(
    `Invalid BACKEND_ORIGIN "${backendOrigin}" — it must be an absolute http(s) origin, e.g. http://localhost:8080`
  );
}

const nextConfig = {
  reactStrictMode: true,
  async rewrites() {
    return [
      {
        source: "/api/v1/:path*",
        destination: `${backendOrigin}/api/v1/:path*`,
      },
    ];
  },
};

module.exports = nextConfig;
