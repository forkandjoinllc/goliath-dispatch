import { notFound } from 'next/navigation'
import { isLocale } from '@/i18n/config'
import { getDictionary } from '@/i18n/dictionary'
import { createTranslator } from '@/i18n/translate'
import { loadFor } from '@/server/action'
import { PageHeader } from '@/components/shell/page-header'
import { CarrierCreateForm } from '../_components/carrier-create-form'

export default async function NewCarrierPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params
  if (!isLocale(locale)) notFound()

  await loadFor('carrier:create')
  const dictionary = await getDictionary(locale, ['carrier', 'common'])
  const t = createTranslator(dictionary, locale)

  return (
    <div className="space-y-6">
      <PageHeader title={t('carrier.actions.create')} />
      <CarrierCreateForm locale={locale} />
    </div>
  )
}
