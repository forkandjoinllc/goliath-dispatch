import type { MetadataRoute } from 'next'
import { siteUrl } from './[locale]/(marketing)/_lib/site'

/**
 * Allows the marketing site; disallows everything behind a session
 * (`/app`, per `docs/architecture.md` §1's `/{locale}/app/…` convention),
 * the API surface, and the authentication flow.
 *
 * The auth route group (`src/app/[locale]/(auth)/**`, another agent's) has
 * no literal `/sign` URL segment today — its routes are `/login`, `/signup`,
 * `/forgot-password`, `/reset-password`, `/accept-invitation` and
 * `/verify-email` — so both the `/sign*` prefix named in this project's
 * conventions and those concrete paths are disallowed, to cover whichever
 * shape that group ends up with.
 */
export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      {
        userAgent: '*',
        allow: '/',
        disallow: [
          '/app',
          '/*/app',
          '/api',
          '/*/api',
          '/sign',
          '/*/sign*',
          '/*/login',
          '/*/signup',
          '/*/forgot-password',
          '/*/reset-password',
          '/*/accept-invitation',
          '/*/verify-email',
        ],
      },
    ],
    sitemap: `${siteUrl()}/sitemap.xml`,
  }
}
