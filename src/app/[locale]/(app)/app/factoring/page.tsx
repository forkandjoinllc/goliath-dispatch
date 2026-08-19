import { notFound } from 'next/navigation'
import { inArray } from 'drizzle-orm'
import { isLocale } from '@/i18n/config'
import { getDictionary } from '@/i18n/dictionary'
import { createTranslator } from '@/i18n/translate'
import { loadFor } from '@/server/action'
import { getTenantPolicy } from '@/server/context'
import { can, scopeFilter } from '@/lib/permissions'
import { carriers } from '@/db/schema'
import { listFactoringAssignments, listFactoringCompanies } from '@/server/factoring/queries'
import { PageHeader } from '@/components/shell/page-header'
import { Alert } from '@/components/ui/feedback'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { FactoringCompanyList } from './_components/factoring-company-list'
import { FactoringAssignmentList } from './_components/factoring-assignment-list'
import { AssignmentFormDialog } from './_components/assignment-form-dialog'

export default async function FactoringPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params
  if (!isLocale(locale)) notFound()

  const ctx = await loadFor('factoring:read')
  const dictionary = await getDictionary(locale, ['finance', 'common'])
  const t = createTranslator(dictionary, locale)

  const policy = await getTenantPolicy(ctx.actor.tenantId)
  const decision = can(ctx.actor, 'factoring:read', undefined, policy)
  const scope = scopeFilter(ctx.actor, decision.scope!)
  const canManage = can(ctx.actor, 'factoring:manage', undefined, policy).allowed

  const [companies, assignments] = await Promise.all([
    listFactoringCompanies(ctx.db),
    listFactoringAssignments(ctx.db, scope),
  ])

  const carrierIds = [...new Set(assignments.map((a) => a.carrierId))]
  const carrierRows =
    carrierIds.length > 0 ? await ctx.db.findMany(carriers, { where: inArray(carriers.id, carrierIds) }) : []
  const carrierNameById = Object.fromEntries(carrierRows.map((c) => [c.id, c.legalName]))
  const companyNameById = Object.fromEntries(companies.map((c) => [c.id, c.name]))

  return (
    <div className="space-y-6">
      <PageHeader title={t('finance.factoring.title')} />
      <Alert tone="warning">{t('finance.factoring.manualNoticeBanner')}</Alert>

      <Card>
        <CardHeader>
          <CardTitle>{t('finance.factoring.assignments.title')}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {canManage && companies.length > 0 ? (
            <div className="flex justify-end">
              <AssignmentFormDialog companies={companies} />
            </div>
          ) : null}
          <FactoringAssignmentList
            locale={locale}
            assignments={assignments}
            carrierNameById={carrierNameById}
            companyNameById={companyNameById}
          />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>{t('finance.factoring.companies.title')}</CardTitle>
        </CardHeader>
        <CardContent>
          <FactoringCompanyList companies={companies} canManage={canManage} />
        </CardContent>
      </Card>
    </div>
  )
}
