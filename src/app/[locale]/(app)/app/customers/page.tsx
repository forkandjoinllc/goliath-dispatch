import Link from 'next/link'
import { notFound } from 'next/navigation'
import { isLocale } from '@/i18n/config'
import { getDictionary } from '@/i18n/dictionary'
import { createTranslator } from '@/i18n/translate'
import { loadFor } from '@/server/action'
import { can, scopeFilter } from '@/lib/permissions'
import { getTenantPolicy } from '@/server/context'
import { listCustomers } from '@/server/customers/queries'
import { PageHeader } from '@/components/shell/page-header'
import { Button } from '@/components/ui/button'
import { CustomerList } from './_components/customer-list'

export default async function CustomersPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>
  searchParams: Promise<{ page?: string; pageSize?: string; search?: string; status?: string }>
}) {
  const { locale } = await params
  if (!isLocale(locale)) notFound()
  const query = await searchParams

  const ctx = await loadFor('customer:read')
  const dictionary = await getDictionary(locale, ['customer', 'common'])
  const t = createTranslator(dictionary, locale)

  const policy = await getTenantPolicy(ctx.actor.tenantId)
  const readDecision = can(ctx.actor, 'customer:read', undefined, policy)
  const scope = scopeFilter(ctx.actor, readDecision.scope!)
  const canCreate = can(ctx.actor, 'customer:create', undefined, policy).allowed

  const page = Math.max(1, Number(query.page) || 1)
  const pageSize = Math.min(200, Math.max(1, Number(query.pageSize) || 25))
  const search = query.search ?? ''
  const status = (query.status ?? '') as '' | 'active' | 'on_hold' | 'inactive'

  const result = await listCustomers(ctx.db, scope, {
    search: search || undefined,
    status: status || undefined,
    pagination: { page, pageSize },
  })

  return (
    <div className="space-y-6">
      <PageHeader
        title={t('customer.list.title')}
        primaryAction={
          canCreate ? (
            <Button asChild>
              <Link href={`/${locale}/app/customers/new`}>{t('customer.list.new')}</Link>
            </Button>
          ) : undefined
        }
      />
      <CustomerList
        locale={locale}
        rows={result.customers}
        total={result.total}
        page={page}
        pageSize={pageSize}
        search={search}
        status={status}
      />
    </div>
  )
}
