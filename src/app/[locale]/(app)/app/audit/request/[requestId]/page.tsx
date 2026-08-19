import { notFound } from 'next/navigation'
import { isLocale } from '@/i18n/config'
import { getDictionary } from '@/i18n/dictionary'
import { createTranslator } from '@/i18n/translate'
import { loadFor } from '@/server/action'
import { listEventsByRequestId } from '@/server/audit/queries'
import { PageHeader } from '@/components/shell/page-header'
import { AuditEventTimeline } from '../../_components/audit-event-timeline'

export default async function AuditRequestPage({
  params,
}: {
  params: Promise<{ locale: string; requestId: string }>
}) {
  const { locale, requestId } = await params
  if (!isLocale(locale)) notFound()

  const ctx = await loadFor('audit:read')
  const dictionary = await getDictionary(locale, ['report', 'common'])
  const t = createTranslator(dictionary, locale)

  const events = await listEventsByRequestId(ctx.db, requestId)

  return (
    <div className="space-y-6">
      <PageHeader
        title={t('report.audit.requestGroup.title')}
        description={t('report.audit.requestGroup.description', { requestId })}
      />
      <AuditEventTimeline events={events} emptyLabel={t('report.audit.empty')} />
    </div>
  )
}
