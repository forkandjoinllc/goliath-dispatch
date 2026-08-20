import { MarketingLayout } from '@/layouts/MarketingLayout'
import { PageHero } from '@/components/Marketing/PageHero'
import { Section, SectionHeading } from '@/components/Marketing/Section'
import { CtaBand } from '@/components/Marketing/Cta'
import { useI18n } from '@/lib/i18n'
import type { MarketingPageProps } from '@/types/marketing'

const TOPICS = ['legalLimits', 'permitTriggers', 'escortTriggers', 'routeSurveys', 'stateVariation'] as const
const FAQ = ['q1', 'q2', 'q3', 'q4'] as const

export default function HeavyHaul(props: MarketingPageProps) {
  const { t, locale } = useI18n()

  return (
    <MarketingLayout {...props}>
      <PageHero title={t('marketing.heavyHaul.hero.title')} subtitle={t('marketing.heavyHaul.hero.subtitle')} />

      <Section>
        <div className="grid gap-10 lg:grid-cols-2">
          {TOPICS.map((topic) => (
            <div key={topic} className="border-l-2 border-safety-500 pl-6">
              <h2 className="font-display text-xl font-bold text-navy-700">
                {t(`marketing.heavyHaul.${topic}.title`)}
              </h2>
              <p className="mt-3 text-steel-700">{t(`marketing.heavyHaul.${topic}.body`)}</p>
            </div>
          ))}
        </div>
      </Section>

      {/* El descargo NO es letra pequeña escondida en el pie: una evaluación de
          sobredimensión orienta, no sustituye al permiso. Va a tamaño de lectura
          y con el contraste de la marca. */}
      <Section tone="tint">
        <div className="rounded border-l-4 border-safety-500 bg-white p-6">
          <h2 className="uppercase-heading text-sm text-safety-600">
            {t('marketing.heavyHaul.disclaimer.title')}
          </h2>
          <p className="mt-3 text-steel-700">{t('marketing.heavyHaul.disclaimer.body')}</p>
        </div>
      </Section>

      <Section>
        <SectionHeading title={t('marketing.heavyHaul.faq.heading')} />
        <dl className="mt-10 flex flex-col gap-8">
          {FAQ.map((item) => (
            <div key={item}>
              <dt className="font-display text-lg font-bold text-navy-700">
                {t(`marketing.heavyHaul.faq.${item}.question`)}
              </dt>
              <dd className="mt-2 text-steel-700">{t(`marketing.heavyHaul.faq.${item}.answer`)}</dd>
            </div>
          ))}
        </dl>
      </Section>

      <CtaBand
        title={t('marketing.home.closingCta.title')}
        body={t('marketing.home.closingCta.body')}
        primaryHref={`/${locale}/contact`}
        primaryLabel={t('marketing.home.closingCta.primaryCta')}
      />
    </MarketingLayout>
  )
}
