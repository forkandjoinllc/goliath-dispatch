import { notFound } from 'next/navigation'
import { isLocale } from '@/i18n/config'
import { getDictionary } from '@/i18n/dictionary'
import { createTranslator } from '@/i18n/translate'
import { loadFor } from '@/server/action'
import { getTenantPolicy } from '@/server/context'
import { can } from '@/lib/permissions'
import { listEquipmentTypes } from '@/server/equipment/queries'
import { PageHeader } from '@/components/shell/page-header'
import { PermissionDenied } from '@/components/ui/feedback'
import { EquipmentTypesManager } from '../_components/equipment-types-manager'

export default async function EquipmentTypesPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params
  if (!isLocale(locale)) notFound()

  const ctx = await loadFor('equipment:read')
  const dictionary = await getDictionary(locale, ['equipment', 'common'])
  const t = createTranslator(dictionary, locale)

  const policy = await getTenantPolicy(ctx.actor.tenantId)
  const canManage = can(ctx.actor, 'equipment:type:manage', undefined, policy).allowed

  return (
    <div className="space-y-6">
      <PageHeader title={t('equipment.types.title')} description={t('equipment.types.description')} />
      {canManage ? (
        <EquipmentTypesManager types={await listEquipmentTypes(ctx.db, undefined, true)} />
      ) : (
        <PermissionDenied title={t('common.states.permissionDenied')} description={t('common.states.permissionDeniedHint')} />
      )}
    </div>
  )
}
