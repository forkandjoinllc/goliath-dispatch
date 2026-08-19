'use client'

import { Download } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { EmptyState } from '@/components/ui/feedback'
import { StatusBadge } from '@/components/status/status-badge'
import { useToast } from '@/components/ui/toast'
import { useI18n, useTranslate } from '@/components/providers/i18n-provider'
import { formatDateTime } from '@/i18n/translate'
import { downloadSignatureCertificateAction } from '@/server/signatures/actions'
import type { Carrier } from '@/db/schema'
import type { SignatureRequestWithTemplate } from '@/server/signatures/queries'
import { SendForSignatureDialog } from '../../signatures/_components/send-for-signature-dialog'

export interface CarrierSignaturesPanelProps {
  carrier: Carrier
  requests: SignatureRequestWithTemplate[]
  canSend: boolean
}

/** Maps a signature request's lifecycle status onto the shared `documentReview` badge vocabulary for display. */
function signatureStatusToReviewStatus(
  status: SignatureRequestWithTemplate['status'],
): 'pending' | 'in_review' | 'approved' | 'rejected' | 'expired' | 'superseded' {
  switch (status) {
    case 'signed':
      return 'approved'
    case 'declined':
    case 'voided':
      return 'rejected'
    case 'viewed':
      return 'in_review'
    case 'expired':
      return 'expired'
    case 'superseded':
      return 'superseded'
    default:
      return 'pending'
  }
}

export function CarrierSignaturesPanel({ carrier, requests, canSend }: CarrierSignaturesPanelProps) {
  const t = useTranslate()
  const { locale, timezone } = useI18n()
  const { toast } = useToast()

  async function handleDownloadCertificate(requestId: string) {
    const result = await downloadSignatureCertificateAction({ requestId })
    if (result.ok) {
      window.open(result.data.url, '_blank', 'noopener,noreferrer')
    } else {
      toast({ tone: 'error', title: t(result.error.messageKey, result.error.params) })
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h3 className="text-base font-bold text-carbon">{t('carrier.signatures.title')}</h3>
        {canSend ? (
          <SendForSignatureDialog
            subjectType="carrier"
            subjectId={carrier.id}
            carrierId={carrier.id}
            defaultSignerEmail={carrier.email}
            defaultSignerName={`${carrier.contactFirstName} ${carrier.contactLastName}`}
            defaultLocale={carrier.preferredLocale}
            defaultTokenValues={{
              carrierLegalName: carrier.legalName,
              carrierDotNumber: carrier.dotNumber,
            }}
          />
        ) : null}
      </div>

      {requests.length === 0 ? (
        <EmptyState title={t('common.states.empty')} />
      ) : (
        <ul className="divide-y divide-steel-200 rounded-lg border border-steel-200">
          {requests.map((request) => (
            <li key={request.id} className="flex flex-wrap items-center justify-between gap-3 p-3">
              <div>
                <p className="font-semibold text-carbon">
                  {(locale === 'es' ? request.template?.titleEs : request.template?.titleEn) ?? request.template?.templateKey ?? ''}
                </p>
                <p className="text-xs text-steel-600">
                  {request.signerLegalName ?? request.signerEmail} · {request.signerEmail} · {formatDateTime(request.requestedAt, locale, timezone)}
                </p>
              </div>
              <div className="flex items-center gap-2">
                <StatusBadge kind="documentReview" value={signatureStatusToReviewStatus(request.status)} />
                {request.status === 'signed' ? (
                  <Button variant="ghost" size="iconSm" aria-label={t('document.access.download')} onClick={() => handleDownloadCertificate(request.id)}>
                    <Download aria-hidden="true" />
                  </Button>
                ) : null}
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
