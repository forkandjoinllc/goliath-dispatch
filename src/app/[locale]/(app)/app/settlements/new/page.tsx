import { notFound } from 'next/navigation'
import { isLocale } from '@/i18n/config'
import { getDictionary } from '@/i18n/dictionary'
import { createTranslator } from '@/i18n/translate'
import { loadFor } from '@/server/action'
import { listFactoringCompanies } from '@/server/factoring/queries'
import { PageHeader } from '@/components/shell/page-header'
import { GenerateSettlementForm } from '../_components/generate-settlement-form'

export default async function NewSettlementPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params
  if (!isLocale(locale)) notFound()

  const ctx = await loadFor('settlement:manage')
  const dictionary = await getDictionary(locale, ['finance', 'common'])
  const t = createTranslator(dictionary, locale)

  const factoringCompanies = await listFactoringCompanies(ctx.db, { activeOnly: true })

  return (
    <div className="space-y-6">
      <PageHeader title={t('finance.settlement.generate.title')} />
      <GenerateSettlementForm locale={locale} factoringCompanies={factoringCompanies} />
    </div>
  )
}
