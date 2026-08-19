import type { Metadata } from 'next'
import { FileText } from 'lucide-react'
import { isLocale, type Locale } from '@/i18n/config'
import { getDictionary } from '@/i18n/dictionary'
import { createTranslator } from '@/i18n/translate'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { PageHero } from '../_components/page-hero'
import { Section } from '../_components/section'
import { MarketingBreadcrumbs } from '../_components/marketing-breadcrumbs'
import { CarrierSignupForm } from '../_components/carrier-signup-form'
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
  const title = t('marketing.seo.carrierSignup.title')
  const description = t('marketing.seo.carrierSignup.description')
  const path = localePath(raw, 'carrier-signup')
  return {
    title,
    description,
    alternates: { canonical: path, languages: languageAlternates('carrier-signup') },
    openGraph: { title, description, url: absoluteUrl(path), locale: raw, type: 'website' },
  }
}

const NEXT_STEP_KEYS = ['coi', 'authority', 'w9', 'noa', 'equipmentPhotos'] as const

export default async function CarrierSignupPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale: raw } = await params
  if (!isLocale(raw)) return null
  const locale: Locale = raw
  const dictionary = await getDictionary(locale, ['marketing', 'nav', 'errors', 'validation'])
  const t = createTranslator(dictionary, locale)

  return (
    <>
      <PageHero title={t('marketing.carrierSignup.hero.title')} subtitle={t('marketing.carrierSignup.hero.subtitle')} />
      <MarketingBreadcrumbs
        homeLabel={t('nav.breadcrumb.home')}
        locale={locale}
        items={[{ label: t('nav.public.carrierSignup') }]}
      />

      <Section>
        <div className="grid gap-10 lg:grid-cols-3">
          <div className="lg:col-span-2">
            <CarrierSignupForm />
          </div>
          <Card className="h-fit lg:sticky lg:top-24">
            <CardHeader>
              <CardTitle as="h2">{t('marketing.carrierSignup.whatHappensNext.title')}</CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-sm text-steel-600">{t('marketing.carrierSignup.whatHappensNext.intro')}</p>
              <ul className="mt-4 space-y-3">
                {NEXT_STEP_KEYS.map((key) => (
                  <li key={key} className="flex gap-2 text-sm text-steel-700">
                    <FileText className="mt-0.5 size-4 shrink-0 text-navy-700" aria-hidden="true" />
                    {t(`marketing.carrierSignup.whatHappensNext.${key}`)}
                  </li>
                ))}
              </ul>
            </CardContent>
          </Card>
        </div>
      </Section>
    </>
  )
}
