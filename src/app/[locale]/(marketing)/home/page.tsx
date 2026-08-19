import type { Metadata } from 'next'
import Link from 'next/link'
import { CheckCircle2, ClipboardCheck, FileCheck2, Handshake, MapPinned, Truck } from 'lucide-react'
import { isLocale, type Locale } from '@/i18n/config'
import { getDictionary } from '@/i18n/dictionary'
import { createTranslator } from '@/i18n/translate'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Section, SectionHeading } from '../_components/section'
import { CtaBand } from '../_components/cta-band'
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
  const title = t('marketing.seo.home.title')
  const description = t('marketing.seo.home.description')
  const path = localePath(raw, 'home')
  return {
    title,
    description,
    alternates: { canonical: path, languages: languageAlternates('home') },
    openGraph: {
      title,
      description,
      url: absoluteUrl(path),
      images: [{ url: absoluteUrl(`/og/default-${raw}.svg`), width: 1200, height: 630 }],
      locale: raw,
      type: 'website',
    },
    twitter: { card: 'summary_large_image', title, description, images: [absoluteUrl(`/og/default-${raw}.svg`)] },
  }
}

const PROOF_ICONS = [Truck, FileCheck2, ClipboardCheck, Handshake]

export default async function HomePage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale: raw } = await params
  if (!isLocale(raw)) return null
  const locale: Locale = raw
  const dictionary = await getDictionary(locale, ['marketing', 'nav', 'common'])
  const t = createTranslator(dictionary, locale)

  const proofItems = [1, 2, 3, 4].map((n) => ({
    Icon: PROOF_ICONS[n - 1],
    title: t(`marketing.home.proofPoints.item${n}.title`),
    body: t(`marketing.home.proofPoints.item${n}.body`),
  }))

  const steps = [1, 2, 3, 4, 5].map((n) => ({
    title: t(`marketing.home.howItWorks.step${n}.title`),
    body: t(`marketing.home.howItWorks.step${n}.body`),
  }))

  return (
    <>
      <JsonLd
        data={{
          '@context': 'https://schema.org',
          '@type': 'Organization',
          name: 'Goliath Dispatch',
          url: absoluteUrl(localePath(locale, 'home')),
          logo: absoluteUrl('/brand/logo-full.svg'),
          description: t('marketing.meta.description'),
          sameAs: ['https://www.linkedin.com/company/goliath-dispatch'],
        }}
      />

      {/* Hero */}
      <div className="relative overflow-hidden bg-navy-800 text-white">
        <div className="mx-auto grid max-w-7xl gap-10 px-4 py-16 sm:px-6 md:grid-cols-2 md:items-center md:py-24 lg:px-8">
          <div>
            <p className="text-sm font-bold uppercase tracking-wide text-safety-400">{t('marketing.home.hero.eyebrow')}</p>
            <h1 className="mt-3 text-4xl font-bold tracking-tight sm:text-5xl">{t('marketing.home.hero.title')}</h1>
            <p className="mt-5 max-w-xl text-lg text-navy-100">{t('marketing.home.hero.subtitle')}</p>
            <div className="mt-8 flex flex-wrap gap-3">
              <Button asChild variant="accent" size="lg">
                <Link href={`/${locale}/signup`}>{t('marketing.home.hero.primaryCta')}</Link>
              </Button>
              <Button asChild variant="secondary" size="lg" className="border-white/40 bg-transparent text-white hover:bg-white/10">
                <Link href={localePath(locale, 'services')}>{t('marketing.home.hero.secondaryCta')}</Link>
              </Button>
            </div>
          </div>
          <div>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src="/illustrations/flatbed-oversize.svg"
              alt={t('marketing.home.hero.illustrationAlt')}
              className="w-full rounded-xl shadow-[var(--shadow-overlay)]"
            />
          </div>
        </div>
      </div>

      {/* Proof points */}
      <Section>
        <SectionHeading title={t('marketing.home.proofPoints.heading')} as="h2" />
        <div className="mt-10 grid gap-6 sm:grid-cols-2 lg:grid-cols-4">
          {proofItems.map(({ Icon, title, body }) => (
            <Card key={title}>
              <CardContent className="pt-6">
                <Icon className="size-8 text-safety-500" aria-hidden="true" />
                <h3 className="mt-4 text-lg font-bold">{title}</h3>
                <p className="mt-2 text-sm text-steel-600">{body}</p>
              </CardContent>
            </Card>
          ))}
        </div>
      </Section>

      {/* Oversize band */}
      <Section tone="subtle">
        <div className="grid gap-10 md:grid-cols-2 md:items-center">
          <div>
            <SectionHeading title={t('marketing.home.oversizeBand.title')} subtitle={t('marketing.home.oversizeBand.body')} />
            <Button asChild variant="primary" size="lg" className="mt-6">
              <Link href={localePath(locale, 'heavy-haul')}>{t('marketing.home.oversizeBand.cta')}</Link>
            </Button>
          </div>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/illustrations/route-map.svg" alt={t('marketing.illustrations.routeMapAlt')} className="w-full rounded-xl border border-steel-200" />
        </div>
      </Section>

      {/* How it works */}
      <Section>
        <SectionHeading title={t('marketing.home.howItWorks.heading')} align="center" className="mx-auto" />
        <ol className="mt-12 grid gap-8 sm:grid-cols-2 lg:grid-cols-5">
          {steps.map((step, index) => (
            <li key={step.title} className="relative">
              <div className="flex size-10 items-center justify-center rounded-full bg-navy-700 text-sm font-bold text-white">
                {index + 1}
              </div>
              <h3 className="mt-4 text-base font-bold">{step.title}</h3>
              <p className="mt-2 text-sm text-steel-600">{step.body}</p>
            </li>
          ))}
        </ol>
      </Section>

      {/* Audiences */}
      <Section tone="subtle">
        <SectionHeading title={t('marketing.home.audiences.heading')} align="center" className="mx-auto" />
        <div className="mt-12 grid gap-6 md:grid-cols-3">
          {(
            [
              { key: 'dispatchCompanies', href: localePath(locale, 'services'), Icon: ClipboardCheck },
              { key: 'carriers', href: localePath(locale, 'carrier-signup'), Icon: MapPinned },
              { key: 'clients', href: localePath(locale, 'for-clients'), Icon: CheckCircle2 },
            ] as const
          ).map(({ key, href, Icon }) => (
            <Card key={key} className="flex flex-col">
              <CardContent className="flex flex-1 flex-col pt-6">
                <Icon className="size-8 text-navy-700" aria-hidden="true" />
                <h3 className="mt-4 text-xl font-bold">{t(`marketing.home.audiences.${key}.title`)}</h3>
                <p className="mt-2 flex-1 text-sm text-steel-600">{t(`marketing.home.audiences.${key}.body`)}</p>
                <Button asChild variant="link" className="mt-4 justify-start">
                  <Link href={href}>{t(`marketing.home.audiences.${key}.cta`)}</Link>
                </Button>
              </CardContent>
            </Card>
          ))}
        </div>
      </Section>

      <CtaBand
        title={t('marketing.home.closingCta.title')}
        body={t('marketing.home.closingCta.body')}
        primaryCta={t('marketing.home.closingCta.primaryCta')}
        primaryHref={localePath(locale, 'contact')}
        secondaryCta={t('marketing.home.closingCta.secondaryCta')}
        secondaryHref={`/${locale}/signup`}
      />
    </>
  )
}
