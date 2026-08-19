import { notFound } from 'next/navigation'
import { isLocale } from '@/i18n/config'
import { getDictionary } from '@/i18n/dictionary'
import { createTranslator } from '@/i18n/translate'
import { loadFor } from '@/server/action'
import { getTenantPolicy } from '@/server/context'
import { can } from '@/lib/permissions'
import { listExpenseCategories } from '@/server/finance/expenses'
import { getCarrier } from '@/server/carriers/queries'
import { PageHeader } from '@/components/shell/page-header'
import { ExpenseForm } from '../_components/expense-form'

export default async function NewExpensePage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params
  if (!isLocale(locale)) notFound()

  const ctx = await loadFor('expense:submit')
  const dictionary = await getDictionary(locale, ['finance', 'common'])
  const t = createTranslator(dictionary, locale)
  const policy = await getTenantPolicy(ctx.actor.tenantId)

  const categories = await listExpenseCategories(ctx.db, { activeOnly: true })

  // A Carrier actor's own carrier is implicit — no picker needed. Everyone
  // else (Admin, Accounting, Dispatcher) must search for the carrier.
  const isCarrierActor = ctx.actor.role === 'carrier' && ctx.actor.carrierId
  const defaultCarrier = isCarrierActor ? await getCarrier(ctx.db, ctx.actor.carrierId!).catch(() => null) : null

  const canPickCarrier = can(ctx.actor, 'carrier:read', undefined, policy).allowed

  return (
    <div className="space-y-6">
      <PageHeader title={t('finance.expense.list.new')} />
      <ExpenseForm
        locale={locale}
        categories={categories}
        defaultCarrierId={isCarrierActor ? ctx.actor.carrierId : null}
        defaultCarrierLabel={defaultCarrier?.legalName ?? null}
        showCarrierPicker={!isCarrierActor && canPickCarrier}
      />
    </div>
  )
}
