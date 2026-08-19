import Link from 'next/link'
import { notFound } from 'next/navigation'
import { inArray } from 'drizzle-orm'
import { isLocale } from '@/i18n/config'
import { getDictionary } from '@/i18n/dictionary'
import { createTranslator } from '@/i18n/translate'
import { loadFor } from '@/server/action'
import { getTenantPolicy } from '@/server/context'
import { can, scopeFilter } from '@/lib/permissions'
import { carriers, loads } from '@/db/schema'
import { listExpenseCategories, listExpenses } from '@/server/finance/expenses'
import { PageHeader } from '@/components/shell/page-header'
import { Button } from '@/components/ui/button'
import { ExpenseList } from './_components/expense-list'

export default async function ExpensesPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>
  searchParams: Promise<{ page?: string; pageSize?: string; status?: string }>
}) {
  const { locale } = await params
  if (!isLocale(locale)) notFound()
  const query = await searchParams

  const ctx = await loadFor('expense:read')
  const dictionary = await getDictionary(locale, ['finance', 'common'])
  const t = createTranslator(dictionary, locale)

  const policy = await getTenantPolicy(ctx.actor.tenantId)
  const decision = can(ctx.actor, 'expense:read', undefined, policy)
  const scope = scopeFilter(ctx.actor, decision.scope!)
  const canSubmit = can(ctx.actor, 'expense:submit', undefined, policy).allowed
  const canApprove = can(ctx.actor, 'expense:approve', undefined, policy).allowed
  const canManageCategories = can(ctx.actor, 'expense:category:manage', undefined, policy).allowed

  const page = Math.max(1, Number(query.page) || 1)
  const pageSize = Math.min(200, Math.max(1, Number(query.pageSize) || 25))
  const status = (query.status || undefined) as never

  const [result, categories] = await Promise.all([
    listExpenses(ctx.db, scope, { status, pagination: { page, pageSize } }),
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
  const loadNumberById = new Map(loadRows.map((l) => [l.id, l.loadNumber]))
  const carrierNameById = new Map(carrierRows.map((c) => [c.id, c.legalName]))
  const categoryById = new Map(categories.map((c) => [c.id, locale === 'es' ? c.labelEs : c.labelEn]))

  return (
    <div className="space-y-6">
      <PageHeader
        title={t('finance.expense.title')}
        primaryAction={
          canSubmit ? (
            <Button asChild>
              <Link href={`/${locale}/app/expenses/new`}>{t('finance.expense.list.new')}</Link>
            </Button>
          ) : undefined
        }
        secondaryActions={
          <div className="flex gap-2">
            {canApprove ? (
              <Button variant="secondary" asChild>
                <Link href={`/${locale}/app/expenses/approvals`}>{t('finance.expense.approvalQueue.title')}</Link>
              </Button>
            ) : null}
            {canManageCategories ? (
              <Button variant="secondary" asChild>
                <Link href={`/${locale}/app/expenses/categories`}>{t('finance.expense.category.title')}</Link>
              </Button>
            ) : null}
          </div>
        }
      />
      <ExpenseList
        locale={locale}
        rows={result.expenses}
        total={result.total}
        page={page}
        pageSize={pageSize}
        status={query.status ?? ''}
        loadNumberById={Object.fromEntries(loadNumberById)}
        carrierNameById={Object.fromEntries(carrierNameById)}
        categoryLabelById={Object.fromEntries(categoryById)}
      />
    </div>
  )
}
