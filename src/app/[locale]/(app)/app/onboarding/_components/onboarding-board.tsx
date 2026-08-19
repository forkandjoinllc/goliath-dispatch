'use client'

import * as React from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { KanbanBoard } from '@/components/data/kanban-board'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/input'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { useToast } from '@/components/ui/toast'
import { useTranslate } from '@/components/providers/i18n-provider'
import {
  approveCarrierOnboarding,
  rejectCarrierOnboarding,
  reviewCarrierOnboarding,
  reactivateCarrierAction,
  submitCarrierOnboarding,
  suspendCarrierAction,
} from '@/server/carriers/actions'
import type { OnboardingBoard, OnboardingBoardCard } from '@/server/carriers/queries'
import { onboardingStatusEnum } from '@/db/schema/_shared'

type OnboardingStatus = (typeof onboardingStatusEnum.enumValues)[number]
type BoardItem = OnboardingBoardCard & { status: OnboardingStatus }

const REASON_REQUIRED: Partial<Record<OnboardingStatus, true>> = {
  corrections_required: true,
  rejected: true,
  suspended: true,
}

export interface OnboardingBoardClientProps {
  locale: string
  board: OnboardingBoard
  statuses: readonly OnboardingStatus[]
  permissions: { canSubmit: boolean; canReview: boolean; canApprove: boolean }
}

interface ActionResultLike {
  ok: boolean
  error?: { messageKey: string; params?: Record<string, string | number> }
}

/**
 * The 7-column onboarding kanban. Every move — pointer drag or the
 * keyboard "Move to <column>" menu `KanbanBoard` already provides — runs
 * the real transition action; an illegal move (e.g. draft straight to
 * approved) is refused server-side with `onboarding.errors.invalidTransition`
 * and surfaced as a toast rather than silently reverted, since the board only
 * reflects the real state once `router.refresh()` re-fetches it.
 */
export function OnboardingBoardClient({ locale, board, statuses, permissions }: OnboardingBoardClientProps) {
  const t = useTranslate()
  const router = useRouter()
  const { toast } = useToast()
  const [isPending, startTransition] = React.useTransition()
  const [pendingMove, setPendingMove] = React.useState<{ item: BoardItem; toStatus: OnboardingStatus } | null>(null)
  const [reason, setReason] = React.useState('')

  const items: BoardItem[] = statuses.flatMap((status) => board[status].map((card) => ({ ...card, status })))

  function reportError(result: ActionResultLike) {
    if (!result.ok && result.error) toast({ tone: 'error', title: t(result.error.messageKey, result.error.params) })
  }

  function commit(item: BoardItem, toStatus: OnboardingStatus, reasonValue?: string) {
    startTransition(async () => {
      let result: ActionResultLike
      if (toStatus === 'submitted') {
        result = await submitCarrierOnboarding({ carrierId: item.carrierId })
      } else if (toStatus === 'under_review') {
        result = await reviewCarrierOnboarding({ carrierId: item.carrierId, toStatus: 'under_review' })
      } else if (toStatus === 'corrections_required') {
        result = await reviewCarrierOnboarding({ carrierId: item.carrierId, toStatus: 'corrections_required', reason: reasonValue ?? '' })
      } else if (toStatus === 'approved' && item.status === 'suspended') {
        result = await reactivateCarrierAction({ carrierId: item.carrierId, reason: reasonValue ?? '' })
      } else if (toStatus === 'approved') {
        result = await approveCarrierOnboarding({ carrierId: item.carrierId })
      } else if (toStatus === 'rejected') {
        result = await rejectCarrierOnboarding({ carrierId: item.carrierId, reason: reasonValue ?? '' })
      } else if (toStatus === 'suspended') {
        result = await suspendCarrierAction({ carrierId: item.carrierId, reason: reasonValue ?? '' })
      } else {
        result = { ok: false, error: { messageKey: 'onboarding.errors.invalidTransition', params: { from: item.status, to: toStatus } } }
      }
      reportError(result)
      setPendingMove(null)
      setReason('')
      router.refresh()
    })
  }

  /**
   * Client-side hint only — `permissions` narrows which moves are offered so
   * a dispatcher without review/approval rights gets immediate feedback
   * instead of a round trip, but the server re-checks every one of these
   * permissions independently before applying the transition.
   */
  function isPermittedForTarget(toStatus: OnboardingStatus): boolean {
    if (toStatus === 'submitted') return permissions.canSubmit
    if (toStatus === 'under_review' || toStatus === 'corrections_required') return permissions.canReview
    // approved, rejected, suspended (incl. suspended → approved reactivation) all use `carrier:onboarding:approve`.
    return permissions.canApprove
  }

  function handleMove(itemId: string, toStatus: OnboardingStatus) {
    const item = items.find((c) => c.carrierId === itemId)
    if (!item) return
    if (!isPermittedForTarget(toStatus)) {
      toast({ tone: 'error', title: t('errors.forbidden') })
      return
    }
    if (REASON_REQUIRED[toStatus] || (toStatus === 'approved' && item.status === 'suspended')) {
      setPendingMove({ item, toStatus })
      return
    }
    commit(item, toStatus)
  }

  return (
    <div>
      <KanbanBoard<BoardItem, OnboardingStatus>
        columns={statuses.map((status) => ({ id: status, label: `${t(`onboarding.status.${status}`)} (${board[status].length})` }))}
        items={items}
        getItemId={(item) => item.carrierId}
        getItemColumn={(item) => item.status}
        onMove={handleMove}
        dragHandleLabel={(item) => `${t('onboarding.board.title')}: ${item.legalName}`}
        moveMenuLabel={(item) => item.legalName}
        moveToLabel={(columnLabel) => `${t('common.actions.confirm')} → ${columnLabel}`}
        announceMove={(item, columnLabel) => `${item.legalName} → ${columnLabel}`}
        className={isPending ? 'opacity-70' : undefined}
        renderCard={(item) => (
          <Link href={`/${locale}/app/carriers/${item.carrierId}`} className="block space-y-1.5 text-sm">
            <p className="font-semibold text-navy-700 hover:underline">{item.legalName}</p>
            <p className="font-mono text-xs text-steel-600">
              {t('carrier.fields.dotNumber')} {item.dotNumber}
            </p>
            <p className="text-xs text-steel-600">{item.assignedDispatcherName ?? t('onboarding.board.unassigned')}</p>
            <div className="flex flex-wrap gap-1">
              {item.missingDocuments.length > 0 ? (
                <Badge tone="warning">{t('onboarding.board.missingDocuments')}: {item.missingDocuments.length}</Badge>
              ) : null}
              {item.verificationProblems.length > 0 ? (
                <Badge tone="danger">{t('onboarding.board.verificationProblems')}: {item.verificationProblems.length}</Badge>
              ) : null}
              {item.documentsExpiringSoon.length > 0 ? (
                <Badge tone="warning">{t('onboarding.board.expiringSoon')}: {item.documentsExpiringSoon.length}</Badge>
              ) : null}
            </div>
          </Link>
        )}
      />

      {items.length === 0 ? <p className="mt-4 text-sm text-steel-600">{t('onboarding.board.noCards')}</p> : null}

      <Dialog open={pendingMove !== null} onOpenChange={(open) => !open && setPendingMove(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{pendingMove ? t(`onboarding.status.${pendingMove.toStatus}`) : ''}</DialogTitle>
            <DialogDescription>{t('onboarding.transitions.requestCorrections.reasonPlaceholder')}</DialogDescription>
          </DialogHeader>
          <Textarea value={reason} onChange={(e) => setReason(e.target.value)} rows={3} />
          <DialogFooter>
            <Button type="button" variant="secondary" onClick={() => setPendingMove(null)}>
              {t('common.actions.cancel')}
            </Button>
            <Button
              type="button"
              disabled={reason.trim().length === 0 || isPending}
              loading={isPending}
              onClick={() => pendingMove && commit(pendingMove.item, pendingMove.toStatus, reason)}
            >
              {t('common.actions.confirm')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
