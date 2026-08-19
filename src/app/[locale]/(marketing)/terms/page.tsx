import type { Metadata } from 'next'
import { isLocale, type Locale } from '@/i18n/config'
import { getDictionary } from '@/i18n/dictionary'
import { createTranslator, formatDate } from '@/i18n/translate'
import { TERMS_LAST_UPDATED } from '@/server/marketing/content'
import { PageHero } from '../_components/page-hero'
import { Section } from '../_components/section'
import { MarketingBreadcrumbs } from '../_components/marketing-breadcrumbs'
import { LegalDocument } from '../_components/legal-document'
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
  const title = t('marketing.seo.terms.title')
  const description = t('marketing.seo.terms.description')
  const path = localePath(raw, 'terms')
  return {
    title,
    description,
    alternates: { canonical: path, languages: languageAlternates('terms') },
    openGraph: { title, description, url: absoluteUrl(path), locale: raw, type: 'website' },
  }
}

const SECTION_KEYS = [
  'acceptance',
  'description',
  'accountsEligibility',
  'carrierResponsibilities',
  'feesBilling',
  'prohibitedUses',
  'intellectualProperty',
  'disclaimers',
  'limitationOfLiability',
  'termination',
  'disputeResolutionGoverningLaw',
  'changesToTerms',
  'contactUs',
] as const

export default async function TermsPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale: raw } = await params
  if (!isLocale(raw)) return null
  const locale: Locale = raw
  const dictionary = await getDictionary(locale, ['marketing', 'nav'])
  const t = createTranslator(dictionary, locale)
  const lastUpdated = formatDate(TERMS_LAST_UPDATED, locale, 'UTC')

  return (
    <>
      <PageHero title={t('marketing.terms.hero.title')} />
      <MarketingBreadcrumbs homeLabel={t('nav.breadcrumb.home')} locale={locale} items={[{ label: t('nav.public.terms') }]} />
      <Section>
        <LegalDocument t={t} namespace="terms" sectionKeys={SECTION_KEYS} lastUpdated={lastUpdated} />
      </Section>
    </>
  )
}
