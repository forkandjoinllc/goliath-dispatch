import type { Metadata } from 'next'
import { isLocale, type Locale } from '@/i18n/config'
import { getDictionary } from '@/i18n/dictionary'
import { createTranslator } from '@/i18n/translate'
import { Card, CardContent } from '@/components/ui/card'
import { PageHero } from '../_components/page-hero'
import { Section, SectionHeading } from '../_components/section'
import { MarketingBreadcrumbs } from '../_components/marketing-breadcrumbs'
import { QuoteForm } from '../_components/quote-form'
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
  const title = t('marketing.seo.forClients.title')
  const description = t('marketing.seo.forClients.description')
  const path = localePath(raw, 'for-clients')
  return {
    title,
    description,
    alternates: { canonical: path, languages: languageAlternates('for-clients') },
    openGraph: { title, description, url: absoluteUrl(path), locale: raw, type: 'website' },
  }
}

export default async function ForClientsPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale: raw } = await params
  if (!isLocale(raw)) return null
  const locale: Locale = raw
  const dictionary = await getDictionary(locale, ['marketing', 'nav', 'errors', 'validation'])
  const t = createTranslator(dictionary, locale)

  return (
    <>
      <PageHero title={t('marketing.forClients.hero.title')} subtitle={t('marketing.forClients.hero.subtitle')} />
      <MarketingBreadcrumbs
        homeLabel={t('nav.breadcrumb.home')}
        locale={locale}
        items={[{ label: t('nav.public.forClients') }]}
      />

      <Section>
        <div className="grid gap-6 sm:grid-cols-2">
          <Card>
            <CardContent className="pt-6">
              <h2 className="text-xl font-bold">{t('marketing.forClients.quoting.title')}</h2>
              <p className="mt-2 text-steel-600">{t('marketing.forClients.quoting.body')}</p>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="pt-6">
              <h2 className="text-xl font-bold">{t('marketing.forClients.tracking.title')}</h2>
              <p className="mt-2 text-steel-600">{t('marketing.forClients.tracking.body')}</p>
              <p className="mt-3 text-sm italic text-steel-500">{t('marketing.forClients.tracking.accountNote')}</p>
            </CardContent>
          </Card>
        </div>
      </Section>

      <Section tone="subtle" id="quote">
        <SectionHeading
          eyebrow={t('nav.public.requestQuote')}
          title={t('marketing.forClients.cta.title')}
          subtitle={t('marketing.forClients.cta.body')}
        />
        <div className="mt-8 max-w-2xl">
          <QuoteForm />
        </div>
      </Section>
    </>
  )
}
