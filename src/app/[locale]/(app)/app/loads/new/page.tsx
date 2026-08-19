import { notFound } from 'next/navigation'
import { isLocale } from '@/i18n/config'
import { getDictionary } from '@/i18n/dictionary'
import { createTranslator } from '@/i18n/translate'
import { loadFor } from '@/server/action'
import { listEquipmentTypes } from '@/server/equipment/queries'
import { PageHeader } from '@/components/shell/page-header'
import { LoadForm } from '../_components/load-form'

export default async function NewLoadPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params
  if (!isLocale(locale)) notFound()

  const ctx = await loadFor('load:create')
  const dictionary = await getDictionary(locale, ['load', 'customer', 'common'])
  const t = createTranslator(dictionary, locale)

  const equipmentTypes = await listEquipmentTypes(ctx.db)

  return (
    <div className="space-y-6">
      <PageHeader title={t('load.new.title')} />
      <LoadForm locale={locale} mode="create" equipmentTypes={equipmentTypes} />
    </div>
  )
}
