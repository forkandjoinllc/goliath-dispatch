'use client'

import * as React from 'react'
import { useRouter } from 'next/navigation'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { DetailList, type DetailItem } from '@/components/data/detail-list'
import { useToast } from '@/components/ui/toast'
import { useTranslate } from '@/components/providers/i18n-provider'
import { convertLeadToCarrierAction } from '@/server/leads/actions'
import type { CarrierSignupPayload } from '@/server/leads/queries'
import type { Lead } from '@/db/schema'

export interface ConvertLeadDialogProps {
  locale: string
  lead: Lead | null
  payload: CarrierSignupPayload | null
  onOpenChange: (open: boolean) => void
}

/**
 * "Convert to carrier" — shows the parsed `carrier_signup` payload as a
 * read-only preview, plus the handful of fields worth double-checking
 * before creating the carrier record (legal name, DOT/MC, EIN, dispatch
 * fee). `convertLeadToCarrierAction` runs `createCarrier` under the hood, so
 * the resulting carrier lands directly on its own detail/onboarding screen.
 */
export function ConvertLeadDialog({ locale, lead, payload, onOpenChange }: ConvertLeadDialogProps) {
  const t = useTranslate()
  const router = useRouter()
  const { toast } = useToast()
  const [isPending, startTransition] = React.useTransition()

  const [legalName, setLegalName] = React.useState('')
  const [dotNumber, setDotNumber] = React.useState('')
  const [mcNumber, setMcNumber] = React.useState('')
  const [ein, setEin] = React.useState('')
  const [dispatchFeePercent, setDispatchFeePercent] = React.useState('10')

  React.useEffect(() => {
    if (!lead) return
    setLegalName(payload?.legalName ?? lead.companyName ?? '')
    setDotNumber(payload?.dotNumber ?? lead.dotNumber ?? '')
    setMcNumber(payload?.mcNumber ?? lead.mcNumber ?? '')
    setEin(payload?.ein ?? '')
    setDispatchFeePercent('10')
  }, [lead, payload])

  if (!lead) return null
  const leadId = lead.id

  const previewItems: DetailItem[] = payload
    ? [
        { key: 'contact', label: t('common.labels.name'), value: `${payload.contactFirstName} ${payload.contactLastName}` },
        { key: 'email', label: t('carrier.fields.email'), value: payload.email },
        { key: 'phone', label: t('carrier.fields.phone'), value: payload.phone },
        {
          key: 'address',
          label: t('carrier.fields.physicalAddress'),
          value: [payload.physicalAddress.line1, payload.physicalAddress.city, payload.physicalAddress.state, payload.physicalAddress.postalCode]
            .filter(Boolean)
            .join(', '),
          fullWidth: true,
        },
        { key: 'factoring', label: t('carrier.fields.usesFactoring'), value: payload.factoringApplies ? t('common.labels.yes') : t('common.labels.no') },
      ]
    : []

  function handleConvert() {
    const feeBps = Math.round(Number(dispatchFeePercent) * 100)
    startTransition(async () => {
      const result = await convertLeadToCarrierAction({
        leadId,
        legalName: legalName || undefined,
        dotNumber: dotNumber || undefined,
        mcNumber: mcNumber || undefined,
        ein: ein || undefined,
        dispatchFeeBps: Number.isFinite(feeBps) ? feeBps : undefined,
      })
      if (result.ok) {
        toast({ tone: 'success', title: t('carrier.leads.converted') })
        onOpenChange(false)
        router.push(`/${locale}/app/carriers/${result.data.carrier.id}`)
        router.refresh()
        return
      }
      toast({ tone: 'error', title: t(result.error.messageKey, result.error.params) })
    })
  }

  return (
    <Dialog open={lead !== null} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t('carrier.leads.convert')}</DialogTitle>
          <DialogDescription>{t('carrier.leads.convertDescription')}</DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          {payload ? (
            <div>
              <h4 className="mb-2 text-sm font-bold text-carbon">{t('carrier.leads.parsedPayload')}</h4>
              <DetailList items={previewItems} />
            </div>
          ) : null}

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="grid gap-1.5">
              <Label htmlFor="convert-legal-name">{t('carrier.fields.legalName')}</Label>
              <Input id="convert-legal-name" value={legalName} onChange={(e) => setLegalName(e.target.value)} />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="convert-dot">{t('carrier.fields.dotNumber')}</Label>
              <Input id="convert-dot" value={dotNumber} onChange={(e) => setDotNumber(e.target.value)} />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="convert-mc">{t('carrier.fields.mcNumber')}</Label>
              <Input id="convert-mc" value={mcNumber} onChange={(e) => setMcNumber(e.target.value)} />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="convert-ein">{t('carrier.fields.ein')}</Label>
              <Input id="convert-ein" value={ein} onChange={(e) => setEin(e.target.value)} />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="convert-fee">{t('carrier.fields.dispatchFeeBps')}</Label>
              <Input
                id="convert-fee"
                type="number"
                min={0}
                max={100}
                step={0.01}
                value={dispatchFeePercent}
                onChange={(e) => setDispatchFeePercent(e.target.value)}
              />
            </div>
          </div>
        </div>

        <DialogFooter>
          <Button type="button" variant="secondary" onClick={() => onOpenChange(false)}>
            {t('common.actions.cancel')}
          </Button>
          <Button type="button" disabled={isPending || legalName.trim().length === 0 || dotNumber.trim().length === 0} loading={isPending} onClick={handleConvert}>
            {t('carrier.leads.convert')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
