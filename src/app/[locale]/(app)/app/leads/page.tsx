import { notFound } from 'next/navigation'
import { isLocale } from '@/i18n/config'
import { getDictionary } from '@/i18n/dictionary'
import { createTranslator } from '@/i18n/translate'
import { loadFor } from '@/server/action'
import { getTenantPolicy } from '@/server/context'
import { can } from '@/lib/permissions'
import { listTenantLeads, listUnclaimedCarrierSignupLeads, parseCarrierSignupPayload } from '@/server/leads/queries'
import { PageHeader } from '@/components/shell/page-header'
import { listAssignableUsers } from './_lib/queries'
import { LeadsList } from './_components/leads-list'

export default async function LeadsPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>
  searchParams: Promise<{ status?: string; source?: string }>
}) {
  const { locale } = await params
  if (!isLocale(locale)) notFound()
  const query = await searchParams

  const ctx = await loadFor('lead:read')
  const dictionary = await getDictionary(locale, ['carrier', 'common'])
  const t = createTranslator(dictionary, locale)
  const policy = await getTenantPolicy(ctx.actor.tenantId)

  const [tenantLeads, unclaimedLeads, assignableUsers] = await Promise.all([
    listTenantLeads(ctx.db, { status: query.status || undefined, source: query.source || undefined }),
    listUnclaimedCarrierSignupLeads(ctx.db),
    listAssignableUsers(ctx.db),
  ])

  // The unclaimed pool is shared across every tenant (see `leads/queries.ts`'s
  // module comment on the gap this works around) — filters that apply to the
  // tenant-owned list are not re-applied here since these rows have no
  // tenant-scoped status/assignment yet.
  const rows = [...tenantLeads, ...unclaimedLeads].sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())

  const payloadsByLeadId = Object.fromEntries(
    rows.map((lead) => [lead.id, parseCarrierSignupPayload(lead)] as const).filter(([, payload]) => payload !== null),
  )

  const canConvert = can(ctx.actor, 'carrier:create', undefined, policy).allowed
  const canUpdate = can(ctx.actor, 'lead:update', undefined, policy).allowed

  return (
    <div className="space-y-6">
      <PageHeader title={t('carrier.leads.title')} />
      <LeadsList
        locale={locale}
        rows={rows}
        payloadsByLeadId={payloadsByLeadId}
        assignableUsers={assignableUsers}
        status={query.status ?? ''}
        source={query.source ?? ''}
        permissions={{ canConvert, canUpdate }}
      />
    </div>
  )
}
