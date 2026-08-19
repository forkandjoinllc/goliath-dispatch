import Link from 'next/link'
import { notFound } from 'next/navigation'
import { isLocale } from '@/i18n/config'
import { getDictionary } from '@/i18n/dictionary'
import { createTranslator } from '@/i18n/translate'
import { loadFor } from '@/server/action'
import { getTenantPolicy } from '@/server/context'
import { can, scopeFilter } from '@/lib/permissions'
import { listDrivers } from '@/server/drivers/queries'
import { PageHeader } from '@/components/shell/page-header'
import { Button } from '@/components/ui/button'
import { DriverList } from './_components/driver-list'

export default async function DriversPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>
  searchParams: Promise<{ page?: string; pageSize?: string; search?: string; status?: string }>
}) {
  const { locale } = await params
  if (!isLocale(locale)) notFound()
  const query = await searchParams

  const ctx = await loadFor('driver:read')
  const dictionary = await getDictionary(locale, ['driver', 'common'])
  const t = createTranslator(dictionary, locale)

  const policy = await getTenantPolicy(ctx.actor.tenantId)
  const decision = can(ctx.actor, 'driver:read', undefined, policy)
  const scope = scopeFilter(ctx.actor, decision.scope!)
  const canCreate = can(ctx.actor, 'driver:create', undefined, policy).allowed

  const page = Math.max(1, Number(query.page) || 1)
  const pageSize = Math.min(200, Math.max(1, Number(query.pageSize) || 25))
  const search = query.search ?? ''
  const status = query.status ?? ''

  const result = await listDrivers(ctx.db, scope, {
    search: search || undefined,
    status: (status || undefined) as never,
    pagination: { page, pageSize },
  })

  return (
    <div className="space-y-6">
      <PageHeader
        title={t('driver.title')}
        primaryAction={
          canCreate ? (
            <Link href={`/${locale}/app/drivers/new`}>
              <Button>{t('driver.list.new')}</Button>
            </Link>
          ) : undefined
        }
      />
      <DriverList
        locale={locale}
        rows={result.rows}
        total={result.total}
        page={page}
        pageSize={pageSize}
        search={search}
        status={status}
      />
    </div>
  )
}
