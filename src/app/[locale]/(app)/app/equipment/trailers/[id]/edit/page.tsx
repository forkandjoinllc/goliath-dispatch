import { notFound } from 'next/navigation'
import { isLocale } from '@/i18n/config'
import { getDictionary } from '@/i18n/dictionary'
import { createTranslator } from '@/i18n/translate'
import { loadFor } from '@/server/action'
import { getTenantPolicy } from '@/server/context'
import { can, scopeFilter } from '@/lib/permissions'
import { listCarriers } from '@/server/carriers/queries'
import { listEquipmentTypes } from '@/server/equipment/queries'
import { trailers } from '@/db/schema'
import { PageHeader } from '@/components/shell/page-header'
import { EquipmentForm } from '../../../_components/equipment-form'

export default async function EditTrailerPage({
  params,
}: {
  params: Promise<{ locale: string; id: string }>
}) {
  const { locale, id } = await params
  if (!isLocale(locale)) notFound()

  const ctx = await loadFor('equipment:read')
  const dictionary = await getDictionary(locale, ['equipment', 'common'])
  const t = createTranslator(dictionary, locale)

  const trailer = await ctx.db.requireById(trailers, id, 'trailer')

  const policy = await getTenantPolicy(ctx.actor.tenantId)
  const carrierScope = scopeFilter(ctx.actor, can(ctx.actor, 'carrier:read', undefined, policy).scope ?? 'own')
  const [{ carriers }, types] = await Promise.all([
    listCarriers(ctx.db, carrierScope, { pagination: { page: 1, pageSize: 200 } }),
    listEquipmentTypes(ctx.db, 'trailer', true),
  ])

  return (
    <div className="space-y-6">
      <PageHeader
        title={t('equipment.trailers.edit')}
        description={t('equipment.trailers.detail', { unitNumber: trailer.unitNumber })}
      />
      <EquipmentForm
        locale={locale}
        equipmentType="trailer"
        mode="edit"
        equipmentId={trailer.id}
        carrierOptions={carriers.map((c) => ({ value: c.id, label: c.legalName }))}
        equipmentTypeOptions={types.map((ty) => ({ value: ty.id, label: ty.labelEn }))}
        defaultValues={{
          carrierId: trailer.carrierId,
          unitNumber: trailer.unitNumber,
          vin: trailer.vin,
          year: trailer.year != null ? String(trailer.year) : '',
          make: trailer.make ?? '',
          model: trailer.model ?? '',
          equipmentTypeId: trailer.equipmentTypeId ?? '',
          plateNumber: trailer.plateNumber ?? '',
          plateState: trailer.plateState ?? '',
          registrationNumber: trailer.registrationNumber ?? '',
          registrationExpiresAt: trailer.registrationExpiresAt,
          lastInspectionAt: trailer.lastInspectionAt,
          nextInspectionDueAt: trailer.nextInspectionDueAt,
          lastMaintenanceAt: trailer.lastMaintenanceAt,
          nextMaintenanceDueAt: trailer.nextMaintenanceDueAt,
          notes: trailer.notes ?? '',
          lengthInches: trailer.lengthInches != null ? String(trailer.lengthInches) : '',
          widthInches: trailer.widthInches != null ? String(trailer.widthInches) : '',
          deckHeightInches: trailer.deckHeightInches != null ? String(trailer.deckHeightInches) : '',
          wellLengthInches: trailer.wellLengthInches != null ? String(trailer.wellLengthInches) : '',
          capacityPounds: trailer.capacityPounds != null ? String(trailer.capacityPounds) : '',
          axleCount: trailer.axleCount != null ? String(trailer.axleCount) : '',
          axleConfiguration: trailer.axleConfiguration ?? '',
          removableGooseneck: trailer.removableGooseneck,
          isExtendable: trailer.isExtendable,
        }}
      />
    </div>
  )
}
