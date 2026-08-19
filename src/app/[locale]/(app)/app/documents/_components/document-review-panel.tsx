'use client'

import * as React from 'react'
import { useRouter } from 'next/navigation'
import { CheckCircle2, XCircle } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/input'
import { Alert } from '@/components/ui/feedback'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { StatusBadge } from '@/components/status/status-badge'
import { useToast } from '@/components/ui/toast'
import { useI18n, useTranslate } from '@/components/providers/i18n-provider'
import { formatDateTime } from '@/i18n/translate'
import { reviewDocument } from '@/server/documents/actions'
import type { Document, DocumentReview } from '@/db/schema'

export interface DocumentReviewPanelProps {
  document: Document
  /** Newest first; only the most recent decision is highlighted. */
  reviews: DocumentReview[]
  reviewerNames: Record<string, string>
  canReview: boolean
  onReviewed?: () => void
}

/**
 * Shared approve/reject panel for the document domain. Any screen with a
 * document pending review (the tenant-wide documents queue, a carrier's
 * onboarding tab, an equipment or driver document list) mounts this against
 * one `Document` row — the review call, the required-rejection-reason rule
 * and the resulting status badge are handled once here.
 */
export function DocumentReviewPanel({ document, reviews, reviewerNames, canReview, onReviewed }: DocumentReviewPanelProps) {
  const t = useTranslate()
  const { locale, timezone } = useI18n()
  const router = useRouter()
  const { toast } = useToast()
  const [isPending, startTransition] = React.useTransition()
  const [rejectOpen, setRejectOpen] = React.useState(false)
  const [rejectionReason, setRejectionReason] = React.useState('')
  const [notes, setNotes] = React.useState('')

  const latestReview = reviews[0] ?? null
  const canDecide = canReview && (document.reviewStatus === 'pending' || document.reviewStatus === 'in_review')

  function submit(status: 'approved' | 'rejected') {
    startTransition(async () => {
      const result = await reviewDocument({
        documentId: document.id,
        status,
        notes: notes || undefined,
        rejectionReason: status === 'rejected' ? rejectionReason : undefined,
      })
      if (result.ok) {
        toast({ tone: 'success', title: t(status === 'approved' ? 'common.actions.approve' : 'common.actions.reject') })
        setRejectOpen(false)
        setRejectionReason('')
        setNotes('')
        onReviewed?.()
        router.refresh()
        return
      }
      toast({ tone: 'error', title: t(result.error.messageKey, result.error.params) })
    })
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h3 className="text-base font-bold text-carbon">{t('document.review.title')}</h3>
        <StatusBadge kind="documentReview" value={document.reviewStatus} />
      </div>

      {latestReview ? (
        <Alert tone={latestReview.status === 'approved' ? 'info' : 'danger'}>
          {t(latestReview.status === 'approved' ? 'document.review.approvedBy' : 'document.review.rejectedBy', {
            name: reviewerNames[latestReview.reviewerUserId] ?? latestReview.reviewerUserId,
            date: formatDateTime(latestReview.reviewedAt, locale, timezone),
          })}
          {latestReview.status === 'rejected' && latestReview.rejectionReason ? (
            <p className="mt-1 text-sm">{latestReview.rejectionReason}</p>
          ) : null}
        </Alert>
      ) : null}

      {canDecide ? (
        <div className="space-y-3">
          <div className="grid gap-1.5">
            <label htmlFor={`review-notes-${document.id}`} className="text-sm font-medium text-carbon">
              {t('document.review.notes')}
            </label>
            <Textarea
              id={`review-notes-${document.id}`}
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              rows={2}
            />
          </div>
          <div className="flex gap-2">
            <Button type="button" disabled={isPending} loading={isPending} onClick={() => submit('approved')}>
              <CheckCircle2 aria-hidden="true" />
              {t('document.review.approve')}
            </Button>
            <Button type="button" variant="destructive" disabled={isPending} onClick={() => setRejectOpen(true)}>
              <XCircle aria-hidden="true" />
              {t('document.review.reject')}
            </Button>
          </div>
        </div>
      ) : null}

      <Dialog open={rejectOpen} onOpenChange={setRejectOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t('document.review.reject')}</DialogTitle>
            <DialogDescription>{t('document.review.reasonPlaceholder')}</DialogDescription>
          </DialogHeader>
          <Textarea
            value={rejectionReason}
            onChange={(e) => setRejectionReason(e.target.value)}
            rows={3}
            placeholder={t('document.review.reasonPlaceholder')}
          />
          {rejectionReason.trim().length === 0 ? (
            <p className="text-xs text-danger-700">{t('document.review.reasonRequired')}</p>
          ) : null}
          <DialogFooter>
            <Button type="button" variant="secondary" onClick={() => setRejectOpen(false)}>
              {t('common.actions.cancel')}
            </Button>
            <Button
              type="button"
              variant="destructive"
              disabled={rejectionReason.trim().length === 0 || isPending}
              loading={isPending}
              onClick={() => submit('rejected')}
            >
              {t('document.review.reject')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
