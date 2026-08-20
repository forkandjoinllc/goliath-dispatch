import { MarketingLayout } from '@/layouts/MarketingLayout'
import { PageHero } from '@/components/Marketing/PageHero'
import { Section } from '@/components/Marketing/Section'
import { CtaBand } from '@/components/Marketing/Cta'
import { useI18n } from '@/lib/i18n'
import type { MarketingPageProps } from '@/types/marketing'

export default function ForClients(props: MarketingPageProps) {
  const { t, locale } = useI18n()

  return (
    <MarketingLayout {...props}>
      <PageHero title={t('marketing.forClients.hero.title')} subtitle={t('marketing.forClients.hero.subtitle')} />

      <Section>
        <div className="grid gap-10 lg:grid-cols-2">
          <div className="border-l-2 border-safety-500 pl-6">
            <h2 className="font-display text-xl font-bold text-navy-700">
              {t('marketing.forClients.quoting.title')}
            </h2>
            <p className="mt-3 text-steel-700">{t('marketing.forClients.quoting.body')}</p>
          </div>

          <div className="border-l-2 border-safety-500 pl-6">
            <h2 className="font-display text-xl font-bold text-navy-700">
              {t('marketing.forClients.tracking.title')}
            </h2>
            <p className="mt-3 text-steel-700">{t('marketing.forClients.tracking.body')}</p>
            {/* «No es otra cuenta que gestionar» es una promesa concreta del
                producto, no relleno: el enlace público de seguimiento es un token
                con caducidad, no un login. */}
            <p className="mt-3 rounded bg-navy-50 p-3 text-sm text-navy-800">
              {t('marketing.forClients.tracking.accountNote')}
            </p>
          </div>
        </div>
      </Section>

      <CtaBand
        title={t('marketing.forClients.cta.title')}
        body={t('marketing.forClients.cta.body')}
        primaryHref={`/${locale}/contact`}
        primaryLabel={t('marketing.forClients.cta.button')}
      />
    </MarketingLayout>
  )
}
