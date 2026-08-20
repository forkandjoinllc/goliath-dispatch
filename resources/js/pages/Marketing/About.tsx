import { MarketingLayout } from '@/layouts/MarketingLayout'
import { PageHero } from '@/components/Marketing/PageHero'
import { Section, SectionHeading } from '@/components/Marketing/Section'
import { CtaBand } from '@/components/Marketing/Cta'
import { useI18n } from '@/lib/i18n'
import type { MarketingPageProps } from '@/types/marketing'

const VALUES = ['operationalHonesty', 'bilingualByDefault', 'auditableFinancials'] as const

export default function About(props: MarketingPageProps) {
  const { t, locale } = useI18n()

  return (
    <MarketingLayout {...props}>
      <PageHero title={t('marketing.about.hero.title')} subtitle={t('marketing.about.hero.subtitle')} />

      <Section>
        <SectionHeading title={t('marketing.about.story.title')} />
        <p className="mt-6 max-w-3xl whitespace-pre-line text-lg text-steel-700">
          {t('marketing.about.story.body')}
        </p>
      </Section>

      <Section tone="tint">
        <SectionHeading title={t('marketing.about.values.heading')} />
        <div className="mt-10 grid gap-6 lg:grid-cols-3">
          {VALUES.map((value) => (
            <div key={value} className="rounded border border-steel-200 bg-white p-6">
              <h3 className="font-display text-lg font-bold text-navy-700">
                {t(`marketing.about.values.${value}.title`)}
              </h3>
              <p className="mt-3 text-steel-700">{t(`marketing.about.values.${value}.body`)}</p>
            </div>
          ))}
        </div>
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
