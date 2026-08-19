import { NextResponse, type NextRequest } from 'next/server'
import { LOCALES, LOCALE_COOKIE, LOCALE_COOKIE_MAX_AGE, isLocale, negotiateLocale } from '@/i18n/config'
import { contentSecurityPolicy } from '@/lib/security/headers.mjs'

/**
 * Edge middleware.
 *
 * Responsibilities, in order:
 *  1. Route every page under an explicit /{locale} segment so language is a
 *     first-class part of the URL (shareable, cacheable, indexable).
 *  2. Remember the visitor's choice.
 *  3. Attach a per-request nonce and request id used by CSP and the audit trail.
 *
 * Authentication is deliberately NOT decided here: the edge cannot see the
 * database, and a redirect based on cookie presence alone would be a security
 * theatre. Access is enforced in the server components and actions that read it.
 */

const PUBLIC_FILE = /\.(?:png|jpe?g|gif|svg|ico|webp|avif|css|js|map|txt|xml|webmanifest|woff2?)$/i

function skip(pathname: string): boolean {
  return (
    pathname.startsWith('/_next') ||
    pathname.startsWith('/api') ||
    pathname === '/favicon.ico' ||
    pathname === '/robots.txt' ||
    pathname === '/sitemap.xml' ||
    pathname === '/manifest.webmanifest' ||
    PUBLIC_FILE.test(pathname)
  )
}

export function middleware(request: NextRequest) {
  const { pathname, search } = request.nextUrl

  if (skip(pathname)) return NextResponse.next()

  const segments = pathname.split('/')
  const maybeLocale = segments[1]

  if (!isLocale(maybeLocale)) {
    const cookieLocale = request.cookies.get(LOCALE_COOKIE)?.value
    const locale = isLocale(cookieLocale)
      ? cookieLocale
      : negotiateLocale(request.headers.get('accept-language'))

    const url = request.nextUrl.clone()
    url.pathname = `/${locale}${pathname === '/' ? '' : pathname}`
    url.search = search
    return NextResponse.redirect(url)
  }

  // Base64, not hex/uuid-with-dashes: this is what ends up inside the CSP
  // `'nonce-<value>'` source and inline `<script nonce>` attributes, and
  // base64 is the encoding both the CSP spec and Next's own
  // `getScriptNonceFromHeader` expect.
  const nonce = Buffer.from(crypto.randomUUID()).toString('base64')
  const csp = contentSecurityPolicy(nonce)

  const requestHeaders = new Headers(request.headers)
  requestHeaders.set('x-request-id', crypto.randomUUID())
  requestHeaders.set('x-pathname', pathname)
  requestHeaders.set('x-locale', maybeLocale)
  requestHeaders.set('x-nonce', nonce)
  // Setting this on the *request* headers (not just the response) is what
  // lets Next's App Router discover the nonce and apply it to every script
  // it injects for this render — see `getScriptNonceFromHeader` in
  // `next/dist/server/app-render`, which reads
  // `request.headers['content-security-policy']`.
  requestHeaders.set('Content-Security-Policy', csp)

  const response = NextResponse.next({ request: { headers: requestHeaders } })
  // The header the browser actually enforces — must carry the same nonce
  // the request header advertised, or Next's nonced scripts would be
  // rejected by a differently-nonced policy.
  response.headers.set('Content-Security-Policy', csp)

  // Persist an explicit choice so the next visit lands in the same language.
  if (request.cookies.get(LOCALE_COOKIE)?.value !== maybeLocale) {
    response.cookies.set(LOCALE_COOKIE, maybeLocale, {
      path: '/',
      maxAge: LOCALE_COOKIE_MAX_AGE,
      sameSite: 'lax',
      secure: process.env.NODE_ENV === 'production',
    })
  }

  return response
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico|robots.txt|sitemap.xml).*)'],
}

export { LOCALES }
