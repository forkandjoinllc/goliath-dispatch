import type { MetadataRoute } from 'next'
import { LOCALES } from '@/i18n/config'
import {
  MARKETING_ROUTES,
  absoluteUrl,
  languageAlternates,
  localePath,
} from './[locale]/(marketing)/_lib/site'

/**
 * Every marketing route, in both locales, with `hreflang` alternates. This is
 * the sitemap `tests/unit/marketing/sitemap.test.ts` checks against — the
 * canonical list of routes lives in `MARKETING_ROUTES`
 * (`src/app/[locale]/(marketing)/_lib/site.ts`), so a page added there is
 * added here automatically.
 */
export default function sitemap(): MetadataRoute.Sitemap {
  const entries: MetadataRoute.Sitemap = []

  for (const route of MARKETING_ROUTES) {
    for (const locale of LOCALES) {
      entries.push({
        url: absoluteUrl(localePath(locale, route)),
        changeFrequency: route === 'home' ? 'weekly' : 'monthly',
        priority: route === 'home' ? 1 : 0.6,
        alternates: { languages: languageAlternates(route) },
      })
    }
  }

  return entries
}
