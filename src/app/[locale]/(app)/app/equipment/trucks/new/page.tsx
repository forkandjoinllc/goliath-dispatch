import { notFound } from 'next/navigation'
import { isLocale } from '@/i18n/config'
import { getDictionary } from '@/i18n/dictionary'
import { createTranslator } from '@/i18n/translate'
import { loadFor } from '@/server/action'
import { getTenantPolicy } from '@/server/context'
import { can, scopeFilter } from '@/lib/permissions'
import { listCarriers } from '@/server/carriers/queries'
import { listEquipmentTypes } from '@/server/equipment/queries'
import { PageHeader } from '@/components/shell/page-header'
import { EquipmentForm } from '../../_components/equipment-form'

export default async function NewTruckPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params
  if (!isLocale(locale)) notFound()

  const ctx = await loadFor('equipment:create')
  const dictionary = await getDictionary(locale, ['equipment', 'common'])
  const t = createTranslator(dictionary, locale)

  const policy = await getTenantPolicy(ctx.actor.tenantId)
  const carrierScope = scopeFilter(ctx.actor, can(ctx.actor, 'carrier:read', undefined, policy).scope ?? 'own')
  const [{ carriers }, types] = await Promise.all([
    listCarriers(ctx.db, carrierScope, { pagination: { page: 1, pageSize: 200 } }),
    listEquipmentTypes(ctx.db, 'truck'),
  ])

  return (
    <div className="space-y-6">
      <PageHeader title={t('equipment.trucks.new')} />
      <EquipmentForm
        locale={locale}
        equipmentType="truck"
        mode="create"
        carrierOptions={carriers.map((c) => ({ value: c.id, label: c.legalName }))}
        equipmentTypeOptions={types.map((ty) => ({ value: ty.id, label: ty.labelEn }))}
      />
    </div>
  )
}
