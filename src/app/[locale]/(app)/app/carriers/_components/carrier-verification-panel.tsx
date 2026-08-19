'use client'

import * as React from 'react'
import { useRouter } from 'next/navigation'
import { RefreshCw, ShieldCheck } from 'lucide-react'
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
import { DetailList, type DetailItem } from '@/components/data/detail-list'
import { StatusBadge } from '@/components/status/status-badge'
import { useToast } from '@/components/ui/toast'
import { useI18n, useTranslate } from '@/components/providers/i18n-provider'
import { formatDateTime } from '@/i18n/translate'
import { overrideCarrierFmcsaVerification, runCarrierFmcsaVerification } from '@/server/verification/actions'
import type { Carrier, FmcsaVerification } from '@/db/schema'

export interface CarrierVerificationPanelProps {
  carrier: Carrier
  latest: FmcsaVerification | null
  history: FmcsaVerification[]
  canRun: boolean
  canOverride: boolean
}

/**
 * Field-by-field entered-vs-FMCSA-reported comparison, the re-verification
 * trigger and the Admin/Accounting override dialog. `mismatches` on the
 * latest `fmcsaVerifications` row already carries the exact field/entered/
 * reported triples the compliance gate reads — this renders that ledger
 * directly rather than recomputing it.
 */
export function CarrierVerificationPanel({ carrier, latest, history, canRun, canOverride }: CarrierVerificationPanelProps) {
  const t = useTranslate()
  const { locale, timezone } = useI18n()
  const router = useRouter()
  const { toast } = useToast()
  const [isPending, startTransition] = React.useTransition()
  const [overrideOpen, setOverrideOpen] = React.useState(false)
  const [reason, setReason] = React.useState('')

  function handleRun() {
    startTransition(async () => {
      const result = await runCarrierFmcsaVerification({ carrierId: carrier.id })
      if (result.ok) {
        toast({ tone: 'success', title: t('carrier.fmcsa.runVerification') })
        router.refresh()
        return
      }
      toast({ tone: 'error', title: t(result.error.messageKey, result.error.params) })
    })
  }

  function handleOverride() {
    if (!latest) return
    startTransition(async () => {
      const result = await overrideCarrierFmcsaVerification({ carrierId: carrier.id, verificationId: latest.id, reason })
      if (result.ok) {
        toast({ tone: 'success', title: t('carrier.fmcsa.override.confirm') })
        setOverrideOpen(false)
        setReason('')
        router.refresh()
        return
      }
      toast({ tone: 'error', title: t(result.error.messageKey, result.error.params) })
    })
  }

  const enteredVsReportedItems: DetailItem[] = [
    { key: 'dotNumber', label: t('carrier.fmcsa.mismatchField.dotNumber'), value: carrier.dotNumber },
    { key: 'mcNumber', label: t('carrier.fmcsa.mismatchField.mcNumber'), value: carrier.mcNumber ?? t('common.labels.none') },
    { key: 'legalName', label: t('carrier.fmcsa.mismatchField.legalName'), value: carrier.legalName },
  ]

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h3 className="text-base font-bold text-carbon">{t('carrier.fmcsa.title')}</h3>
          {latest ? (
            <p className="text-sm text-steel-600">
              {t('carrier.fmcsa.lastVerifiedAt')}: {formatDateTime(latest.checkedAt, locale, timezone)}
              {carrier.fmcsaNextVerificationAt ? ` · ${t('carrier.fmcsa.nextVerificationAt')}: ${formatDateTime(carrier.fmcsaNextVerificationAt, locale, timezone)}` : ''}
            </p>
          ) : null}
        </div>
        <StatusBadge kind="verification" value={carrier.fmcsaStatus} />
      </div>

      {canRun ? (
        <Button type="button" variant="secondary" disabled={isPending} loading={isPending} onClick={handleRun}>
          <RefreshCw aria-hidden="true" />
          {t('carrier.fmcsa.runVerification')}
        </Button>
      ) : null}

      {carrier.fmcsaStatus === 'verified' ? (
        <Alert tone="info">
          <span className="flex items-center gap-2">
            <ShieldCheck className="size-4" aria-hidden="true" />
            {t('carrier.fmcsa.resultVerified')}
          </span>
        </Alert>
      ) : null}
      {carrier.fmcsaStatus === 'mismatch' ? <Alert tone="danger">{t('carrier.fmcsa.resultMismatch')}</Alert> : null}
      {carrier.fmcsaStatus === 'failed' ? <Alert tone="danger">{t('carrier.fmcsa.resultFailed')}</Alert> : null}
      {carrier.fmcsaStatus === 'manually_overridden' && latest?.overriddenByUserId ? (
        <Alert tone="warning">
          {t('carrier.fmcsa.resultManuallyOverridden', {
            overriddenBy: latest.overriddenByUserId,
            overriddenAt: latest.overriddenAt ? formatDateTime(latest.overriddenAt, locale, timezone) : '',
          })}
        </Alert>
      ) : null}

      <div>
        <h4 className="mb-2 text-sm font-bold text-carbon">{t('common.labels.details')}</h4>
        <DetailList items={enteredVsReportedItems} />
      </div>

      {latest && latest.mismatches.length > 0 ? (
        <div>
          <h4 className="mb-2 text-sm font-bold text-carbon">{t('carrier.fmcsa.title')} — {t('nav.status.verification.mismatch')}</h4>
          <ul className="divide-y divide-steel-200 rounded-lg border border-steel-200 text-sm">
            {latest.mismatches.map((mismatch, index) => (
              <li key={`${mismatch.field}-${index}`} className="grid grid-cols-3 gap-2 p-3">
                <span className="font-semibold text-carbon">
                  {t.optional(`carrier.fmcsa.mismatchField.${mismatch.field}`) ?? mismatch.field}
                </span>
                <span>{mismatch.entered ?? t('common.labels.none')}</span>
                <span className="text-steel-600">{mismatch.reported ?? t('common.labels.none')}</span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {canOverride && latest && (carrier.fmcsaStatus === 'mismatch' || carrier.fmcsaStatus === 'failed') ? (
        <Button type="button" variant="secondary" onClick={() => setOverrideOpen(true)}>
          {t('carrier.fmcsa.override.title')}
        </Button>
      ) : null}

      {history.length > 1 ? (
        <div>
          <h4 className="mb-2 text-sm font-bold text-carbon">{t('common.labels.details')}</h4>
          <ul className="space-y-1 text-sm text-steel-600">
            {history.map((entry) => (
              <li key={entry.id}>
                {t('carrier.fmcsa.attempt', { attempt: entry.attempt })} — {formatDateTime(entry.checkedAt, locale, timezone)} — {t(`nav.status.verification.${camelizeStatus(entry.status)}`)}
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      <Dialog open={overrideOpen} onOpenChange={setOverrideOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t('carrier.fmcsa.override.title')}</DialogTitle>
            <DialogDescription>{t('carrier.fmcsa.override.description')}</DialogDescription>
          </DialogHeader>
          <Textarea
            value={reason}
            onChange={(event) => setReason(event.target.value)}
            rows={3}
            placeholder={t('carrier.fmcsa.override.reasonPlaceholder')}
          />
          <DialogFooter>
            <Button type="button" variant="secondary" onClick={() => setOverrideOpen(false)}>
              {t('carrier.fmcsa.override.cancel')}
            </Button>
            <Button type="button" disabled={reason.trim().length < 10 || isPending} loading={isPending} onClick={handleOverride}>
              {t('carrier.fmcsa.override.confirm')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}

function camelizeStatus(status: string): string {
  return status.replace(/_([a-z])/g, (_, c: string) => c.toUpperCase())
}
