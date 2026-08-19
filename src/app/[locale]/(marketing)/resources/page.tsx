import type { Metadata } from 'next'
import { BookOpen } from 'lucide-react'
import { isLocale, type Locale } from '@/i18n/config'
import { getDictionary } from '@/i18n/dictionary'
import { createTranslator } from '@/i18n/translate'
import { RESOURCE_ENTRIES } from '@/server/marketing/content'
import { PageHero } from '../_components/page-hero'
import { Section } from '../_components/section'
import { MarketingBreadcrumbs } from '../_components/marketing-breadcrumbs'
import { localePath, languageAlternates, absoluteUrl } from '../_lib/site'

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>
}): Promise<Metadata> {
  const { locale: raw } = await params
  if (!isLocale(raw)) return {}
  const dictionary = await getDictionary(raw, ['marketing'])
  const t = createTranslator(dictionary, raw)
  const title = t('marketing.seo.resources.title')
  const description = t('marketing.seo.resources.description')
  const path = localePath(raw, 'resources')
  return {
    title,
    description,
    alternates: { canonical: path, languages: languageAlternates('resources') },
    openGraph: { title, description, url: absoluteUrl(path), locale: raw, type: 'website' },
  }
}

export default async function ResourcesPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale: raw } = await params
  if (!isLocale(raw)) return null
  const locale: Locale = raw
  const dictionary = await getDictionary(locale, ['marketing', 'nav'])
  const t = createTranslator(dictionary, locale)

  return (
    <>
      <PageHero title={t('marketing.resources.hero.title')} subtitle={t('marketing.resources.hero.subtitle')} />
      <MarketingBreadcrumbs homeLabel={t('nav.breadcrumb.home')} locale={locale} items={[{ label: t('nav.public.resources') }]} />

      <Section>
        {RESOURCE_ENTRIES.length === 0 ? (
          <div className="mx-auto flex max-w-md flex-col items-center gap-3 py-12 text-center">
            <BookOpen className="size-10 text-steel-400" aria-hidden="true" />
            <h2 className="text-xl font-bold">{t('marketing.resources.emptyState.title')}</h2>
            <p className="text-steel-600">{t('marketing.resources.emptyState.body')}</p>
          </div>
        ) : (
          <ul className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
            {RESOURCE_ENTRIES.map((entry) => (
              <li key={entry.slug} className="rounded-lg border border-steel-200 p-5">
                {t(entry.titleKey)}
              </li>
            ))}
          </ul>
        )}
      </Section>
    </>
  )
}
