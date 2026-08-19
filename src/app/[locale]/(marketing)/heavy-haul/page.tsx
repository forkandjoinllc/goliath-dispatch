import type { Metadata } from 'next'
import { AlertTriangle } from 'lucide-react'
import { isLocale, type Locale } from '@/i18n/config'
import { getDictionary } from '@/i18n/dictionary'
import { createTranslator } from '@/i18n/translate'
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from '@/components/ui/accordion'
import { PageHero } from '../_components/page-hero'
import { Section, SectionHeading } from '../_components/section'
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
  const title = t('marketing.seo.heavyHaul.title')
  const description = t('marketing.seo.heavyHaul.description')
  const path = localePath(raw, 'heavy-haul')
  return {
    title,
    description,
    alternates: { canonical: path, languages: languageAlternates('heavy-haul') },
    openGraph: { title, description, url: absoluteUrl(path), locale: raw, type: 'website' },
  }
}

const TOPIC_KEYS = ['legalLimits', 'permitTriggers', 'escortTriggers', 'routeSurveys', 'stateVariation'] as const
const FAQ_KEYS = ['q1', 'q2', 'q3', 'q4'] as const

export default async function HeavyHaulPage({ params }: { params: Promise<{ locale: string }> }) {
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
          '@type': 'FAQPage',
          mainEntity: FAQ_KEYS.map((key) => ({
            '@type': 'Question',
            name: t(`marketing.heavyHaul.faq.${key}.question`),
            acceptedAnswer: { '@type': 'Answer', text: t(`marketing.heavyHaul.faq.${key}.answer`) },
          })),
        }}
      />
      <PageHero title={t('marketing.heavyHaul.hero.title')} subtitle={t('marketing.heavyHaul.hero.subtitle')} />
      <MarketingBreadcrumbs
        homeLabel={t('nav.breadcrumb.home')}
        locale={locale}
        items={[{ label: t('nav.public.heavyHaul') }]}
      />

      <Section>
        <div className="mx-auto flex max-w-3xl gap-3 rounded-lg border border-safety-500/40 bg-safety-50 p-5">
          <AlertTriangle className="mt-0.5 size-6 shrink-0 text-safety-600" aria-hidden="true" />
          <div>
            <h2 className="text-lg font-bold text-safety-800">{t('marketing.heavyHaul.disclaimer.title')}</h2>
            <p className="mt-2 text-sm text-safety-900">{t('marketing.heavyHaul.disclaimer.body')}</p>
          </div>
        </div>

        <div className="mx-auto mt-12 max-w-3xl space-y-10">
          {TOPIC_KEYS.map((key) => (
            <div key={key}>
              <h2 className="text-2xl font-bold tracking-tight">{t(`marketing.heavyHaul.${key}.title`)}</h2>
              <p className="mt-3 text-steel-700">{t(`marketing.heavyHaul.${key}.body`)}</p>
            </div>
          ))}
        </div>
      </Section>

      <Section tone="subtle">
        <SectionHeading title={t('marketing.heavyHaul.faq.heading')} align="center" className="mx-auto" />
        <div className="mx-auto mt-8 max-w-3xl">
          <Accordion type="single" collapsible>
            {FAQ_KEYS.map((key) => (
              <AccordionItem key={key} value={key}>
                <AccordionTrigger>{t(`marketing.heavyHaul.faq.${key}.question`)}</AccordionTrigger>
                <AccordionContent>{t(`marketing.heavyHaul.faq.${key}.answer`)}</AccordionContent>
              </AccordionItem>
            ))}
          </Accordion>
        </div>
      </Section>
    </>
  )
}
