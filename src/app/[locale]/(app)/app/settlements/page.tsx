import Link from 'next/link'
import { notFound } from 'next/navigation'
import { inArray } from 'drizzle-orm'
import { isLocale } from '@/i18n/config'
import { getDictionary } from '@/i18n/dictionary'
import { createTranslator } from '@/i18n/translate'
import { loadFor } from '@/server/action'
import { getTenantPolicy } from '@/server/context'
import { can, scopeFilter } from '@/lib/permissions'
import { carriers } from '@/db/schema'
import { listSettlements } from '@/server/settlements/queries'
import { PageHeader } from '@/components/shell/page-header'
import { Button } from '@/components/ui/button'
import { SettlementList } from './_components/settlement-list'

export default async function SettlementsPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>
  searchParams: Promise<{ page?: string; pageSize?: string; status?: string }>
}) {
  const { locale } = await params
  if (!isLocale(locale)) notFound()
  const query = await searchParams

  const ctx = await loadFor('settlement:read')
  const dictionary = await getDictionary(locale, ['finance', 'common'])
  const t = createTranslator(dictionary, locale)

  const policy = await getTenantPolicy(ctx.actor.tenantId)
  const decision = can(ctx.actor, 'settlement:read', undefined, policy)
  const scope = scopeFilter(ctx.actor, decision.scope!)
  const canManage = can(ctx.actor, 'settlement:manage', undefined, policy).allowed

  const page = Math.max(1, Number(query.page) || 1)
  const pageSize = Math.min(200, Math.max(1, Number(query.pageSize) || 25))
  const status = (query.status || undefined) as never

  const result = await listSettlements(ctx.db, scope, { status, pagination: { page, pageSize } })

  const carrierIds = [...new Set(result.settlements.map((s) => s.carrierId))]
  const carrierRows =
    carrierIds.length > 0 ? await ctx.db.findMany(carriers, { where: inArray(carriers.id, carrierIds) }) : []
  const carrierNameById = Object.fromEntries(carrierRows.map((c) => [c.id, c.legalName]))

  return (
    <div className="space-y-6">
      <PageHeader
        title={t('finance.settlement.title')}
        primaryAction={
          canManage ? (
            <Button asChild>
              <Link href={`/${locale}/app/settlements/new`}>{t('finance.settlement.list.generate')}</Link>
            </Button>
          ) : undefined
        }
      />
      <SettlementList
        locale={locale}
        rows={result.settlements}
        total={result.total}
        page={page}
        pageSize={pageSize}
        status={query.status ?? ''}
        carrierNameById={carrierNameById}
      />
    </div>
  )
}
