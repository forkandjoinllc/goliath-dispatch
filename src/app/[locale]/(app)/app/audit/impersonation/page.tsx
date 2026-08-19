import Link from 'next/link'
import { notFound } from 'next/navigation'
import { isLocale } from '@/i18n/config'
import { getDictionary } from '@/i18n/dictionary'
import { createTranslator, formatDateTime } from '@/i18n/translate'
import { loadFor } from '@/server/action'
import { listImpersonationSessions } from '@/server/audit/queries'
import { PageHeader } from '@/components/shell/page-header'
import { Card, CardContent } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { EmptyState } from '@/components/ui/feedback'

export default async function ImpersonationSessionsPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params
  if (!isLocale(locale)) notFound()

  const ctx = await loadFor('audit:read')
  const dictionary = await getDictionary(locale, ['report', 'common'])
  const t = createTranslator(dictionary, locale)

  const sessions = await listImpersonationSessions(ctx.db)

  return (
    <div className="space-y-6">
      <PageHeader title={t('report.audit.impersonationSessions')} description={t('report.audit.impersonationDescription')} />

      {sessions.length === 0 ? (
        <EmptyState title={t('report.audit.empty')} />
      ) : (
        <div className="space-y-3">
          {sessions.map(({ session, eventCount }) => (
            <Link key={session.id} href={`/${locale}/app/audit/impersonation/${session.id}`}>
              <Card className="transition-colors hover:border-navy-400">
                <CardContent className="flex flex-wrap items-center justify-between gap-2 py-4 text-sm">
                  <div className="space-y-1">
                    <p className="font-semibold text-carbon">{t('report.audit.impersonationSummary')}</p>
                    <p className="text-xs text-steel-600">{session.reason}</p>
                  </div>
                  <div className="flex items-center gap-3 text-xs text-steel-600">
                    <span>{formatDateTime(session.startedAt, locale, 'UTC')}</span>
                    <Badge tone={session.endedAt ? 'neutral' : 'success'}>
                      {session.endedAt ? t('report.audit.ended') : t('report.audit.active')}
                    </Badge>
                    <Badge tone="navy">{t('report.audit.eventCount', { count: eventCount })}</Badge>
                  </div>
                </CardContent>
              </Card>
            </Link>
          ))}
        </div>
      )}
    </div>
  )
}
