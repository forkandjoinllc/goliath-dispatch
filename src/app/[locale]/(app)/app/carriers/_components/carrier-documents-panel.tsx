'use client'

import * as React from 'react'
import { Download, History } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { EmptyState } from '@/components/ui/feedback'
import { StatusBadge } from '@/components/status/status-badge'
import { ExpiryBadge } from '@/components/status/expiry-badge'
import { useToast } from '@/components/ui/toast'
import { useTranslate } from '@/components/providers/i18n-provider'
import { getDocumentDownloadUrl } from '@/server/documents/actions'
import type { DocumentReview } from '@/db/schema'
import type { DocumentWithCurrentVersion } from '@/server/documents/queries'
import { DocumentUploadDialog } from '../../documents/_components/document-upload-dialog'
import { DocumentReviewPanel } from '../../documents/_components/document-review-panel'

export interface CarrierDocumentsPanelProps {
  carrierId: string
  documents: DocumentWithCurrentVersion[]
  requiredDocumentTypes: readonly string[]
  reviewsByDocument: Record<string, DocumentReview[]>
  reviewerNames: Record<string, string>
  canUpload: boolean
  canReview: boolean
}

const ALL_ONBOARDING_DOCUMENT_TYPES = [
  'certificate_of_authority',
  'certificate_of_insurance',
  'w9',
  'notice_of_assignment',
  'change_of_payee',
  'carrier_agreement',
  'other_onboarding',
] as const

export function CarrierDocumentsPanel({
  carrierId,
  documents,
  reviewsByDocument,
  reviewerNames,
  canUpload,
  canReview,
}: CarrierDocumentsPanelProps) {
  const t = useTranslate()
  const { toast } = useToast()
  const [expandedId, setExpandedId] = React.useState<string | null>(null)

  async function handleDownload(documentId: string) {
    const result = await getDocumentDownloadUrl({ documentId })
    if (result.ok) {
      window.open(result.data.url, '_blank', 'noopener,noreferrer')
    } else {
      toast({ tone: 'error', title: t(result.error.messageKey, result.error.params) })
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h3 className="text-base font-bold text-carbon">{t('document.upload.title')}</h3>
        {canUpload ? (
          <DocumentUploadDialog
            ownerType="carrier"
            ownerId={carrierId}
            documentTypes={ALL_ONBOARDING_DOCUMENT_TYPES}
            allowMarkRequired
          />
        ) : null}
      </div>

      {documents.length === 0 ? (
        <EmptyState title={t('common.states.empty')} />
      ) : (
        <ul className="space-y-2">
          {documents.map((document) => {
            const expanded = expandedId === document.id
            return (
              <li key={document.id} className="rounded-lg border border-steel-200">
                <div className="flex flex-wrap items-center justify-between gap-3 p-3">
                  <div>
                    <p className="font-semibold text-carbon">{document.title ?? t(`document.types.${document.documentType}`)}</p>
                    <p className="text-xs text-steel-600">{t(`document.types.${document.documentType}`)}</p>
                  </div>
                  <div className="flex items-center gap-2">
                    <StatusBadge kind="documentReview" value={document.reviewStatus} />
                    {document.expirationDate ? <ExpiryBadge date={document.expirationDate} /> : null}
                    {document.currentVersion ? (
                      <Button
                        variant="ghost"
                        size="iconSm"
                        aria-label={t('document.access.download')}
                        onClick={() => handleDownload(document.id)}
                      >
                        <Download aria-hidden="true" />
                      </Button>
                    ) : null}
                    {canUpload ? (
                      <DocumentUploadDialog
                        ownerType="carrier"
                        ownerId={carrierId}
                        documentTypes={[document.documentType]}
                        existingDocumentId={document.id}
                        trigger={
                          <Button variant="ghost" size="iconSm" aria-label={t('document.upload.title')}>
                            <History aria-hidden="true" />
                          </Button>
                        }
                      />
                    ) : null}
                    <Button variant="ghost" size="sm" onClick={() => setExpandedId(expanded ? null : document.id)}>
                      {t(expanded ? 'common.actions.close' : 'document.review.title')}
                    </Button>
                  </div>
                </div>
                {expanded ? (
                  <div className="border-t border-steel-200 p-3">
                    <DocumentReviewPanel
                      document={document}
                      reviews={reviewsByDocument[document.id] ?? []}
                      reviewerNames={reviewerNames}
                      canReview={canReview}
                    />
                  </div>
                ) : null}
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}
