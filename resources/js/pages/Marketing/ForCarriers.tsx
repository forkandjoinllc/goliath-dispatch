import { MarketingLayout } from '@/layouts/MarketingLayout'
import { PageHero } from '@/components/Marketing/PageHero'
import { Section, SectionHeading } from '@/components/Marketing/Section'
import { CtaBand } from '@/components/Marketing/Cta'
import { useI18n } from '@/lib/i18n'
import type { MarketingPageProps } from '@/types/marketing'

const DOCUMENTS = ['certificateOfAuthority', 'coi', 'w9', 'noticeOfAssignment'] as const

export default function ForCarriers(props: MarketingPageProps) {
  const { t, locale } = useI18n()

  return (
    <MarketingLayout {...props}>
      <PageHero title={t('marketing.forCarriers.hero.title')} subtitle={t('marketing.forCarriers.hero.subtitle')} />

      <Section>
        <SectionHeading title={t('marketing.forCarriers.onboarding.title')} />
        <div className="mt-10 grid gap-6 sm:grid-cols-2">
          {DOCUMENTS.map((doc) => (
            <div key={doc} className="rounded border border-steel-200 p-6">
              <h3 className="font-display text-lg font-bold text-navy-700">
                {t(`marketing.forCarriers.onboarding.${doc}.title`)}
              </h3>
              <p className="mt-2 text-sm text-steel-700">
                {t(`marketing.forCarriers.onboarding.${doc}.body`)}
              </p>
            </div>
          ))}
        </div>
      </Section>

      <Section tone="tint">
        <div className="grid gap-10 lg:grid-cols-2">
          {(['verification', 'settlements'] as const).map((block) => (
            <div key={block} className="border-l-2 border-safety-500 pl-6">
              <h2 className="font-display text-xl font-bold text-navy-700">
                {t(`marketing.forCarriers.${block}.title`)}
              </h2>
              <p className="mt-3 text-steel-700">{t(`marketing.forCarriers.${block}.body`)}</p>
            </div>
          ))}
        </div>
      </Section>

      <CtaBand
        title={t('marketing.forCarriers.cta.title')}
        body={t('marketing.forCarriers.cta.body')}
        primaryHref={`/${locale}/carrier-signup`}
        primaryLabel={t('marketing.forCarriers.cta.button')}
      />
    </MarketingLayout>
  )
}
