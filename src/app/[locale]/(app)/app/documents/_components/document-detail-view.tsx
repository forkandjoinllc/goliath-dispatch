'use client'

import * as React from 'react'
import { Download, Loader2 } from 'lucide-react'
import { PageHeader } from '@/components/shell/page-header'
import { StatusBadge } from '@/components/status/status-badge'
import { ExpiryBadge } from '@/components/status/expiry-badge'
import { Button } from '@/components/ui/button'
import { DetailList, type DetailItem } from '@/components/data/detail-list'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { useToast } from '@/components/ui/toast'
import { useI18n, useTranslate } from '@/components/providers/i18n-provider'
import { formatDateTime } from '@/i18n/translate'
import { bytesToHuman } from '@/lib/utils'
import type { Document, DocumentReview, DocumentVersion } from '@/db/schema'
import { getDocumentDownloadUrl } from '@/server/documents/actions'
import { DocumentReviewPanel } from './document-review-panel'
import { DocumentUploadDialog } from './document-upload-dialog'
import type { DocumentOwnerType } from '@/lib/storage'

/** Opens a fresh signed URL for one specific version — signed URLs expire, so this is fetched on click, never embedded. */
function DownloadVersionButton({ documentId, versionId }: { documentId: string; versionId: string }) {
  const t = useTranslate()
  const { toast } = useToast()
  const [isPending, startTransition] = React.useTransition()

  function open() {
    startTransition(async () => {
      const result = await getDocumentDownloadUrl({ documentId, versionId })
      if (result.ok) {
        window.open(result.data.url, '_blank', 'noopener,noreferrer')
        return
      }
      toast({ tone: 'error', title: t(result.error.messageKey, result.error.params) })
    })
  }

  return (
    <Button type="button" variant="secondary" size="sm" disabled={isPending} onClick={open}>
      {isPending ? <Loader2 className="size-4 animate-spin" aria-hidden="true" /> : <Download className="size-4" aria-hidden="true" />}
      {t('document.access.download')}
    </Button>
  )
}

export interface DocumentDetailViewProps {
  document: Document
  versions: DocumentVersion[]
  reviews: DocumentReview[]
  reviewerNames: Record<string, string>
  ownerLabel: string
  accessLog: Array<{ id: string; userId: string | null; action: string; watermarked: boolean; createdAt: Date }>
  preview: { url: string; contentType: string } | null
  permissions: { canReview: boolean; canDownload: boolean; canUpload: boolean }
}

export function DocumentDetailView({
  document,
  versions,
  reviews,
  reviewerNames,
  ownerLabel,
  accessLog,
  preview,
  permissions,
}: DocumentDetailViewProps) {
  const t = useTranslate()
  const { locale: i18nLocale, timezone } = useI18n()

  const reviewsByVersion = new Map<string, DocumentReview[]>()
  for (const review of reviews) {
    const list = reviewsByVersion.get(review.documentVersionId) ?? []
    list.push(review)
    reviewsByVersion.set(review.documentVersionId, list)
  }

  const items: DetailItem[] = [
    { key: 'title', label: t('document.list.columns.document'), value: document.title ?? t(`document.types.${document.documentType}`) },
    { key: 'type', label: t('document.list.columns.type'), value: t(`document.types.${document.documentType}`) },
    { key: 'owner', label: t('document.list.columns.owner'), value: `${t(`document.list.ownerTypes.${document.ownerType}`)} — ${ownerLabel}` },
    { key: 'issueDate', label: t('document.upload.issueDate'), value: document.issueDate ? formatDateTime(document.issueDate, i18nLocale, timezone) : t('common.labels.none') },
    { key: 'expirationDate', label: t('document.upload.expirationDate'), value: document.expirationDate ? <ExpiryBadge date={document.expirationDate} /> : t('common.labels.none') },
    { key: 'isRequired', label: t('common.labels.required'), value: document.isRequired ? t('common.labels.yes') : t('common.labels.no') },
    { key: 'description', label: t('document.fields.description'), value: document.description ?? t('common.labels.none'), fullWidth: true },
  ]

  return (
    <div className="space-y-6">
      <PageHeader
        title={document.title ?? t(`document.types.${document.documentType}`)}
        status={<StatusBadge kind="documentReview" value={document.reviewStatus} />}
        secondaryActions={
          permissions.canUpload ? (
            <DocumentUploadDialog
              ownerType={document.ownerType as DocumentOwnerType}
              ownerId={document.ownerId}
              documentTypes={[document.documentType]}
              existingDocumentId={document.id}
            />
          ) : undefined
        }
        primaryAction={
          permissions.canDownload && preview ? (
            <Button variant="secondary" asChild>
              <a href={preview.url} target="_blank" rel="noopener noreferrer">
                <Download aria-hidden="true" />
                {t('document.access.download')}
              </a>
            </Button>
          ) : undefined
        }
      />

      <Tabs defaultValue="overview">
        <TabsList>
          <TabsTrigger value="overview">{t('common.labels.details')}</TabsTrigger>
          <TabsTrigger value="preview">{t('document.access.viewOriginal')}</TabsTrigger>
          <TabsTrigger value="versions">{t('document.list.versionHistory')}</TabsTrigger>
          <TabsTrigger value="review">{t('document.review.title')}</TabsTrigger>
          <TabsTrigger value="access">{t('document.list.accessLog')}</TabsTrigger>
        </TabsList>

        <TabsContent value="overview">
          <DetailList items={items} />
        </TabsContent>

        <TabsContent value="preview">
          {preview ? (
            <DocumentPreview url={preview.url} contentType={preview.contentType} />
          ) : (
            <p className="text-sm text-steel-600">{t('common.states.empty')}</p>
          )}
        </TabsContent>

        <TabsContent value="versions">
          <ul className="divide-y divide-steel-200 rounded-lg border border-steel-200">
            {versions.map((version) => {
              const versionReviews = reviewsByVersion.get(version.id) ?? []
              const latest = versionReviews[0]
              return (
                <li key={version.id} className="space-y-1 p-3 text-sm">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span className="font-semibold text-carbon">
                      {t('document.list.versionNumber', { number: version.versionNumber })} — {version.originalFilename}
                    </span>
                    <span className="text-xs text-steel-600">
                      {formatDateTime(version.createdAt, i18nLocale, timezone)} · {bytesToHuman(version.byteSize)}
                    </span>
                  </div>
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    {latest ? (
                      <StatusBadge kind="documentReview" value={latest.status} />
                    ) : (
                      <span className="text-xs text-steel-500">{t('document.reviewStatus.pending')}</span>
                    )}
                    {permissions.canDownload ? (
                      <DownloadVersionButton documentId={document.id} versionId={version.id} />
                    ) : null}
                  </div>
                </li>
              )
            })}
          </ul>
        </TabsContent>

        <TabsContent value="review">
          <DocumentReviewPanel document={document} reviews={reviews} reviewerNames={reviewerNames} canReview={permissions.canReview} />
        </TabsContent>

        <TabsContent value="access">
          {accessLog.length === 0 ? (
            <p className="text-sm text-steel-600">{t('common.states.empty')}</p>
          ) : (
            <ul className="divide-y divide-steel-200 rounded-lg border border-steel-200 text-sm">
              {accessLog.map((entry) => (
                <li key={entry.id} className="flex flex-wrap items-center justify-between gap-2 p-3">
                  <span>{t(`document.list.accessActions.${entry.action}`)}</span>
                  <span className="text-xs text-steel-600">{formatDateTime(entry.createdAt, i18nLocale, timezone)}</span>
                </li>
              ))}
            </ul>
          )}
        </TabsContent>
      </Tabs>
    </div>
  )
}

/** PDF via `<object>` with an iframe fallback and an explicit download link; images render inline. */
function DocumentPreview({ url, contentType }: { url: string; contentType: string }) {
  const t = useTranslate()

  if (contentType === 'image/png' || contentType === 'image/jpeg') {
    // eslint-disable-next-line @next/next/no-img-element -- signed, short-lived storage URL; next/image cannot proxy it
    return <img src={url} alt="" className="max-h-[70vh] rounded-lg border border-steel-200 object-contain" />
  }

  if (contentType === 'application/pdf') {
    return (
      <object data={url} type="application/pdf" className="h-[70vh] w-full rounded-lg border border-steel-200">
        <iframe src={url} title={t('document.access.viewOriginal')} className="h-[70vh] w-full rounded-lg border border-steel-200" />
        <p className="p-3 text-sm text-steel-600">
          <a href={url} target="_blank" rel="noopener noreferrer" className="text-navy-700 underline">
            {t('document.access.download')}
          </a>
        </p>
      </object>
    )
  }

  return (
    <p className="text-sm text-steel-600">
      <a href={url} target="_blank" rel="noopener noreferrer" className="text-navy-700 underline">
        {t('document.access.download')}
      </a>
    </p>
  )
}
