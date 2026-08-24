import { MarketingLayout } from '@/layouts/MarketingLayout'
import { AddressBlock } from '@/components/Marketing/AddressBlock'
import { LeadForm } from '@/components/Marketing/LeadForm'
import { OfficeMap } from '@/components/Marketing/OfficeMap'
import { PageHero } from '@/components/Marketing/PageHero'
import { Section } from '@/components/Marketing/Section'
import { useI18n } from '@/lib/i18n'
import type { CompanyContact, MarketingPageProps } from '@/types/marketing'

export default function Contact({
  formToken,
  company,
  ...props
}: MarketingPageProps & { formToken: string; company: CompanyContact | null }) {
  const { t, locale } = useI18n()

  return (
    <MarketingLayout {...props}>
      <PageHero title={t('marketing.contact.hero.title')} subtitle={t('marketing.contact.hero.subtitle')} />

      <Section>
        <div className="grid gap-12 lg:grid-cols-[minmax(0,1fr)_20rem]">
          <div>
            <h2 className="font-display text-2xl font-bold text-navy-700">
              {t('marketing.contact.formHeading')}
            </h2>
            <div className="mt-8">
              <LeadForm token={formToken} locale={locale} />
            </div>
          </div>

          <aside className="flex flex-col gap-8">
            <div>
              <h2 className="uppercase-heading text-xs text-steel-600">
                {t('marketing.contact.hoursHeading')}
              </h2>
              {/* 24/7 para la plataforma: un camión que se avería a las tres de
                  la mañana no espera a que abra la oficina. Para una empresa
                  cliente el horario vive en tenant_settings.business_hours, que
                  es una tabla por días y todavía no tiene pantalla — hasta
                  entonces se dice que no se publica en vez de inventarlo. */}
              <p className="mt-3 text-sm text-steel-700">
                {t(company?.hours247 ? 'marketing.company.hours247' : 'marketing.company.hoursNotPublished')}
              </p>
            </div>

            <div>
              <h2 className="uppercase-heading text-xs text-steel-600">
                {t('marketing.contact.addressHeading')}
              </h2>
              <div className="mt-3">
                <AddressBlock />
              </div>

              <div className="mt-4">
                <OfficeMap />
              </div>
            </div>
          </aside>
        </div>
      </Section>
    </MarketingLayout>
  )
}
