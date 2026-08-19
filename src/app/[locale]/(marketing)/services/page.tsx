import type { Metadata } from 'next'
import { ClipboardCheck, FileStack, FileText, MapPin, Route, Truck } from 'lucide-react'
import { isLocale, type Locale } from '@/i18n/config'
import { getDictionary } from '@/i18n/dictionary'
import { createTranslator } from '@/i18n/translate'
import { Card, CardContent } from '@/components/ui/card'
import { PageHero } from '../_components/page-hero'
import { Section } from '../_components/section'
import { MarketingBreadcrumbs } from '../_components/marketing-breadcrumbs'
import { JsonLd } from '../_components/json-ld'
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
  const title = t('marketing.seo.services.title')
  const description = t('marketing.seo.services.description')
  const path = localePath(raw, 'services')
  return {
    title,
    description,
    alternates: { canonical: path, languages: languageAlternates('services') },
    openGraph: { title, description, url: absoluteUrl(path), locale: raw, type: 'website' },
  }
}

const SERVICE_KEYS = [
  { key: 'dispatch', Icon: Truck },
  { key: 'onboardingCompliance', Icon: ClipboardCheck },
  { key: 'documentManagement', Icon: FileStack },
  { key: 'invoicingSettlements', Icon: FileText },
  { key: 'tracking', Icon: MapPin },
  { key: 'permitsEscorts', Icon: Route },
] as const

export default async function ServicesPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale: raw } = await params
  if (!isLocale(raw)) return null
  const locale: Locale = raw
  const dictionary = await getDictionary(locale, ['marketing', 'nav'])
  const t = createTranslator(dictionary, locale)

  return (
    <>
      <JsonLd
        data={{
          '@context': 'https://schema.org',
          '@type': 'Service',
          serviceType: 'Heavy-haul dispatch software',
          provider: { '@type': 'Organization', name: 'Goliath Dispatch' },
          areaServed: 'US',
          description: t('marketing.seo.services.description'),
        }}
      />
      <PageHero title={t('marketing.services.hero.title')} subtitle={t('marketing.services.hero.subtitle')} />
      <MarketingBreadcrumbs
        homeLabel={t('nav.breadcrumb.home')}
        locale={locale}
        items={[{ label: t('nav.public.services') }]}
      />
      <Section>
        <div className="grid gap-6 md:grid-cols-2">
          {SERVICE_KEYS.map(({ key, Icon }) => (
            <Card key={key}>
              <CardContent className="pt-6">
                <Icon className="size-8 text-navy-700" aria-hidden="true" />
                <h2 className="mt-4 text-xl font-bold">{t(`marketing.services.${key}.title`)}</h2>
                <p className="mt-2 text-steel-600">{t(`marketing.services.${key}.body`)}</p>
                <ul className="mt-4 space-y-1.5 text-sm text-steel-700">
                  <li className="flex gap-2">
                    <span aria-hidden="true">•</span>
                    {t(`marketing.services.${key}.bullet1`)}
                  </li>
                  <li className="flex gap-2">
                    <span aria-hidden="true">•</span>
                    {t(`marketing.services.${key}.bullet2`)}
                  </li>
                  <li className="flex gap-2">
                    <span aria-hidden="true">•</span>
                    {t(`marketing.services.${key}.bullet3`)}
                  </li>
                </ul>
              </CardContent>
            </Card>
          ))}
        </div>
      </Section>
    </>
  )
}
