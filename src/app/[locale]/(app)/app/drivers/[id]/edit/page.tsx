import { notFound } from 'next/navigation'
import { isLocale } from '@/i18n/config'
import { getDictionary } from '@/i18n/dictionary'
import { createTranslator } from '@/i18n/translate'
import { loadFor } from '@/server/action'
import { requireActor } from '@/server/context'
import { tenantDb } from '@/db/tenant-db'
import { drivers } from '@/db/schema'
import { maskLast4 } from '@/lib/crypto'
import { PageHeader } from '@/components/shell/page-header'
import { DriverForm } from '../../_components/driver-form'

export default async function EditDriverPage({
  params,
}: {
  params: Promise<{ locale: string; id: string }>
}) {
  const { locale, id } = await params
  if (!isLocale(locale)) notFound()

  const actorPreview = await requireActor()
  if (!actorPreview.tenantId) notFound()
  const driver = await tenantDb(actorPreview.tenantId).requireById(drivers, id, 'driver')
  await loadFor('driver:update', { tenantId: actorPreview.tenantId, driverId: id, ownerUserId: driver.userId ?? undefined })

  const dictionary = await getDictionary(locale, ['driver', 'common'])
  const t = createTranslator(dictionary, locale)

  return (
    <div className="space-y-6">
      <PageHeader title={t('driver.detail.edit')} description={t('driver.detail.title', { name: `${driver.firstName} ${driver.lastName}` })} />
      <DriverForm
        locale={locale}
        mode="edit"
        driverId={driver.id}
        licenseNumberMaskedDisplay={driver.licenseNumberLast4 ? maskLast4(driver.licenseNumberLast4) : undefined}
        defaultValues={{
          firstName: driver.firstName,
          lastName: driver.lastName,
          dateOfBirth: driver.dateOfBirth ?? '',
          email: driver.email ?? '',
          phone: driver.phone ?? '',
          preferredLocale: driver.preferredLocale,
          licenseState: driver.licenseState ?? '',
          licenseNumber: undefined,
          cdlClass: driver.cdlClass ?? '',
          endorsements: driver.endorsements,
          restrictions: driver.restrictions,
          licenseExpiresAt: driver.licenseExpiresAt,
          medicalCardExpiresAt: driver.medicalCardExpiresAt,
          notes: driver.notes ?? '',
        }}
      />
    </div>
  )
}
