import { notFound } from 'next/navigation'
import { isLocale } from '@/i18n/config'
import { getDictionary } from '@/i18n/dictionary'
import { createTranslator } from '@/i18n/translate'
import { loadFor } from '@/server/action'
import { ensureSystemExpenseCategories, listExpenseCategories } from '@/server/finance/expenses'
import { PageHeader } from '@/components/shell/page-header'
import { CategoryList } from '../_components/category-list'

export default async function ExpenseCategoriesPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params
  if (!isLocale(locale)) notFound()

  const ctx = await loadFor('expense:category:manage')
  const dictionary = await getDictionary(locale, ['finance', 'common'])
  const t = createTranslator(dictionary, locale)

  // Idempotent — safe to call on every page load; guarantees Permits/Escorts
  // exist for tenants provisioned before this module shipped.
  await ensureSystemExpenseCategories(ctx.db)
  const categories = await listExpenseCategories(ctx.db)

  return (
    <div className="space-y-6">
      <PageHeader title={t('finance.expense.category.title')} />
      <CategoryList locale={locale} categories={categories} />
    </div>
  )
}
