import { MarketingLayout } from '@/layouts/MarketingLayout'
import { FeatureBlock } from '@/components/Marketing/FeatureBlock'
import { PageHero } from '@/components/Marketing/PageHero'
import { Section } from '@/components/Marketing/Section'
import { CtaBand } from '@/components/Marketing/Cta'
import { useI18n } from '@/lib/i18n'
import type { MarketingPageProps } from '@/types/marketing'

const BLOCKS = [
  'dispatch',
  'onboardingCompliance',
  'documentManagement',
  'invoicingSettlements',
  'tracking',
  'permitsEscorts',
] as const

export default function Services(props: MarketingPageProps) {
  const { t, locale } = useI18n()

  return (
    <MarketingLayout {...props}>
      <PageHero title={t('marketing.services.hero.title')} subtitle={t('marketing.services.hero.subtitle')} />

      <Section>
        <div className="grid gap-12 lg:grid-cols-2">
          {BLOCKS.map((block) => (
            <FeatureBlock key={block} root={`marketing.services.${block}`} />
          ))}
        </div>
      </Section>

      <CtaBand
        title={t('marketing.home.closingCta.title')}
        body={t('marketing.home.closingCta.body')}
        primaryHref={`/${locale}/contact`}
        primaryLabel={t('marketing.home.closingCta.primaryCta')}
        secondaryHref="/signup"
        secondaryLabel={t('marketing.home.closingCta.secondaryCta')}
      />
    </MarketingLayout>
  )
}
