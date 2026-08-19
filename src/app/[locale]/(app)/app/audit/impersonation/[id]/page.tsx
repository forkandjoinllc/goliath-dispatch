import { notFound } from 'next/navigation'
import { isLocale } from '@/i18n/config'
import { getDictionary } from '@/i18n/dictionary'
import { createTranslator } from '@/i18n/translate'
import { loadFor } from '@/server/action'
import { listEventsForImpersonationSession } from '@/server/audit/queries'
import { PageHeader } from '@/components/shell/page-header'
import { AuditEventTimeline } from '../../_components/audit-event-timeline'

export default async function ImpersonationSessionDetailPage({
  params,
}: {
  params: Promise<{ locale: string; id: string }>
}) {
  const { locale, id } = await params
  if (!isLocale(locale)) notFound()

  const ctx = await loadFor('audit:read')
  const dictionary = await getDictionary(locale, ['report', 'common'])
  const t = createTranslator(dictionary, locale)

  const events = await listEventsForImpersonationSession(ctx.db, id)

  return (
    <div className="space-y-6">
      <PageHeader title={t('report.audit.impersonationSessionDetail')} description={t('report.audit.impersonationDescription')} />
      <AuditEventTimeline events={events} emptyLabel={t('report.audit.empty')} />
    </div>
  )
}
