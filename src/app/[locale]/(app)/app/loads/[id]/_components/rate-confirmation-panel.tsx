'use client'

import * as React from 'react'
import { useRouter } from 'next/navigation'
import { Download } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { EmptyState } from '@/components/ui/feedback'
import { useToast } from '@/components/ui/toast'
import { useI18n, useTranslate } from '@/components/providers/i18n-provider'
import { formatDateTime } from '@/i18n/translate'
import type { RateConfirmationAcceptance } from '@/db/schema'
import type { DocumentWithCurrentVersion } from '@/server/documents/queries'
import { recordRateConfirmationDecisionAction } from '@/server/loads/actions'

export function RateConfirmationPanel({
  loadId,
  document,
  decisions,
  actorLabels,
  canRespond,
  onDownload,
}: {
  loadId: string
  document: DocumentWithCurrentVersion | null
  decisions: RateConfirmationAcceptance[]
  actorLabels: Record<string, string>
  canRespond: boolean
  onDownload: (documentId: string) => void
}) {
  const t = useTranslate()
  const router = useRouter()
  const { toast } = useToast()
  const { locale, timezone } = useI18n()
  const [reason, setReason] = React.useState('')
  const [isPending, setPending] = React.useState(false)

  async function submit(decision: 'accepted' | 'rejected' | 'changes_requested') {
    if (decision !== 'accepted' && reason.trim().length === 0) return
    setPending(true)
    const result = await recordRateConfirmationDecisionAction({ loadId, decision, reason: reason.trim() || null })
    setPending(false)
    if (result.ok) {
      setReason('')
      toast({ tone: 'success', title: t(`load.documents.rateConfirmation.decision.${decision}`) })
      router.refresh()
    } else {
      toast({ tone: 'error', title: t(result.error.messageKey, result.error.params) })
    }
  }

  return (
    <div className="space-y-4">
      <div>
        <h3 className="text-base font-bold text-carbon">{t('load.documents.rateConfirmation.title')}</h3>
        <p className="text-sm text-steel-600">{t('load.documents.rateConfirmation.description')}</p>
      </div>

      {!document ? (
        <EmptyState title={t('load.documents.rateConfirmation.noRateConfirmation')} />
      ) : (
        <>
          <Button variant="secondary" size="sm" onClick={() => onDownload(document.id)}>
            <Download aria-hidden="true" />
            {document.currentVersion ? t('load.documents.rateConfirmation.documentVersion', { version: document.currentVersion.versionNumber }) : document.title}
          </Button>

          {canRespond ? (
            <div className="space-y-3 rounded-lg border border-steel-200 p-3">
              <div className="grid gap-1.5">
                <Label htmlFor="rate-conf-reason">{t('load.documents.rateConfirmation.reasonLabel')}</Label>
                <Textarea
                  id="rate-conf-reason"
                  value={reason}
                  onChange={(event) => setReason(event.target.value)}
                  rows={2}
                />
                <p className="text-xs text-steel-600">{t('load.documents.rateConfirmation.reasonRequiredHint')}</p>
              </div>
              <div className="flex flex-wrap gap-2">
                <Button size="sm" disabled={isPending} onClick={() => submit('accepted')}>
                  {t('load.documents.rateConfirmation.accept')}
                </Button>
                <Button
                  variant="secondary"
                  size="sm"
                  disabled={isPending || reason.trim().length === 0}
                  onClick={() => submit('changes_requested')}
                >
                  {t('load.documents.rateConfirmation.requestChanges')}
                </Button>
                <Button
                  variant="destructive"
                  size="sm"
                  disabled={isPending || reason.trim().length === 0}
                  onClick={() => submit('rejected')}
                >
                  {t('load.documents.rateConfirmation.reject')}
                </Button>
              </div>
            </div>
          ) : null}
        </>
      )}

      {decisions.length > 0 ? (
        <div>
          <h4 className="mb-2 text-sm font-bold text-carbon">{t('load.documents.rateConfirmation.history')}</h4>
          <ul data-testid="rate-confirmation-history" className="divide-y divide-steel-200 rounded-lg border border-steel-200">
            {decisions.map((decision) => (
              <li key={decision.id} className="p-3 text-sm">
                <p className="font-semibold text-carbon">{t(`load.documents.rateConfirmation.decision.${decision.decision}`)}</p>
                <p className="text-xs text-steel-600">
                  {t('load.documents.rateConfirmation.decisionRecorded', {
                    date: formatDateTime(decision.decidedAt, locale, timezone),
                    actor: actorLabels[decision.actorUserId] ?? decision.actorUserId,
                  })}
                </p>
                {decision.decisionReason ? <p className="mt-1 text-sm text-carbon">{decision.decisionReason}</p> : null}
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  )
}
