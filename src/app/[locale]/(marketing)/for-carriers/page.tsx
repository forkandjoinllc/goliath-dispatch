import type { Metadata } from 'next'
import { FileCheck2, FileSignature, Receipt, ShieldCheck } from 'lucide-react'
import { isLocale, type Locale } from '@/i18n/config'
import { getDictionary } from '@/i18n/dictionary'
import { createTranslator } from '@/i18n/translate'
import { Card, CardContent } from '@/components/ui/card'
import { PageHero } from '../_components/page-hero'
import { Section } from '../_components/section'
import { MarketingBreadcrumbs } from '../_components/marketing-breadcrumbs'
import { CtaBand } from '../_components/cta-band'
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
  const title = t('marketing.seo.forCarriers.title')
  const description = t('marketing.seo.forCarriers.description')
  const path = localePath(raw, 'for-carriers')
  return {
    title,
    description,
    alternates: { canonical: path, languages: languageAlternates('for-carriers') },
    openGraph: { title, description, url: absoluteUrl(path), locale: raw, type: 'website' },
  }
}

const DOC_KEYS = [
  { key: 'certificateOfAuthority', Icon: ShieldCheck },
  { key: 'coi', Icon: FileCheck2 },
  { key: 'w9', Icon: FileSignature },
  { key: 'noticeOfAssignment', Icon: Receipt },
] as const

export default async function ForCarriersPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale: raw } = await params
  if (!isLocale(raw)) return null
  const locale: Locale = raw
  const dictionary = await getDictionary(locale, ['marketing', 'nav'])
  const t = createTranslator(dictionary, locale)

  return (
    <>
      <PageHero title={t('marketing.forCarriers.hero.title')} subtitle={t('marketing.forCarriers.hero.subtitle')} />
      <MarketingBreadcrumbs
        homeLabel={t('nav.breadcrumb.home')}
        locale={locale}
        items={[{ label: t('nav.public.forCarriers') }]}
      />

      <Section>
        <h2 className="text-2xl font-bold tracking-tight">{t('marketing.forCarriers.onboarding.title')}</h2>
        <div className="mt-8 grid gap-6 sm:grid-cols-2">
          {DOC_KEYS.map(({ key, Icon }) => (
            <Card key={key}>
              <CardContent className="flex gap-4 pt-6">
                <Icon className="size-7 shrink-0 text-safety-500" aria-hidden="true" />
                <div>
                  <h3 className="font-bold">{t(`marketing.forCarriers.onboarding.${key}.title`)}</h3>
                  <p className="mt-1 text-sm text-steel-600">{t(`marketing.forCarriers.onboarding.${key}.body`)}</p>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      </Section>

      <Section tone="subtle">
        <div className="mx-auto max-w-3xl">
          <h2 className="text-2xl font-bold tracking-tight">{t('marketing.forCarriers.verification.title')}</h2>
          <p className="mt-3 text-steel-700">{t('marketing.forCarriers.verification.body')}</p>
        </div>
      </Section>

      <Section>
        <div className="mx-auto max-w-3xl">
          <h2 className="text-2xl font-bold tracking-tight">{t('marketing.forCarriers.settlements.title')}</h2>
          <p className="mt-3 text-steel-700">{t('marketing.forCarriers.settlements.body')}</p>
        </div>
      </Section>

      <CtaBand
        title={t('marketing.forCarriers.cta.title')}
        body={t('marketing.forCarriers.cta.body')}
        primaryCta={t('marketing.forCarriers.cta.button')}
        primaryHref={localePath(locale, 'carrier-signup')}
      />
    </>
  )
}
