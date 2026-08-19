import { notFound } from 'next/navigation'
import { isLocale } from '@/i18n/config'
import { getDictionary } from '@/i18n/dictionary'
import { createTranslator } from '@/i18n/translate'
import { loadFor } from '@/server/action'
import { getCustomer } from '@/server/customers/queries'
import { PageHeader } from '@/components/shell/page-header'
import { CustomerForm } from '../../_components/customer-form'

export default async function EditCustomerPage({
  params,
}: {
  params: Promise<{ locale: string; id: string }>
}) {
  const { locale, id } = await params
  if (!isLocale(locale)) notFound()

  const ctx = await loadFor('customer:update')
  const dictionary = await getDictionary(locale, ['customer', 'common'])
  const t = createTranslator(dictionary, locale)
  const customer = await getCustomer(ctx.db, id)

  return (
    <div className="space-y-6">
      <PageHeader title={t('customer.edit.title')} />
      <CustomerForm locale={locale} mode="edit" customer={customer} />
    </div>
  )
}
