/**
 * Security headers shared by next.config.mjs and the edge middleware.
 * Kept as plain ESM JS so the Next config (evaluated before TS transpile) can import it.
 */

const isDev = process.env.NODE_ENV !== 'production'

/**
 * Content Security Policy.
 * `nonce` is supplied by middleware for the per-request policy; the static
 * next.config policy falls back to 'strict-dynamic'-less directives.
 */
export function contentSecurityPolicy(nonce) {
  const scriptSrc = [
    "'self'",
    nonce ? `'nonce-${nonce}'` : null,
    isDev ? "'unsafe-eval'" : null,
    // `strict-dynamic` makes every host/scheme source (including `'self'`)
    // ignored by CSP3-conformant browsers — it is only safe to add once a
    // per-request `nonce` is actually present to anchor trust to, otherwise
    // it silently blocks every same-origin script the app ships (no
    // middleware currently issues a nonce, so the plain `next.config.mjs`
    // `headers()` call — `securityHeaders()` with no argument — must keep
    // working as a `'self'`-only policy, not a `strict-dynamic` one with
    // nothing to anchor it).
    nonce ? "'strict-dynamic'" : null,
    'https://js.stripe.com',
    'https://maps.googleapis.com',
  ].filter(Boolean)

  const directives = {
    'default-src': ["'self'"],
    'script-src': scriptSrc,
    'style-src': ["'self'", "'unsafe-inline'", 'https://fonts.googleapis.com'],
    'font-src': ["'self'", 'https://fonts.gstatic.com', 'data:'],
    'img-src': ["'self'", 'data:', 'blob:', 'https:'],
    'media-src': ["'self'", 'blob:', 'https:'],
    'connect-src': [
      "'self'",
      'https://api.stripe.com',
      'https://maps.googleapis.com',
      'https://places.googleapis.com',
      'https://routes.googleapis.com',
      ...(isDev ? ['ws:', 'http://localhost:*'] : []),
    ],
    'frame-src': ["'self'", 'https://js.stripe.com', 'https://hooks.stripe.com'],
    'worker-src': ["'self'", 'blob:'],
    'object-src': ["'none'"],
    'base-uri': ["'self'"],
    'form-action': ["'self'"],
    'frame-ancestors': ["'none'"],
    'upgrade-insecure-requests': [],
  }

  return Object.entries(directives)
    .map(([key, value]) => (value.length ? `${key} ${value.join(' ')}` : key))
    .join('; ')
}

/**
 * `includeCsp` defaults to true for direct callers (route handlers, tests),
 * but `next.config.mjs`'s static `headers()` call passes `false`: on every
 * path `middleware.ts` actually processes, middleware sets its own
 * per-request, nonced `Content-Security-Policy` on the response, and an
 * *additional* CSP header from this config-level call would not replace it —
 * browsers enforce two `Content-Security-Policy` headers as the
 * *intersection* of both policies, and this static, nonce-less call's
 * `script-src` has no way to allow Next's inline hydration scripts (no
 * `nonce`, deliberately no `unsafe-inline`), so the intersection would
 * silently block them again. The routes middleware skips (`/api/**`,
 * static assets) still get this as their only CSP.
 */
export function securityHeaders(nonce, { includeCsp = true } = {}) {
  return [
    ...(includeCsp ? [{ key: 'Content-Security-Policy', value: contentSecurityPolicy(nonce) }] : []),
    { key: 'X-Content-Type-Options', value: 'nosniff' },
    { key: 'X-Frame-Options', value: 'DENY' },
    { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
    {
      key: 'Permissions-Policy',
      value: 'camera=(self), microphone=(), geolocation=(self), payment=(self), interest-cohort=()',
    },
    { key: 'X-DNS-Prefetch-Control', value: 'off' },
    { key: 'X-Permitted-Cross-Domain-Policies', value: 'none' },
    { key: 'Cross-Origin-Opener-Policy', value: 'same-origin' },
    ...(isDev
      ? []
      : [
          {
            key: 'Strict-Transport-Security',
            value: 'max-age=63072000; includeSubDomains; preload',
          },
        ]),
  ]
}
