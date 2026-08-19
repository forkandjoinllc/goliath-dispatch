'use client'

import * as React from 'react'
import { useRouter } from 'next/navigation'
import { Pencil } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { DetailList, type DetailItem } from '@/components/data/detail-list'
import { useToast } from '@/components/ui/toast'
import { useI18n, useTranslate } from '@/components/providers/i18n-provider'
import { formatDateTime } from '@/i18n/translate'
import { setCarrierDispatchFeeAction } from '@/server/carriers/actions'
import type { Carrier } from '@/db/schema'

function addressLines(carrier: Carrier, prefix: 'physical' | 'mailing'): string {
  const line1 = carrier[`${prefix}Line1`]
  const line2 = carrier[`${prefix}Line2`]
  const city = carrier[`${prefix}City`]
  const state = carrier[`${prefix}State`]
  const postal = carrier[`${prefix}PostalCode`]
  const parts = [line1, line2].filter(Boolean).join(' ')
  const cityLine = [city, state].filter(Boolean).join(', ')
  return [parts, [cityLine, postal].filter(Boolean).join(' ')].filter(Boolean).join(', ') || ''
}

export function CarrierOverviewTab({ carrier, canSetFee }: { carrier: Carrier; canSetFee: boolean }) {
  const t = useTranslate()
  const { locale, timezone } = useI18n()
  const router = useRouter()
  const { toast } = useToast()
  const [feeOpen, setFeeOpen] = React.useState(false)
  const [feePercent, setFeePercent] = React.useState(String(carrier.dispatchFeeBps / 100))
  const [reason, setReason] = React.useState('')
  const [isPending, startTransition] = React.useTransition()

  function submitFee() {
    const bps = Math.round(Number(feePercent) * 100)
    if (!Number.isFinite(bps) || bps < 0) return
    startTransition(async () => {
      const result = await setCarrierDispatchFeeAction({ carrierId: carrier.id, dispatchFeeBps: bps, reason })
      if (result.ok) {
        toast({ tone: 'success', title: t('carrier.actions.setDispatchFee') })
        setFeeOpen(false)
        setReason('')
        router.refresh()
        return
      }
      toast({ tone: 'error', title: t(result.error.messageKey, result.error.params) })
    })
  }

  const items: DetailItem[] = [
    { key: 'legalName', label: t('carrier.fields.legalName'), value: carrier.legalName },
    { key: 'dba', label: t('carrier.fields.dba'), value: carrier.dba ?? t('common.labels.none') },
    { key: 'dotNumber', label: t('carrier.fields.dotNumber'), value: <span className="font-mono">{carrier.dotNumber}</span> },
    { key: 'mcNumber', label: t('carrier.fields.mcNumber'), value: carrier.mcNumber ? <span className="font-mono">{carrier.mcNumber}</span> : t('common.labels.none') },
    {
      key: 'ein',
      label: t('carrier.fields.ein'),
      value: carrier.einLast4 ? t('carrier.fields.einLast4', { last4: carrier.einLast4 }) : t('common.labels.none'),
      masked: true,
    },
    { key: 'contact', label: t('common.labels.name'), value: `${carrier.contactFirstName} ${carrier.contactLastName}` },
    { key: 'email', label: t('carrier.fields.email'), value: carrier.email },
    { key: 'phone', label: t('carrier.fields.phone'), value: carrier.phone },
    { key: 'website', label: t('carrier.fields.website'), value: carrier.website ?? t('common.labels.none') },
    { key: 'preferredLocale', label: t('carrier.fields.preferredLocale'), value: carrier.preferredLocale === 'es' ? 'Español' : 'English' },
    { key: 'physicalAddress', label: t('carrier.fields.physicalAddress'), value: addressLines(carrier, 'physical') || t('common.labels.none'), fullWidth: true },
    {
      key: 'mailingAddress',
      label: t('carrier.fields.mailingAddress'),
      value: carrier.mailingSameAsPhysical ? t('carrier.fields.mailingSameAsPhysical') : addressLines(carrier, 'mailing') || t('common.labels.none'),
      fullWidth: true,
    },
    { key: 'usesFactoring', label: t('carrier.fields.usesFactoring'), value: carrier.usesFactoring ? t('common.labels.yes') : t('common.labels.no') },
    {
      key: 'dispatchFeeBps',
      label: t('carrier.fields.dispatchFeeBps'),
      value: (
        <span className="flex items-center gap-2">
          {(carrier.dispatchFeeBps / 100).toFixed(2)}%
          {canSetFee ? (
            <Button variant="ghost" size="iconSm" aria-label={t('carrier.actions.setDispatchFee')} onClick={() => setFeeOpen(true)}>
              <Pencil aria-hidden="true" />
            </Button>
          ) : null}
        </span>
      ),
    },
    { key: 'notes', label: t('carrier.fields.notes'), value: carrier.notes ?? t('common.labels.none'), fullWidth: true },
    {
      key: 'lastActivityAt',
      label: t('carrier.fields.lastActivityAt'),
      value: carrier.lastActivityAt ? formatDateTime(carrier.lastActivityAt, locale, timezone) : t('common.labels.none'),
    },
  ]

  if (carrier.suspendedAt) {
    items.push(
      { key: 'suspendedAt', label: t('carrier.fields.suspendedAt'), value: formatDateTime(carrier.suspendedAt, locale, timezone) },
      { key: 'suspensionReason', label: t('carrier.fields.suspensionReason'), value: carrier.suspensionReason ?? '', fullWidth: true },
    )
  }

  return (
    <div className="space-y-4">
      <DetailList items={items} />

      <Dialog open={feeOpen} onOpenChange={setFeeOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t('carrier.actions.setDispatchFee')}</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div className="grid gap-1.5">
              <Label htmlFor="carrier-fee-percent">{t('carrier.fields.dispatchFeeBps')}</Label>
              <Input
                id="carrier-fee-percent"
                type="number"
                min={0}
                max={100}
                step={0.01}
                value={feePercent}
                onChange={(e) => setFeePercent(e.target.value)}
              />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="carrier-fee-reason">{t('common.labels.reason')}</Label>
              <Input id="carrier-fee-reason" value={reason} onChange={(e) => setReason(e.target.value)} />
            </div>
          </div>
          <DialogFooter>
            <Button type="button" variant="secondary" onClick={() => setFeeOpen(false)}>
              {t('common.actions.cancel')}
            </Button>
            <Button type="button" disabled={reason.trim().length === 0 || isPending} loading={isPending} onClick={submitFee}>
              {t('common.actions.save')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
