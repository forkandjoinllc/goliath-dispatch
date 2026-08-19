'use client'

import * as React from 'react'
import { useRouter } from 'next/navigation'
import { Download, ShieldCheck, Trash2, Upload } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { EmptyState } from '@/components/ui/feedback'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog'
import { Badge } from '@/components/ui/badge'
import { StatusBadge } from '@/components/status/status-badge'
import { useToast } from '@/components/ui/toast'
import { useI18n, useTranslate } from '@/components/providers/i18n-provider'
import { formatDate } from '@/i18n/translate'
import type { DocumentWithCurrentVersion } from '@/server/documents/queries'
import { getDocumentDownloadUrl } from '@/server/documents/actions'
import { DocumentReviewPanel } from '../../../documents/_components/document-review-panel'
import { removeLoadDocumentAction, uploadLoadDocumentAction } from '@/server/loads/actions'
import type { DocumentReview, RateConfirmationAcceptance } from '@/db/schema'
import { RateConfirmationPanel } from './rate-confirmation-panel'

const DOCUMENT_TYPES = [
  'bol',
  'pod',
  'rate_confirmation',
  'receipt',
  'permit',
  'escort_document',
  'route_survey',
  'invoice',
  'lumper_receipt',
  'scale_ticket',
  'other',
] as const

/** Document types the Documents tab calls out specially — a load can't reach `pod_received` without an approved one of these. */
const KEY_DOCUMENT_TYPES = ['pod', 'bol'] as const

function readFileAsBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => {
      const result = reader.result as string
      resolve(result.slice(result.indexOf(',') + 1))
    }
    reader.onerror = () => reject(reader.error)
    reader.readAsDataURL(file)
  })
}

function UploadDialog({ loadId, open, onOpenChange }: { loadId: string; open: boolean; onOpenChange: (open: boolean) => void }) {
  const t = useTranslate()
  const router = useRouter()
  const { toast } = useToast()
  const [documentType, setDocumentType] = React.useState<(typeof DOCUMENT_TYPES)[number]>('other')
  const [file, setFile] = React.useState<File | null>(null)
  const [isPending, setPending] = React.useState(false)

  async function handleUpload() {
    if (!file) return
    setPending(true)
    const fileBase64 = await readFileAsBase64(file)
    // Goes through the load-specific action (`uploadLoadDocumentAction`), not
    // the generic document-upload action — only the load-specific path
    // creates the `load_documents` join row the POD gate and the rate
    // confirmation flow both depend on. See `server/loads/documents.ts`.
    const result = await uploadLoadDocumentAction({ loadId, documentType, originalFilename: file.name, fileBase64 })
    setPending(false)
    if (result.ok) {
      toast({ tone: 'success', title: t('load.documents.upload') })
      setFile(null)
      onOpenChange(false)
      router.refresh()
    } else {
      toast({ tone: 'error', title: t(result.error.messageKey, result.error.params) })
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent closeLabel={t('common.actions.close')}>
        <DialogHeader>
          <DialogTitle>{t('load.documents.upload')}</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <div className="grid gap-1.5">
            <Label>{t('common.labels.type')}</Label>
            <Select value={documentType} onValueChange={(v) => setDocumentType(v as (typeof DOCUMENT_TYPES)[number])}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {DOCUMENT_TYPES.map((type) => (
                  <SelectItem key={type} value={type}>
                    {t(`load.documents.types.${type}`)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="document-file">{t('common.actions.upload')}</Label>
            <input
              id="document-file"
              type="file"
              onChange={(event) => setFile(event.target.files?.[0] ?? null)}
              className="text-sm"
            />
          </div>
        </div>
        <DialogFooter>
          <Button type="button" variant="secondary" onClick={() => onOpenChange(false)}>
            {t('common.actions.cancel')}
          </Button>
          <Button type="button" disabled={!file} loading={isPending} onClick={handleUpload}>
            {t('common.actions.upload')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function ReviewDialog({
  document,
  reviews,
  reviewerLabels,
  open,
  onOpenChange,
}: {
  document: DocumentWithCurrentVersion
  reviews: DocumentReview[]
  reviewerLabels: Record<string, string>
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const t = useTranslate()
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent closeLabel={t('common.actions.close')}>
        <DialogHeader>
          <DialogTitle>{t('document.review.title')}</DialogTitle>
        </DialogHeader>
        <DocumentReviewPanel
          document={document}
          reviews={reviews}
          reviewerNames={reviewerLabels}
          canReview
          onReviewed={() => onOpenChange(false)}
        />
      </DialogContent>
    </Dialog>
  )
}

function keyDocumentStatus(
  documents: DocumentWithCurrentVersion[],
  documentType: (typeof KEY_DOCUMENT_TYPES)[number],
): 'missing' | 'pending' | 'approved' | 'rejected' {
  const matches = documents.filter((d) => d.documentType === documentType)
  if (matches.length === 0) return 'missing'
  if (matches.some((d) => d.reviewStatus === 'approved')) return 'approved'
  if (matches.every((d) => d.reviewStatus === 'rejected')) return 'rejected'
  return 'pending'
}

function KeyDocumentSummary({ documents }: { documents: DocumentWithCurrentVersion[] }) {
  const t = useTranslate()
  const toneFor = (status: ReturnType<typeof keyDocumentStatus>) =>
    status === 'approved' ? 'success' : status === 'rejected' ? 'danger' : status === 'pending' ? 'warning' : 'neutral'

  return (
    <div className="flex flex-wrap gap-3">
      {KEY_DOCUMENT_TYPES.map((type) => {
        const status = keyDocumentStatus(documents, type)
        return (
          <div key={type} className="flex items-center gap-2 rounded-lg border border-steel-200 px-3 py-2">
            <ShieldCheck aria-hidden="true" className="size-4 text-steel-500" />
            <span className="text-sm font-semibold text-carbon">{t(`load.documents.types.${type}`)}</span>
            <Badge tone={toneFor(status)}>{t(`load.documents.keyStatus.${status}`)}</Badge>
          </div>
        )
      })}
    </div>
  )
}

export function DocumentsTab({
  loadId,
  documents,
  documentReviews,
  reviewerLabels,
  rateConfirmationDecisions,
  decisionActorLabels,
  canUpload,
  canReview,
  canRespond,
}: {
  loadId: string
  documents: DocumentWithCurrentVersion[]
  documentReviews: DocumentReview[]
  reviewerLabels: Record<string, string>
  rateConfirmationDecisions: RateConfirmationAcceptance[]
  decisionActorLabels: Record<string, string>
  canUpload: boolean
  canReview: boolean
  canRespond: boolean
}) {
  const t = useTranslate()
  const router = useRouter()
  const { toast } = useToast()
  const { locale } = useI18n()
  const [uploadOpen, setUploadOpen] = React.useState(false)
  const [reviewingDocumentId, setReviewingDocumentId] = React.useState<string | null>(null)
  const [isRemoving, setIsRemoving] = React.useState<string | null>(null)

  async function handleDownload(documentId: string) {
    const result = await getDocumentDownloadUrl({ documentId })
    if (result.ok) {
      window.open(result.data.url, '_blank', 'noopener,noreferrer')
    } else {
      toast({ tone: 'error', title: t(result.error.messageKey, result.error.params) })
    }
  }

  async function handleRemove(documentId: string) {
    if (!window.confirm(t('load.documents.confirmRemove'))) return
    setIsRemoving(documentId)
    const result = await removeLoadDocumentAction({ loadId, documentId })
    setIsRemoving(null)
    if (result.ok) {
      toast({ tone: 'success', title: t('load.documents.removed') })
      router.refresh()
    } else {
      toast({ tone: 'error', title: t(result.error.messageKey, result.error.params) })
    }
  }

  const rateConfirmationDoc = documents.find((d) => d.documentType === 'rate_confirmation') ?? null
  const reviewingDocument = documents.find((d) => d.id === reviewingDocumentId) ?? null

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h3 className="text-base font-bold text-carbon">{t('load.documents.title')}</h3>
        {canUpload ? (
          <Button size="sm" onClick={() => setUploadOpen(true)}>
            <Upload aria-hidden="true" />
            {t('load.documents.upload')}
          </Button>
        ) : null}
      </div>

      <KeyDocumentSummary documents={documents} />

      {documents.length === 0 ? (
        <EmptyState title={t('load.documents.empty')} />
      ) : (
        <ul className="divide-y divide-steel-200 rounded-lg border border-steel-200">
          {documents.map((document) => (
            <li key={document.id} className="flex flex-wrap items-center justify-between gap-3 p-3">
              <div>
                <p className="font-semibold text-carbon">
                  {document.title ?? t(`load.documents.types.${document.documentType}`)}
                  {(KEY_DOCUMENT_TYPES as readonly string[]).includes(document.documentType) ? (
                    <Badge tone="info" className="ml-2">
                      {t(`load.documents.types.${document.documentType}`)}
                    </Badge>
                  ) : null}
                </p>
                <p className="text-xs text-steel-600">
                  {t(`load.documents.types.${document.documentType}`)}
                  {document.expirationDate ? ` · ${formatDate(document.expirationDate, locale, 'UTC')}` : ''}
                </p>
              </div>
              <div className="flex items-center gap-2">
                <StatusBadge kind="documentReview" value={document.reviewStatus} />
                {canReview ? (
                  <Button variant="ghost" size="sm" onClick={() => setReviewingDocumentId(document.id)}>
                    {t('document.review.title')}
                  </Button>
                ) : null}
                {document.currentVersion ? (
                  <Button variant="ghost" size="iconSm" aria-label={t('common.actions.download')} onClick={() => handleDownload(document.id)}>
                    <Download aria-hidden="true" />
                  </Button>
                ) : null}
                {canUpload ? (
                  <Button
                    variant="ghost"
                    size="iconSm"
                    aria-label={t('common.actions.delete')}
                    disabled={isRemoving === document.id}
                    onClick={() => handleRemove(document.id)}
                  >
                    <Trash2 aria-hidden="true" />
                  </Button>
                ) : null}
              </div>
            </li>
          ))}
        </ul>
      )}

      {canUpload ? <UploadDialog loadId={loadId} open={uploadOpen} onOpenChange={setUploadOpen} /> : null}

      {reviewingDocument ? (
        <ReviewDialog
          document={reviewingDocument}
          reviews={documentReviews.filter((r) => r.documentId === reviewingDocument.id)}
          reviewerLabels={reviewerLabels}
          open={reviewingDocumentId != null}
          onOpenChange={(open) => setReviewingDocumentId(open ? reviewingDocumentId : null)}
        />
      ) : null}

      <div className="border-t border-steel-200 pt-6">
        <RateConfirmationPanel
          loadId={loadId}
          document={rateConfirmationDoc}
          decisions={rateConfirmationDecisions}
          actorLabels={decisionActorLabels}
          canRespond={canRespond}
          onDownload={handleDownload}
        />
      </div>
    </div>
  )
}

export { DOCUMENT_TYPES }
