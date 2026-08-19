import { securityHeaders } from './src/lib/security/headers.mjs'

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  productionBrowserSourceMaps: false,
  experimental: {
    serverActions: { bodySizeLimit: '16mb' },
  },
  /**
   * Left as CommonJS externals in the server bundle rather than bundled.
   * These packages use dynamic `require`, native bindings or Node built-ins in
   * ways webpack cannot statically follow; bundling them either breaks the
   * build or produces a needlessly large server chunk.
   */
  serverExternalPackages: [
    'twilio',
    'mailgun.js',
    'exceljs',
    'pdf-lib',
    '@aws-sdk/client-s3',
    '@aws-sdk/s3-request-presigner',
    'postgres',
    'pg',
    'bcryptjs',
  ],
  images: {
    remotePatterns: [
      { protocol: 'https', hostname: 'images.unsplash.com' },
      { protocol: 'https', hostname: '**.s3.amazonaws.com' },
      { protocol: 'https', hostname: '**.supabase.co' },
    ],
  },
  async headers() {
    return [
      // `middleware.ts` sets its own per-request, nonced Content-Security-Policy
      // on every path it processes — a second CSP header here would be
      // enforced as an *intersection* with that one, not a replacement, and
      // would re-block Next's inline hydration scripts (see `securityHeaders`'s
      // `includeCsp` doc comment). Everything middleware's matcher excludes
      // (`/api/**`, `_next/*`, static files) still needs a CSP of its own.
      { source: '/:path*', headers: securityHeaders(undefined, { includeCsp: false }) },
      { source: '/api/:path*', headers: securityHeaders() },
    ]
  },
  async redirects() {
    return [{ source: '/', destination: '/en', permanent: false }]
  },
}

export default nextConfig
