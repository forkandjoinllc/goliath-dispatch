import { notFound } from 'next/navigation'
import { isLocale } from '@/i18n/config'
import { getDictionary } from '@/i18n/dictionary'
import { createTranslator } from '@/i18n/translate'
import { loadFor } from '@/server/action'
import { PageHeader } from '@/components/shell/page-header'
import { DriverForm } from '../_components/driver-form'

export default async function NewDriverPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params
  if (!isLocale(locale)) notFound()

  await loadFor('driver:create')
  const dictionary = await getDictionary(locale, ['driver', 'common'])
  const t = createTranslator(dictionary, locale)

  return (
    <div className="space-y-6">
      <PageHeader title={t('driver.list.new')} />
      <DriverForm locale={locale} mode="create" />
    </div>
  )
}
