import { MarketingLayout } from '@/layouts/MarketingLayout'
import { Cta, CtaBand } from '@/components/Marketing/Cta'
import { Section, SectionHeading } from '@/components/Marketing/Section'
import { useI18n } from '@/lib/i18n'
import type { MarketingPageProps } from '@/types/marketing'

const PROOF_POINTS = ['item1', 'item2', 'item3', 'item4'] as const
const STEPS = ['step1', 'step2', 'step3', 'step4', 'step5'] as const
const AUDIENCES = [
  { key: 'dispatchCompanies', route: 'services' },
  { key: 'carriers', route: 'carrier-signup' },
  { key: 'clients', route: 'for-clients' },
] as const

export default function Home(props: MarketingPageProps) {
  const { t, locale } = useI18n()
  const path = (route: string) => `/${locale}/${route}`

  return (
    <MarketingLayout {...props}>
      {/* Héroe */}
      <section className="relative overflow-hidden bg-navy-700">
        <div className="hazard-stripe absolute inset-x-0 top-0 h-1.5" aria-hidden="true" />
        <div className="mx-auto max-w-7xl px-4 py-20 sm:px-6 lg:px-8 lg:py-28">
          <div className="max-w-3xl">
            <p className="uppercase-heading text-xs text-safety-500">{t('marketing.home.hero.eyebrow')}</p>
            <h1 className="mt-4 font-display text-4xl font-bold tracking-tight text-white sm:text-5xl lg:text-6xl">
              {t('marketing.home.hero.title')}
            </h1>
            <p className="mt-6 max-w-2xl text-lg text-steel-100">{t('marketing.home.hero.subtitle')}</p>
            <div className="mt-10 flex flex-wrap gap-3">
              <Cta href="/signup">{t('marketing.home.hero.primaryCta')}</Cta>
              <Cta href={path('services')} variant="ghost">
                {t('marketing.home.hero.secondaryCta')}
              </Cta>
            </div>
          </div>
        </div>
      </section>

      {/* Por qué cambian */}
      <Section>
        <SectionHeading title={t('marketing.home.proofPoints.heading')} />
        <div className="mt-12 grid gap-8 sm:grid-cols-2">
          {PROOF_POINTS.map((item) => (
            <div key={item} className="border-l-2 border-safety-500 pl-6">
              <h3 className="font-display text-xl font-bold text-navy-700">
                {t(`marketing.home.proofPoints.${item}.title`)}
              </h3>
              <p className="mt-3 text-steel-700">{t(`marketing.home.proofPoints.${item}.body`)}</p>
            </div>
          ))}
        </div>
      </Section>

      {/* Sobredimensión */}
      <Section tone="tint">
        <div className="lg:flex lg:items-center lg:gap-12">
          <div className="lg:flex-1">
            <SectionHeading title={t('marketing.home.oversizeBand.title')} />
            <p className="mt-4 text-lg text-steel-700">{t('marketing.home.oversizeBand.body')}</p>
            <Cta href={path('heavy-haul')} variant="secondary" className="mt-8">
              {t('marketing.home.oversizeBand.cta')}
            </Cta>
          </div>
          <div className="mt-10 lg:mt-0 lg:w-80 lg:shrink-0">
            <div className="hazard-stripe h-40 rounded" role="img" aria-label={t('marketing.home.hero.illustrationAlt')} />
          </div>
        </div>
      </Section>

      {/* Cómo funciona */}
      <Section>
        <SectionHeading title={t('marketing.home.howItWorks.heading')} />
        <ol className="mt-12 grid gap-8 md:grid-cols-3 lg:grid-cols-5">
          {STEPS.map((step, index) => (
            <li key={step}>
              <span className="uppercase-heading flex size-9 items-center justify-center rounded-full bg-navy-700 text-sm text-white">
                {index + 1}
              </span>
              <h3 className="mt-4 font-display text-lg font-bold text-navy-700">
                {t(`marketing.home.howItWorks.${step}.title`)}
              </h3>
              <p className="mt-2 text-sm text-steel-700">{t(`marketing.home.howItWorks.${step}.body`)}</p>
            </li>
          ))}
        </ol>
      </Section>

      {/* Públicos */}
      <Section tone="tint">
        <SectionHeading title={t('marketing.home.audiences.heading')} />
        <div className="mt-12 grid gap-6 lg:grid-cols-3">
          {AUDIENCES.map(({ key, route }) => (
            <div key={key} className="flex flex-col rounded border border-steel-200 bg-white p-6">
              <h3 className="font-display text-xl font-bold text-navy-700">
                {t(`marketing.home.audiences.${key}.title`)}
              </h3>
              <p className="mt-3 grow text-steel-700">{t(`marketing.home.audiences.${key}.body`)}</p>
              <Cta href={path(route)} variant="ghost" className="mt-6 self-start">
                {t(`marketing.home.audiences.${key}.cta`)}
              </Cta>
            </div>
          ))}
        </div>
      </Section>

      <CtaBand
        title={t('marketing.home.closingCta.title')}
        body={t('marketing.home.closingCta.body')}
        // El texto manda sobre el hábito: primaryCta dice «Talk to us», así que
        // va a contacto; secondaryCta dice «Get started» y va al alta.
        primaryHref={path('contact')}
        primaryLabel={t('marketing.home.closingCta.primaryCta')}
        secondaryHref="/signup"
        secondaryLabel={t('marketing.home.closingCta.secondaryCta')}
      />
    </MarketingLayout>
  )
}
