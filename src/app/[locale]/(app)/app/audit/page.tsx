import { notFound } from 'next/navigation'
import Link from 'next/link'
import { isLocale } from '@/i18n/config'
import { getDictionary } from '@/i18n/dictionary'
import { createTranslator } from '@/i18n/translate'
import { loadFor } from '@/server/action'
import { listAuditEvents } from '@/server/audit/queries'
import { auditActionEnum } from '@/db/schema/_shared'
import { PageHeader } from '@/components/shell/page-header'
import { Button } from '@/components/ui/button'
import { AuditFilterBar } from './_components/audit-filter-bar'
import { AuditList, type AuditListRow } from './_components/audit-list'

interface PageProps {
  params: Promise<{ locale: string }>
  searchParams: Promise<Record<string, string | undefined>>
}

export default async function AuditPage({ params, searchParams }: PageProps) {
  const { locale } = await params
  if (!isLocale(locale)) notFound()

  const ctx = await loadFor('audit:read')
  const dictionary = await getDictionary(locale, ['report', 'common'])
  const t = createTranslator(dictionary, locale)

  const query = await searchParams
  const page = Math.max(1, Number(query.page) || 1)
  const pageSize = Math.min(200, Math.max(1, Number(query.pageSize) || 50))

  const { events, total } = await listAuditEvents(ctx.db, {
    filters: {
      action: query.action || undefined,
      entityType: query.entityType || undefined,
      requestId: query.requestId || undefined,
      reasonPresent: query.reasonPresent === '1' ? true : undefined,
      dateFrom: query.dateFrom ? new Date(query.dateFrom) : undefined,
      dateTo: query.dateTo ? new Date(`${query.dateTo}T23:59:59`) : undefined,
    },
    pagination: { page, pageSize },
  })

  const rows: AuditListRow[] = events.map((event) => ({
    id: event.id,
    occurredAt: event.occurredAt,
    actorEmail: event.actorEmail,
    actorRole: event.actorRole,
    effectiveUserId: event.effectiveUserId,
    actorUserId: event.actorUserId,
    impersonationSessionId: event.impersonationSessionId,
    action: event.action,
    entityType: event.entityType,
    entityId: event.entityId,
    entityLabel: event.entityLabel,
    reason: event.reason,
    requestId: event.requestId,
  }))

  const values = {
    action: query.action ?? '',
    entityType: query.entityType ?? '',
    requestId: query.requestId ?? '',
    reasonPresent: query.reasonPresent ?? '',
    dateFrom: query.dateFrom ?? '',
    dateTo: query.dateTo ?? '',
  }
  const queryString = new URLSearchParams(Object.fromEntries(Object.entries(values).filter(([, v]) => v))).toString()

  return (
    <div className="space-y-6">
      <PageHeader
        title={t('report.audit.title')}
        description={t('report.audit.description')}
        secondaryActions={
          <Button variant="secondary" asChild>
            <Link href={`/${locale}/app/audit/impersonation`}>{t('report.audit.impersonationSessions')}</Link>
          </Button>
        }
      />
      <AuditFilterBar basePath={`/${locale}/app/audit`} actions={auditActionEnum.enumValues} values={values} />
      <AuditList locale={locale} rows={rows} total={total} page={page} pageSize={pageSize} queryString={queryString} />
    </div>
  )
}
