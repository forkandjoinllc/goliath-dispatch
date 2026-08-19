import { describe, expect, it } from 'vitest'
import sitemap from '@/app/sitemap'
import { LOCALES } from '@/i18n/config'
import { MARKETING_ROUTES, absoluteUrl, localePath } from '@/app/[locale]/(marketing)/_lib/site'

describe('marketing sitemap', () => {
  const entries = sitemap()

  it('contains every marketing route in every locale', () => {
    expect(entries).toHaveLength(MARKETING_ROUTES.length * LOCALES.length)

    for (const route of MARKETING_ROUTES) {
      for (const locale of LOCALES) {
        const url = absoluteUrl(localePath(locale, route))
        expect(entries.some((entry) => entry.url === url)).toBe(true)
      }
    }
  })

  it('gives every entry a full set of language alternates', () => {
    for (const entry of entries) {
      expect(entry.alternates?.languages).toBeDefined()
      const languages = entry.alternates!.languages as Record<string, string>
      for (const locale of LOCALES) {
        expect(languages).toHaveProperty(locale === 'en' ? 'en-US' : 'es-US')
      }
      expect(languages).toHaveProperty('x-default')
    }
  })

  it('has no duplicate URLs', () => {
    const urls = entries.map((entry) => entry.url)
    expect(new Set(urls).size).toBe(urls.length)
  })
})
