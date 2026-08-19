'use client'

import * as React from 'react'
import { useRouter } from 'next/navigation'
import { useTransition } from 'react'
import { ShieldCheck } from 'lucide-react'
import { Alert } from '@/components/ui/feedback'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/input'
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog'
import { useToast } from '@/components/ui/toast'
import { useTranslate } from '@/components/providers/i18n-provider'
import { overrideEquipmentCoiVerification } from '@/server/verification/actions'
import type { ComplianceResult } from '@/server/compliance'
import type { EquipmentVerification } from '@/db/schema'

export function EquipmentCompliancePanel({
  equipmentType,
  equipmentId,
  compliance,
  verification,
  canOverride,
}: {
  equipmentType: 'truck' | 'trailer'
  equipmentId: string
  compliance: ComplianceResult
  verification: EquipmentVerification | null
  canOverride: boolean
}) {
  const t = useTranslate()
  const router = useRouter()
  const { toast } = useToast()
  const [isPending, startTransition] = useTransition()
  const [overrideOpen, setOverrideOpen] = React.useState(false)
  const [reason, setReason] = React.useState('')

  function submitOverride() {
    if (!verification) return
    startTransition(async () => {
      const result = await overrideEquipmentCoiVerification({
        equipmentType,
        equipmentId,
        verificationId: verification.id,
        reason,
      })
      if (result.ok) {
        toast({ tone: 'success', title: t('equipment.compliance.override') })
        setOverrideOpen(false)
        setReason('')
        router.refresh()
        return
      }
      toast({ tone: 'error', title: t(result.error.messageKey, result.error.params) })
    })
  }

  return (
    <div className="space-y-4">
      <div>
        <h3 className="text-base font-bold text-carbon">{t('equipment.compliance.title')}</h3>
        <p className="text-sm text-steel-600">{t('equipment.compliance.description')}</p>
      </div>

      {compliance.ok && compliance.warnings.length === 0 ? (
        <Alert tone="info">
          <span className="flex items-center gap-2">
            <ShieldCheck className="size-4" aria-hidden="true" />
            {t('equipment.compliance.ok')}
          </span>
        </Alert>
      ) : null}

      {compliance.blocking.length > 0 ? (
        <Alert tone="danger" title={t('equipment.compliance.blocked', { count: compliance.blocking.length })}>
          <ul className="list-inside list-disc space-y-1">
            {compliance.blocking.map((reasonItem, index) => (
              <li key={`${reasonItem.code}-${index}`}>{t(reasonItem.messageKey, reasonItem.params)}</li>
            ))}
          </ul>
        </Alert>
      ) : null}

      {compliance.warnings.length > 0 ? (
        <Alert tone="warning" title={t('equipment.compliance.warnings', { count: compliance.warnings.length })}>
          <ul className="list-inside list-disc space-y-1">
            {compliance.warnings.map((reasonItem, index) => (
              <li key={`${reasonItem.code}-${index}`}>{t(reasonItem.messageKey, reasonItem.params)}</li>
            ))}
          </ul>
        </Alert>
      ) : null}

      {verification ? (
        <div className="rounded-lg border border-steel-200 p-4 text-sm">
          <p className="font-semibold text-carbon">{t('equipment.compliance.coiVerification')}</p>
          <dl className="mt-2 grid grid-cols-1 gap-2 sm:grid-cols-2">
            <div>
              <dt className="text-xs uppercase text-steel-500">{t('equipment.fields.coiVerificationStatus')}</dt>
              <dd>{t(`equipment.verificationStatus.${verification.status}`)}</dd>
            </div>
            <div>
              <dt className="text-xs uppercase text-steel-500">{t('equipment.compliance.matchedVin')}</dt>
              <dd className="font-mono">{verification.matchedVin ?? t('equipment.compliance.noMatch')}</dd>
            </div>
            {verification.extractedVins.length > 0 ? (
              <div className="sm:col-span-2">
                <dt className="text-xs uppercase text-steel-500">{t('equipment.compliance.extractedVins')}</dt>
                <dd className="font-mono">{verification.extractedVins.join(', ')}</dd>
              </div>
            ) : null}
          </dl>
        </div>
      ) : null}

      {canOverride && verification && compliance.blocking.length > 0 ? (
        <Button type="button" variant="secondary" onClick={() => setOverrideOpen(true)}>
          {t('equipment.compliance.override')}
        </Button>
      ) : null}

      <Dialog open={overrideOpen} onOpenChange={setOverrideOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t('equipment.compliance.override')}</DialogTitle>
            <DialogDescription>{t('equipment.compliance.description')}</DialogDescription>
          </DialogHeader>
          <Textarea value={reason} onChange={(event) => setReason(event.target.value)} rows={3} />
          <DialogFooter>
            <Button type="button" variant="secondary" onClick={() => setOverrideOpen(false)}>
              {t('common.actions.cancel')}
            </Button>
            <Button type="button" disabled={reason.trim().length < 10 || isPending} onClick={submitOverride}>
              {t('common.actions.confirm')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
