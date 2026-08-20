import { MarketingLayout } from '@/layouts/MarketingLayout'
import { LeadForm } from '@/components/Marketing/LeadForm'
import { PageHero } from '@/components/Marketing/PageHero'
import { Section } from '@/components/Marketing/Section'
import { useI18n } from '@/lib/i18n'
import type { MarketingPageProps } from '@/types/marketing'

export default function Contact({ formToken, ...props }: MarketingPageProps & { formToken: string }) {
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
              {/* Los horarios y la dirección salen de tenant_settings cuando el
                  sitio se sirve bajo el dominio de una empresa. En el sitio de
                  la plataforma no hay ninguno que mostrar, y se dice en vez de
                  inventar una dirección. */}
              <p className="mt-3 text-sm text-steel-700">{t('marketing.contact.mapPlaceholderLabel')}</p>
            </div>

            <div>
              <h2 className="uppercase-heading text-xs text-steel-600">
                {t('marketing.contact.addressHeading')}
              </h2>
              <div
                className="mt-3 flex h-40 items-center justify-center rounded border border-dashed border-steel-300 text-center text-xs text-steel-600"
                role="img"
                aria-label={t('marketing.contact.mapPlaceholderAlt')}
              >
                {t('marketing.contact.mapPlaceholderLabel')}
              </div>
            </div>
          </aside>
        </div>
      </Section>
    </MarketingLayout>
  )
}
