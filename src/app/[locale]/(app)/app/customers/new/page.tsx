import { notFound } from 'next/navigation'
import { isLocale } from '@/i18n/config'
import { getDictionary } from '@/i18n/dictionary'
import { createTranslator } from '@/i18n/translate'
import { loadFor } from '@/server/action'
import { PageHeader } from '@/components/shell/page-header'
import { CustomerForm } from '../_components/customer-form'

export default async function NewCustomerPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params
  if (!isLocale(locale)) notFound()

  await loadFor('customer:create')
  const dictionary = await getDictionary(locale, ['customer', 'common'])
  const t = createTranslator(dictionary, locale)

  return (
    <div className="space-y-6">
      <PageHeader title={t('customer.new.title')} />
      <CustomerForm locale={locale} mode="create" />
    </div>
  )
}
