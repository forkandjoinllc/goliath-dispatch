import type { Metadata } from 'next'
import { isLocale, type Locale } from '@/i18n/config'
import { getDictionary } from '@/i18n/dictionary'
import { createTranslator, formatDate } from '@/i18n/translate'
import { PRIVACY_POLICY_LAST_UPDATED } from '@/server/marketing/content'
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
  const title = t('marketing.seo.privacy.title')
  const description = t('marketing.seo.privacy.description')
  const path = localePath(raw, 'privacy')
  return {
    title,
    description,
    alternates: { canonical: path, languages: languageAlternates('privacy') },
    openGraph: { title, description, url: absoluteUrl(path), locale: raw, type: 'website' },
  }
}

const SECTION_KEYS = [
  'intro',
  'dataWeCollect',
  'howWeUseData',
  'electronicSignatureConsent',
  'smsConsentAndStop',
  'trackingLocationDriverConsent',
  'retention',
  'subprocessors',
  'yourRights',
  'dataSecurity',
  'childrensPrivacy',
  'changesToPolicy',
  'contactUs',
] as const

export default async function PrivacyPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale: raw } = await params
  if (!isLocale(raw)) return null
  const locale: Locale = raw
  const dictionary = await getDictionary(locale, ['marketing', 'nav'])
  const t = createTranslator(dictionary, locale)
  const lastUpdated = formatDate(PRIVACY_POLICY_LAST_UPDATED, locale, 'UTC')

  return (
    <>
      <PageHero title={t('marketing.privacy.hero.title')} />
      <MarketingBreadcrumbs homeLabel={t('nav.breadcrumb.home')} locale={locale} items={[{ label: t('nav.public.privacy') }]} />
      <Section>
        <LegalDocument t={t} namespace="privacy" sectionKeys={SECTION_KEYS} lastUpdated={lastUpdated} />
      </Section>
    </>
  )
}
