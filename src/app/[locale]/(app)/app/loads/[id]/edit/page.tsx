import { notFound } from 'next/navigation'
import { isLocale } from '@/i18n/config'
import { getDictionary } from '@/i18n/dictionary'
import { createTranslator } from '@/i18n/translate'
import { loadFor } from '@/server/action'
import { requireActor } from '@/server/context'
import { tenantDb } from '@/db/tenant-db'
import { getLoadDetail, getLoadResourceContext } from '@/server/loads/queries'
import { listEquipmentTypes } from '@/server/equipment/queries'
import { PageHeader } from '@/components/shell/page-header'
import { LoadForm } from '../../_components/load-form'

export default async function EditLoadPage({
  params,
}: {
  params: Promise<{ locale: string; id: string }>
}) {
  const { locale, id } = await params
  if (!isLocale(locale)) notFound()

  const actorPreview = await requireActor()
  if (!actorPreview.tenantId) notFound()
  const resource = await getLoadResourceContext(tenantDb(actorPreview.tenantId), id, actorPreview)
  const ctx = await loadFor('load:update', resource)

  const dictionary = await getDictionary(locale, ['load', 'customer', 'common'])
  const t = createTranslator(dictionary, locale)

  const [detail, equipmentTypes] = await Promise.all([
    getLoadDetail(ctx.db, id),
    // Includes inactive types so a load whose equipment type has since been
    // retired still shows its currently assigned value in the select.
    listEquipmentTypes(ctx.db, undefined, true),
  ])

  return (
    <div className="space-y-6">
      <PageHeader title={t('load.edit.title', { number: detail.load.loadNumber })} />
      <LoadForm
        locale={locale}
        mode="edit"
        load={detail.load}
        initialCustomer={{ id: detail.customer.id, companyName: detail.customer.companyName }}
        equipmentTypes={equipmentTypes}
      />
    </div>
  )
}
