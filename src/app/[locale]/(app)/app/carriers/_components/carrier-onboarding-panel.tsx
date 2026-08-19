'use client'

import * as React from 'react'
import { useRouter } from 'next/navigation'
import { CheckCircle2, Circle, FileWarning } from 'lucide-react'
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
import { Timeline, type TimelineEvent } from '@/components/data/timeline'
import { useToast } from '@/components/ui/toast'
import { useI18n, useTranslate } from '@/components/providers/i18n-provider'
import { formatDateTime } from '@/i18n/translate'
import {
  approveCarrierOnboarding,
  rejectCarrierOnboarding,
  reviewCarrierOnboarding,
  submitCarrierOnboarding,
  suspendCarrierAction,
  reactivateCarrierAction,
} from '@/server/carriers/actions'
import type { Carrier, CarrierOnboarding } from '@/db/schema'

type OnboardingStatus = CarrierOnboarding['status']

interface OnboardingEventRow {
  id: string
  fromStatus: OnboardingStatus | null
  toStatus: OnboardingStatus
  actorUserId: string | null
  reason: string | null
  createdAt: Date
}

export interface CarrierOnboardingPanelProps {
  carrier: Carrier
  onboarding: CarrierOnboarding
  missingDocuments: string[]
  events: OnboardingEventRow[]
  actorNames: Record<string, string>
  permissions: {
    canSubmit: boolean
    canReview: boolean
    canApprove: boolean
    canSuspend: boolean
  }
}

type PendingAction =
  | { kind: 'startReview' }
  | { kind: 'requestCorrections' }
  | { kind: 'approve' }
  | { kind: 'reject' }
  | { kind: 'suspend' }
  | { kind: 'reactivate' }

/**
 * The full onboarding workflow for one carrier: required-document checklist,
 * every legal transition available from the current status (mirroring
 * `ONBOARDING_TRANSITIONS` in `server/carriers/service.ts` purely to decide
 * which buttons to show — the server re-validates on every submit) and the
 * `carrierOnboardingEvents` timeline.
 */
export function CarrierOnboardingPanel({
  carrier,
  onboarding,
  missingDocuments,
  events,
  actorNames,
  permissions,
}: CarrierOnboardingPanelProps) {
  const t = useTranslate()
  const { locale, timezone } = useI18n()
  const router = useRouter()
  const { toast } = useToast()
  const [isPending, startTransition] = React.useTransition()
  const [pending, setPending] = React.useState<PendingAction | null>(null)
  const [reason, setReason] = React.useState('')

  function runToast(actionKey: string) {
    toast({ tone: 'success', title: t(`onboarding.transitions.${actionKey}.action`) })
  }

  function submitAction(promise: Promise<unknown>, actionKey: string) {
    startTransition(async () => {
      const result = await promise
      const ok = (result as { ok: boolean }).ok
      if (ok) {
        runToast(actionKey)
        setPending(null)
        setReason('')
        router.refresh()
        return
      }
      const error = (result as { error: { messageKey: string; params?: Record<string, string | number> } }).error
      toast({ tone: 'error', title: t(error.messageKey, error.params) })
    })
  }

  function handleSubmitOnboarding() {
    submitAction(submitCarrierOnboarding({ carrierId: carrier.id }), 'submit')
  }

  function handleStartReview() {
    submitAction(reviewCarrierOnboarding({ carrierId: carrier.id, toStatus: 'under_review' }), 'startReview')
  }

  function handleRequestCorrections() {
    submitAction(
      reviewCarrierOnboarding({ carrierId: carrier.id, toStatus: 'corrections_required', reason }),
      'requestCorrections',
    )
  }

  function handleApprove() {
    submitAction(approveCarrierOnboarding({ carrierId: carrier.id }), 'approve')
  }

  function handleReject() {
    submitAction(rejectCarrierOnboarding({ carrierId: carrier.id, reason }), 'reject')
  }

  function handleSuspend() {
    submitAction(suspendCarrierAction({ carrierId: carrier.id, reason }), 'suspend')
  }

  function handleReactivate() {
    submitAction(reactivateCarrierAction({ carrierId: carrier.id, reason }), 'reactivate')
  }

  const status = onboarding.status
  const timelineEvents: TimelineEvent[] = events.map((event) => ({
    id: event.id,
    time: formatDateTime(event.createdAt, locale, timezone),
    actor: event.actorUserId ? actorNames[event.actorUserId] ?? undefined : undefined,
    description: (
      <span>
        {event.fromStatus ? `${t(`onboarding.status.${event.fromStatus}`)} → ` : ''}
        {t(`onboarding.status.${event.toStatus}`)}
        {event.reason ? <span className="block text-steel-600">{event.reason}</span> : null}
      </span>
    ),
    tone: event.toStatus === 'rejected' || event.toStatus === 'corrections_required' ? 'danger' : event.toStatus === 'approved' ? 'success' : 'neutral',
  }))

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h3 className="text-base font-bold text-carbon">{t('onboarding.checklist.title')}</h3>
          <p className="text-sm text-steel-600">{t(`onboarding.statusDescription.${status}`)}</p>
        </div>
        <StatusBadge kind="onboarding" value={status} />
      </div>

      {onboarding.correctionNotes && status === 'corrections_required' ? (
        <Alert tone="warning" title={t('onboarding.transitions.requestCorrections.reasonLabel')}>
          {onboarding.correctionNotes}
        </Alert>
      ) : null}
      {onboarding.rejectionReason && status === 'rejected' ? (
        <Alert tone="danger" title={t('onboarding.transitions.reject.reasonLabel')}>
          {onboarding.rejectionReason}
        </Alert>
      ) : null}
      {carrier.suspensionReason && status === 'suspended' ? (
        <Alert tone="danger" title={t('onboarding.transitions.suspend.reasonLabel')}>
          {carrier.suspensionReason}
        </Alert>
      ) : null}

      <ul className="divide-y divide-steel-200 rounded-lg border border-steel-200">
        {onboarding.requiredDocumentTypes.map((docType) => {
          const complete = !missingDocuments.includes(docType)
          return (
            <li key={docType} className="flex items-center gap-3 p-3 text-sm">
              {complete ? (
                <CheckCircle2 className="size-4 shrink-0 text-success-600" aria-hidden="true" />
              ) : (
                <Circle className="size-4 shrink-0 text-steel-400" aria-hidden="true" />
              )}
              <span className="flex-1">{t.optional(`onboarding.checklist.${docType}`) ?? docType}</span>
              <span className={complete ? 'text-xs font-semibold text-success-700' : 'text-xs font-semibold text-steel-500'}>
                {t(complete ? 'onboarding.checklist.complete' : 'onboarding.checklist.incomplete')}
              </span>
            </li>
          )
        })}
      </ul>

      {missingDocuments.length > 0 ? (
        <Alert tone="warning">
          <span className="flex items-center gap-2">
            <FileWarning className="size-4" aria-hidden="true" />
            {t('onboarding.errors.missingDocuments', { documents: missingDocuments.join(', ') })}
          </span>
        </Alert>
      ) : null}

      <div className="flex flex-wrap gap-2">
        {permissions.canSubmit && (status === 'draft' || status === 'corrections_required') ? (
          <Button type="button" disabled={isPending || missingDocuments.length > 0} loading={isPending} onClick={handleSubmitOnboarding}>
            {t('onboarding.transitions.submit.action')}
          </Button>
        ) : null}
        {permissions.canReview && status === 'submitted' ? (
          <Button type="button" variant="secondary" disabled={isPending} loading={isPending} onClick={handleStartReview}>
            {t('onboarding.transitions.startReview.action')}
          </Button>
        ) : null}
        {permissions.canReview && (status === 'submitted' || status === 'under_review') ? (
          <Button type="button" variant="secondary" disabled={isPending} onClick={() => setPending({ kind: 'requestCorrections' })}>
            {t('onboarding.transitions.requestCorrections.action')}
          </Button>
        ) : null}
        {permissions.canApprove && (status === 'submitted' || status === 'under_review') ? (
          <Button type="button" disabled={isPending} loading={isPending} onClick={handleApprove}>
            {t('onboarding.transitions.approve.action')}
          </Button>
        ) : null}
        {permissions.canApprove && (status === 'submitted' || status === 'under_review') ? (
          <Button type="button" variant="destructive" disabled={isPending} onClick={() => setPending({ kind: 'reject' })}>
            {t('onboarding.transitions.reject.action')}
          </Button>
        ) : null}
        {permissions.canSuspend && status === 'approved' ? (
          <Button type="button" variant="destructive" disabled={isPending} onClick={() => setPending({ kind: 'suspend' })}>
            {t('onboarding.transitions.suspend.action')}
          </Button>
        ) : null}
        {permissions.canSuspend && status === 'suspended' ? (
          <Button type="button" disabled={isPending} onClick={() => setPending({ kind: 'reactivate' })}>
            {t('onboarding.transitions.reactivate.action')}
          </Button>
        ) : null}
      </div>

      <div className="border-t border-steel-200 pt-6">
        <h4 className="mb-3 text-sm font-bold text-carbon">{t('common.labels.details')}</h4>
        {timelineEvents.length > 0 ? <Timeline events={timelineEvents} /> : <p className="text-sm text-steel-600">{t('common.states.empty')}</p>}
      </div>

      <Dialog open={pending !== null} onOpenChange={(open) => !open && setPending(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {pending ? t(`onboarding.transitions.${dialogKey(pending.kind)}.action`) : ''}
            </DialogTitle>
            <DialogDescription>
              {pending ? t(`onboarding.transitions.${dialogKey(pending.kind)}.confirm`) : ''}
            </DialogDescription>
          </DialogHeader>
          {pending && pending.kind !== 'startReview' ? (
            <Textarea
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              rows={3}
              placeholder={t(`onboarding.transitions.${dialogKey(pending.kind)}.reasonPlaceholder`)}
            />
          ) : null}
          <DialogFooter>
            <Button type="button" variant="secondary" onClick={() => setPending(null)}>
              {t('common.actions.cancel')}
            </Button>
            <Button
              type="button"
              variant={pending?.kind === 'reject' || pending?.kind === 'suspend' ? 'destructive' : 'primary'}
              disabled={isPending || (pending?.kind !== 'reactivate' && reason.trim().length === 0)}
              loading={isPending}
              onClick={() => {
                if (!pending) return
                if (pending.kind === 'requestCorrections') handleRequestCorrections()
                else if (pending.kind === 'reject') handleReject()
                else if (pending.kind === 'suspend') handleSuspend()
                else if (pending.kind === 'reactivate') handleReactivate()
              }}
            >
              {t('common.actions.confirm')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}

function dialogKey(kind: PendingAction['kind']): string {
  return kind
}
