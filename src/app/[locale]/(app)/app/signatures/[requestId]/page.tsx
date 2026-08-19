import Link from 'next/link'
import { notFound } from 'next/navigation'
import { ArrowLeft } from 'lucide-react'
import { isLocale } from '@/i18n/config'
import { getDictionary } from '@/i18n/dictionary'
import { createTranslator, formatDateTime } from '@/i18n/translate'
import { loadFor } from '@/server/action'
import { getTenant, requireActor } from '@/server/context'
import { tenantDb } from '@/db/tenant-db'
import { can } from '@/lib/permissions'
import { PageHeader } from '@/components/shell/page-header'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Timeline, type TimelineEvent } from '@/components/data/timeline'
import { DetailList } from '@/components/data/detail-list'
import { getSignatureRequestDetail, resolveSignatureRequestResourceContext } from '@/server/signatures/queries'
import { verifyIntegrity } from '@/server/signatures/service'
import { SignatureStatusBadge } from '../_components/status-badge'
import { IntegrityPanel } from '../_components/integrity-panel'
import { DownloadCertificateButton, DownloadSignedDocumentButton } from '../_components/download-buttons'
import { VoidRequestButton } from '../_components/void-request-button'

export default async function SignatureRequestDetailPage({
  params,
}: {
  params: Promise<{ locale: string; requestId: string }>
}) {
  const { locale, requestId } = await params
  if (!isLocale(locale)) notFound()

  const actorPreview = await requireActor()
  if (!actorPreview.tenantId) notFound()
  const resource = await resolveSignatureRequestResourceContext(tenantDb(actorPreview.tenantId), requestId)
  const ctx = await loadFor('signature:request:read', resource)

  const dictionary = await getDictionary(locale, ['signature', 'common', 'document'])
  const t = createTranslator(dictionary, locale)
  const tenant = await getTenant(ctx.actor.tenantId)
  const timezone = tenant?.defaultTimezone ?? 'America/New_York'

  const { request, record, events } = await getSignatureRequestDetail(ctx.db, requestId)
  const integrity = record ? await verifyIntegrity(ctx.db, record.id) : null

  const canVoid = can(ctx.actor, 'signature:void', resource).allowed && request.status !== 'signed' && request.status !== 'voided'
  const canDownloadCertificate = can(ctx.actor, 'signature:certificate:download', resource).allowed

  const timelineEvents: TimelineEvent[] = events.map((event) => ({
    id: event.id,
    time: formatDateTime(event.occurredAt, locale, timezone),
    actor: event.actorEmail ?? undefined,
    description: t.optional(`document.certificate.events.${event.eventType}`) ?? event.eventType,
    tone:
      event.eventType === 'declined' || event.eventType === 'voided'
        ? 'danger'
        : event.eventType === 'sealed'
          ? 'success'
          : 'neutral',
  }))

  return (
    <div className="space-y-6">
      <Link href={`/${locale}/app/signatures`} className="inline-flex items-center gap-1.5 text-sm font-medium text-navy-700 hover:underline">
        <ArrowLeft className="size-4" aria-hidden="true" />
        {t('signature.detail.backToList')}
      </Link>

      <PageHeader
        title={t('signature.detail.title')}
        description={request.signerEmail}
        status={<SignatureStatusBadge status={request.status} t={t} />}
        secondaryActions={canVoid ? <VoidRequestButton requestId={request.id} /> : undefined}
      />

      <Card>
        <CardHeader>
          <CardTitle>{t('signature.fields.template')}</CardTitle>
        </CardHeader>
        <CardContent>
          <DetailList
            items={[
              { key: 'template', label: t('signature.fields.template'), value: request.template?.titleEn ?? request.templateId },
              {
                key: 'version',
                label: t('signature.fields.templateVersion', { version: request.templateVersion }),
                value: request.templateContentHash.slice(0, 16),
              },
              { key: 'subject', label: t('signature.fields.subject'), value: t(`signature.subjectTypes.${request.subjectType}`) },
              { key: 'signer', label: t('signature.fields.signer'), value: request.signerLegalName ?? request.signerEmail },
              { key: 'sentAt', label: t('signature.fields.sentAt'), value: formatDateTime(request.requestedAt, locale, timezone) },
              {
                key: 'viewedAt',
                label: t('signature.fields.viewedAt'),
                value: request.firstViewedAt ? formatDateTime(request.firstViewedAt, locale, timezone) : '—',
              },
              {
                key: 'signedAt',
                label: t('signature.fields.signedAt'),
                value: request.completedAt ? formatDateTime(request.completedAt, locale, timezone) : '—',
              },
              {
                key: 'expiresAt',
                label: t('signature.fields.expiresAt'),
                value: request.expiresAt ? formatDateTime(request.expiresAt, locale, timezone) : '—',
              },
            ]}
          />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>{t('signature.detail.record')}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {!record ? (
            <p className="text-sm text-steel-600">{t('signature.detail.noRecordYet')}</p>
          ) : (
            <>
              <DetailList
                items={[
                  { key: 'signerLegalName', label: t('signature.fields.signerLegalName'), value: record.signerLegalName },
                  { key: 'signerTitle', label: t('signature.fields.signerTitle'), value: record.signerTitle ?? '—' },
                  { key: 'method', label: t('signature.fields.template'), value: t(`signature.methods.${record.method}`) },
                  {
                    key: 'documentHash',
                    label: t('signature.detail.downloadDocument'),
                    value: record.documentSha256,
                    masked: true,
                    fullWidth: true,
                  },
                  { key: 'seal', label: t('signature.detail.integrity'), value: record.integritySeal, masked: true, fullWidth: true },
                ]}
              />
              <div className="flex flex-wrap gap-2">
                {record.signedDocumentId ? <DownloadSignedDocumentButton documentId={record.signedDocumentId} /> : null}
                {canDownloadCertificate && record.auditCertificateDocumentId ? (
                  <DownloadCertificateButton requestId={request.id} />
                ) : null}
              </div>
            </>
          )}
        </CardContent>
      </Card>

      {integrity ? <IntegrityPanel result={integrity} t={t} /> : null}

      <Card>
        <CardHeader>
          <CardTitle>{t('signature.detail.ceremony')}</CardTitle>
        </CardHeader>
        <CardContent>
          <Timeline events={timelineEvents} />
        </CardContent>
      </Card>
    </div>
  )
}
