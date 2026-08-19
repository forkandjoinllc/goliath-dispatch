import { notFound } from 'next/navigation'
import { isLocale } from '@/i18n/config'
import { getDictionary } from '@/i18n/dictionary'
import { createTranslator } from '@/i18n/translate'
import { loadFor } from '@/server/action'
import { can } from '@/lib/permissions'
import { getTenantPolicy } from '@/server/context'
import { getSettingsBundle } from '@/server/settings/queries'
import { PageHeader } from '@/components/shell/page-header'
import { ContactForm } from './_components/contact-form'

const DAY_KEYS = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'] as const

export default async function ContactSettingsPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params
  if (!isLocale(locale)) notFound()

  const ctx = await loadFor('tenant:settings:read')
  const dictionary = await getDictionary(locale, ['settings', 'common'])
  const t = createTranslator(dictionary, locale)
  const policy = await getTenantPolicy(ctx.actor.tenantId)
  const canUpdate = can(ctx.actor, 'tenant:settings:update', undefined, policy).allowed

  const { settings } = await getSettingsBundle(ctx.db)
  const businessHours =
    settings.businessHours ?? DAY_KEYS.map((_, day) => ({ day, open: '08:00', close: '17:00', closed: day === 0 || day === 6 }))

  return (
    <div className="space-y-6">
      <PageHeader title={t('settings.contact.title')} description={t('settings.contact.description')} />
      <ContactForm
        canUpdate={canUpdate}
        dayKeys={DAY_KEYS}
        defaultValues={{
          contactPhone: settings.contactPhone ?? '',
          contactEmail: settings.contactEmail ?? '',
          supportEmail: settings.supportEmail ?? '',
          addressLine1: settings.addressLine1 ?? '',
          addressLine2: settings.addressLine2 ?? '',
          addressCity: settings.addressCity ?? '',
          addressState: settings.addressState ?? '',
          addressPostalCode: settings.addressPostalCode ?? '',
          businessHours,
          socialLinksText: Object.entries(settings.socialLinks ?? {})
            .map(([k, v]) => `${k}=${v}`)
            .join('\n'),
        }}
      />
    </div>
  )
}
