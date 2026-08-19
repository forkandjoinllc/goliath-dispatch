import Link from 'next/link'
import { notFound } from 'next/navigation'
import { isLocale } from '@/i18n/config'
import { getDictionary } from '@/i18n/dictionary'
import { createTranslator } from '@/i18n/translate'
import { loadFor } from '@/server/action'
import { getTenantPolicy } from '@/server/context'
import { can } from '@/lib/permissions'
import { listReports } from '@/server/reports/registry'
import { PageHeader } from '@/components/shell/page-header'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { EmptyState } from '@/components/ui/feedback'

/**
 * The report picker: every report the actor's role can reach at any scope,
 * filtered with `can()` against the report's own `requiredPermission` —
 * never a hand-maintained per-role list, so a new report becomes visible
 * automatically once it's registered and a role's matrix grants its
 * permission.
 */
export default async function ReportsPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params
  if (!isLocale(locale)) notFound()

  const ctx = await loadFor('report:read')
  const dictionary = await getDictionary(locale, ['report', 'common'])
  const t = createTranslator(dictionary, locale)
  const policy = await getTenantPolicy(ctx.actor.tenantId)

  const visibleReports = listReports().filter((report) => can(ctx.actor, report.requiredPermission, undefined, policy).allowed)

  return (
    <div className="space-y-6">
      <PageHeader title={t('report.picker.title')} description={t('report.picker.description')} />

      {visibleReports.length === 0 ? (
        <EmptyState title={t('report.picker.empty')} />
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {visibleReports.map((report) => (
            <Link key={report.key} href={`/${locale}/app/reports/${report.key}`}>
              <Card className="h-full transition-colors hover:border-navy-400">
                <CardHeader>
                  <CardTitle>{t(report.titleKey)}</CardTitle>
                  {report.descriptionKey ? <CardDescription>{t(report.descriptionKey)}</CardDescription> : null}
                </CardHeader>
                <CardContent className="text-xs font-semibold uppercase tracking-wide text-steel-500">
                  {t('report.picker.viewReport')}
                </CardContent>
              </Card>
            </Link>
          ))}
        </div>
      )}
    </div>
  )
}
