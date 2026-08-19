import { notFound } from 'next/navigation'
import { inArray } from 'drizzle-orm'
import { isLocale } from '@/i18n/config'
import { getDictionary } from '@/i18n/dictionary'
import { createTranslator } from '@/i18n/translate'
import { loadFor } from '@/server/action'
import { carriers, loads } from '@/db/schema'
import { listExpenseCategories, listPendingExpenseApprovals } from '@/server/finance/expenses'
import { PageHeader } from '@/components/shell/page-header'
import { ExpenseApprovalQueue } from '../_components/expense-approval-queue'

export default async function ExpenseApprovalsPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>
  searchParams: Promise<{ page?: string; pageSize?: string }>
}) {
  const { locale } = await params
  if (!isLocale(locale)) notFound()
  const query = await searchParams

  const ctx = await loadFor('expense:approve')
  const dictionary = await getDictionary(locale, ['finance', 'common'])
  const t = createTranslator(dictionary, locale)

  const page = Math.max(1, Number(query.page) || 1)
  const pageSize = Math.min(200, Math.max(1, Number(query.pageSize) || 25))

  const [result, categories] = await Promise.all([
    listPendingExpenseApprovals(ctx.db, { page, pageSize }),
    listExpenseCategories(ctx.db),
  ])

  const loadIds = [...new Set(result.expenses.map((e) => e.loadId).filter((id): id is string => Boolean(id)))]
  const carrierIds = [
    ...new Set(result.expenses.map((e) => e.carrierId).filter((id): id is string => Boolean(id))),
  ]
  const [loadRows, carrierRows] = await Promise.all([
    loadIds.length > 0 ? ctx.db.findMany(loads, { where: inArray(loads.id, loadIds) }) : Promise.resolve([]),
    carrierIds.length > 0
      ? ctx.db.findMany(carriers, { where: inArray(carriers.id, carrierIds) })
      : Promise.resolve([]),
  ])

  return (
    <div className="space-y-6">
      <PageHeader title={t('finance.expense.approvalQueue.title')} />
      <ExpenseApprovalQueue
        locale={locale}
        rows={result.expenses}
        total={result.total}
        page={page}
        pageSize={pageSize}
        categoryLabelById={Object.fromEntries(
          categories.map((c) => [c.id, locale === 'es' ? c.labelEs : c.labelEn]),
        )}
        loadNumberById={Object.fromEntries(loadRows.map((l) => [l.id, l.loadNumber]))}
        carrierNameById={Object.fromEntries(carrierRows.map((c) => [c.id, c.legalName]))}
      />
    </div>
  )
}
