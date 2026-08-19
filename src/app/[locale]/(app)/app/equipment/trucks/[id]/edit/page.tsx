import { notFound } from 'next/navigation'
import { isLocale } from '@/i18n/config'
import { getDictionary } from '@/i18n/dictionary'
import { createTranslator } from '@/i18n/translate'
import { loadFor } from '@/server/action'
import { getTenantPolicy } from '@/server/context'
import { can, scopeFilter } from '@/lib/permissions'
import { listCarriers } from '@/server/carriers/queries'
import { listEquipmentTypes } from '@/server/equipment/queries'
import { trucks } from '@/db/schema'
import { PageHeader } from '@/components/shell/page-header'
import { EquipmentForm } from '../../../_components/equipment-form'

export default async function EditTruckPage({
  params,
}: {
  params: Promise<{ locale: string; id: string }>
}) {
  const { locale, id } = await params
  if (!isLocale(locale)) notFound()

  const ctx = await loadFor('equipment:read')
  const dictionary = await getDictionary(locale, ['equipment', 'common'])
  const t = createTranslator(dictionary, locale)

  const truck = await ctx.db.requireById(trucks, id, 'truck')

  const policy = await getTenantPolicy(ctx.actor.tenantId)
  const carrierScope = scopeFilter(ctx.actor, can(ctx.actor, 'carrier:read', undefined, policy).scope ?? 'own')
  const [{ carriers }, types] = await Promise.all([
    listCarriers(ctx.db, carrierScope, { pagination: { page: 1, pageSize: 200 } }),
    listEquipmentTypes(ctx.db, 'truck', true),
  ])

  return (
    <div className="space-y-6">
      <PageHeader title={t('equipment.trucks.edit')} description={t('equipment.trucks.detail', { unitNumber: truck.unitNumber })} />
      <EquipmentForm
        locale={locale}
        equipmentType="truck"
        mode="edit"
        equipmentId={truck.id}
        carrierOptions={carriers.map((c) => ({ value: c.id, label: c.legalName }))}
        equipmentTypeOptions={types.map((ty) => ({ value: ty.id, label: ty.labelEn }))}
        defaultValues={{
          carrierId: truck.carrierId,
          unitNumber: truck.unitNumber,
          vin: truck.vin,
          year: truck.year != null ? String(truck.year) : '',
          make: truck.make ?? '',
          model: truck.model ?? '',
          equipmentTypeId: truck.equipmentTypeId ?? '',
          plateNumber: truck.plateNumber ?? '',
          plateState: truck.plateState ?? '',
          registrationNumber: truck.registrationNumber ?? '',
          registrationExpiresAt: truck.registrationExpiresAt,
          lastInspectionAt: truck.lastInspectionAt,
          nextInspectionDueAt: truck.nextInspectionDueAt,
          lastMaintenanceAt: truck.lastMaintenanceAt,
          nextMaintenanceDueAt: truck.nextMaintenanceDueAt,
          notes: truck.notes ?? '',
        }}
      />
    </div>
  )
}
