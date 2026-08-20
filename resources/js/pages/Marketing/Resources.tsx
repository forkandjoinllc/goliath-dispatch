import { MarketingLayout } from '@/layouts/MarketingLayout'
import { PageHero } from '@/components/Marketing/PageHero'
import { Section } from '@/components/Marketing/Section'
import { useI18n } from '@/lib/i18n'
import type { MarketingPageProps } from '@/types/marketing'

export default function Resources(props: MarketingPageProps) {
  const { t } = useI18n()

  return (
    <MarketingLayout {...props}>
      <PageHero title={t('marketing.resources.hero.title')} subtitle={t('marketing.resources.hero.subtitle')} />

      {/* Estado vacío honesto: la sección existe y todavía no hay artículos.
          Es mejor decirlo que rellenarla con enlaces de adorno. */}
      <Section>
        <div className="mx-auto max-w-xl rounded border border-dashed border-steel-300 p-10 text-center">
          <h2 className="font-display text-xl font-bold text-navy-700">
            {t('marketing.resources.emptyState.title')}
          </h2>
          <p className="mt-3 text-steel-700">{t('marketing.resources.emptyState.body')}</p>
        </div>
      </Section>
    </MarketingLayout>
  )
}
