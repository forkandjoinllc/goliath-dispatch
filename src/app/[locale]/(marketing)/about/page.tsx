import type { Metadata } from 'next'
import { BadgeCheck, Languages, ScrollText } from 'lucide-react'
import { isLocale, type Locale } from '@/i18n/config'
import { getDictionary } from '@/i18n/dictionary'
import { createTranslator } from '@/i18n/translate'
import { Card, CardContent } from '@/components/ui/card'
import { PageHero } from '../_components/page-hero'
import { Section, SectionHeading } from '../_components/section'
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
  const title = t('marketing.seo.about.title')
  const description = t('marketing.seo.about.description')
  const path = localePath(raw, 'about')
  return {
    title,
    description,
    alternates: { canonical: path, languages: languageAlternates('about') },
    openGraph: { title, description, url: absoluteUrl(path), locale: raw, type: 'website' },
  }
}

const VALUE_KEYS = [
  { key: 'operationalHonesty', Icon: BadgeCheck },
  { key: 'bilingualByDefault', Icon: Languages },
  { key: 'auditableFinancials', Icon: ScrollText },
] as const

export default async function AboutPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale: raw } = await params
  if (!isLocale(raw)) return null
  const locale: Locale = raw
  const dictionary = await getDictionary(locale, ['marketing', 'nav'])
  const t = createTranslator(dictionary, locale)

  return (
    <>
      <PageHero title={t('marketing.about.hero.title')} subtitle={t('marketing.about.hero.subtitle')} />
      <MarketingBreadcrumbs homeLabel={t('nav.breadcrumb.home')} locale={locale} items={[{ label: t('nav.public.about') }]} />

      <Section>
        <div className="mx-auto max-w-3xl">
          <h2 className="text-2xl font-bold tracking-tight">{t('marketing.about.story.title')}</h2>
          <p className="mt-3 text-lg text-steel-700">{t('marketing.about.story.body')}</p>
        </div>
      </Section>

      <Section tone="subtle">
        <SectionHeading title={t('marketing.about.values.heading')} align="center" className="mx-auto" />
        <div className="mt-10 grid gap-6 md:grid-cols-3">
          {VALUE_KEYS.map(({ key, Icon }) => (
            <Card key={key}>
              <CardContent className="pt-6">
                <Icon className="size-8 text-safety-500" aria-hidden="true" />
                <h3 className="mt-4 text-lg font-bold">{t(`marketing.about.values.${key}.title`)}</h3>
                <p className="mt-2 text-sm text-steel-600">{t(`marketing.about.values.${key}.body`)}</p>
              </CardContent>
            </Card>
          ))}
        </div>
      </Section>
    </>
  )
}
