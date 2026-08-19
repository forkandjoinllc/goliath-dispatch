import type { Metadata } from 'next'
import { Clock, Mail, MapPin, Phone } from 'lucide-react'
import { isLocale, type Locale } from '@/i18n/config'
import { getDictionary } from '@/i18n/dictionary'
import { createTranslator } from '@/i18n/translate'
import { Card, CardContent } from '@/components/ui/card'
import { formatPhone } from '@/lib/utils'
import { resolveMarketingContactBlock } from '@/server/marketing/queries'
import { PageHero } from '../_components/page-hero'
import { Section } from '../_components/section'
import { MarketingBreadcrumbs } from '../_components/marketing-breadcrumbs'
import { LeadForm } from '../_components/lead-form'
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
  const title = t('marketing.seo.contact.title')
  const description = t('marketing.seo.contact.description')
  const path = localePath(raw, 'contact')
  return {
    title,
    description,
    alternates: { canonical: path, languages: languageAlternates('contact') },
    openGraph: { title, description, url: absoluteUrl(path), locale: raw, type: 'website' },
  }
}

const DAY_ORDER = [1, 2, 3, 4, 5, 6, 0] as const

export default async function ContactPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale: raw } = await params
  if (!isLocale(raw)) return null
  const locale: Locale = raw
  const dictionary = await getDictionary(locale, ['marketing', 'nav', 'errors', 'validation'])
  const t = createTranslator(dictionary, locale)
  const contact = await resolveMarketingContactBlock(null)

  return (
    <>
      <PageHero title={t('marketing.contact.hero.title')} subtitle={t('marketing.contact.hero.subtitle')} />
      <MarketingBreadcrumbs homeLabel={t('nav.breadcrumb.home')} locale={locale} items={[{ label: t('nav.public.contact') }]} />

      <Section>
        <div className="grid gap-10 lg:grid-cols-3">
          <div className="lg:col-span-2">
            <h2 className="text-2xl font-bold tracking-tight">{t('marketing.contact.formHeading')}</h2>
            <div className="mt-6">
              <LeadForm />
            </div>
          </div>

          <div className="space-y-6">
            <Card>
              <CardContent className="space-y-4 pt-6">
                <div className="flex gap-3">
                  <Phone className="size-5 shrink-0 text-navy-700" aria-hidden="true" />
                  <a href={`tel:${contact.phone.replace(/[^\d+]/g, '')}`} className="text-sm font-medium hover:underline">
                    {formatPhone(contact.phone)}
                  </a>
                </div>
                <div className="flex gap-3">
                  <Mail className="size-5 shrink-0 text-navy-700" aria-hidden="true" />
                  <a href={`mailto:${contact.email}`} className="text-sm font-medium hover:underline">
                    {contact.email}
                  </a>
                </div>
                <div className="flex gap-3">
                  <MapPin className="size-5 shrink-0 text-navy-700" aria-hidden="true" />
                  <address className="text-sm not-italic text-steel-700">
                    {contact.addressLine1}
                    {contact.addressLine2 ? `, ${contact.addressLine2}` : ''}
                    <br />
                    {contact.city}, {contact.state} {contact.postalCode}
                  </address>
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardContent className="pt-6">
                <div className="mb-3 flex items-center gap-2">
                  <Clock className="size-5 text-navy-700" aria-hidden="true" />
                  <h2 className="text-sm font-bold uppercase tracking-wide text-carbon">{t('marketing.contact.hoursHeading')}</h2>
                </div>
                <ul className="space-y-1 text-sm text-steel-700">
                  {DAY_ORDER.map((day) => {
                    const entry = contact.businessHours.find((h) => h.day === day)
                    return (
                      <li key={day} className="flex justify-between gap-4">
                        <span>{t(`marketing.footer.hours.${day}`)}</span>
                        <span>{!entry || entry.closed ? t('marketing.footer.hours.closed') : `${entry.open} – ${entry.close}`}</span>
                      </li>
                    )
                  })}
                </ul>
              </CardContent>
            </Card>

            <div
              role="img"
              aria-label={t('marketing.contact.mapPlaceholderAlt')}
              className="flex h-48 flex-col items-center justify-center gap-2 rounded-lg border border-dashed border-steel-300 bg-steel-50 text-center text-sm text-steel-500"
            >
              <MapPin className="size-6" aria-hidden="true" />
              <span>{t('marketing.contact.mapPlaceholderLabel')}</span>
            </div>
          </div>
        </div>
      </Section>
    </>
  )
}
