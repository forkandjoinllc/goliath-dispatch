'use client'

import * as React from 'react'
import { useRouter } from 'next/navigation'
import { useTransition } from 'react'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { EmptyState } from '@/components/ui/feedback'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { useToast } from '@/components/ui/toast'
import { useTranslate } from '@/components/providers/i18n-provider'
import { useI18n } from '@/components/providers/i18n-provider'
import { formatDate } from '@/i18n/translate'
import {
  addDriverCarrierRelationshipAction,
  endDriverCarrierRelationshipAction,
  setPrimaryCarrierForDriverAction,
} from '@/server/drivers/actions'
import type { Carrier, DriverCarrierRelationship } from '@/db/schema'
import type { ComplianceResult } from '@/server/compliance'

export interface RelationshipRow {
  relationship: DriverCarrierRelationship
  carrier: Carrier
  compliance: ComplianceResult
}

export function DriverCarrierRelationshipsPanel({
  driverId,
  driverName,
  relationships,
  availableCarriers,
  canManage,
}: {
  driverId: string
  driverName: string
  relationships: RelationshipRow[]
  availableCarriers: { value: string; label: string }[]
  canManage: boolean
}) {
  const t = useTranslate()
  const { locale, timezone } = useI18n()
  const router = useRouter()
  const { toast } = useToast()
  const [isPending, startTransition] = useTransition()
  const [selectedCarrier, setSelectedCarrier] = React.useState('')

  function addRelationship() {
    if (!selectedCarrier) return
    startTransition(async () => {
      const result = await addDriverCarrierRelationshipAction({ driverId, carrierId: selectedCarrier })
      if (result.ok) {
        toast({ tone: 'success', title: t('driver.carrierRelationships.add') })
        setSelectedCarrier('')
        router.refresh()
        return
      }
      toast({ tone: 'error', title: t(result.error.messageKey, result.error.params) })
    })
  }

  function endRelationship(carrierId: string, carrierName: string) {
    if (!window.confirm(t('driver.carrierRelationships.confirmEnd', { name: driverName, carrierName }))) return
    startTransition(async () => {
      const result = await endDriverCarrierRelationshipAction({ driverId, carrierId })
      if (result.ok) {
        toast({ tone: 'success', title: t('driver.carrierRelationships.end') })
        router.refresh()
        return
      }
      toast({ tone: 'error', title: t(result.error.messageKey, result.error.params) })
    })
  }

  function setPrimary(carrierId: string) {
    startTransition(async () => {
      const result = await setPrimaryCarrierForDriverAction({ driverId, carrierId })
      if (result.ok) {
        toast({ tone: 'success', title: t('driver.carrierRelationships.setPrimary') })
        router.refresh()
        return
      }
      toast({ tone: 'error', title: t(result.error.messageKey, result.error.params) })
    })
  }

  return (
    <div className="space-y-4">
      <div>
        <h3 className="text-base font-bold text-carbon">{t('driver.carrierRelationships.title')}</h3>
        <p className="text-sm text-steel-600">{t('driver.carrierRelationships.description')}</p>
      </div>

      {canManage && availableCarriers.length > 0 ? (
        <div className="flex flex-wrap items-center gap-2 rounded-lg border border-steel-200 p-3">
          <Select value={selectedCarrier} onValueChange={setSelectedCarrier}>
            <SelectTrigger className="w-64">
              <SelectValue placeholder={t('equipment.fields.carrier')} />
            </SelectTrigger>
            <SelectContent>
              {availableCarriers.map((c) => (
                <SelectItem key={c.value} value={c.value}>
                  {c.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Button type="button" variant="secondary" disabled={!selectedCarrier || isPending} onClick={addRelationship}>
            {t('driver.carrierRelationships.add')}
          </Button>
        </div>
      ) : null}

      {relationships.length === 0 ? (
        <EmptyState title={t('driver.carrierRelationships.empty')} />
      ) : (
        <ul className="divide-y divide-steel-200 rounded-lg border border-steel-200">
          {relationships.map(({ relationship, carrier }) => {
            const isCurrent = !relationship.endDate || relationship.endDate > new Date()
            return (
              <li key={relationship.id} className="flex flex-wrap items-center justify-between gap-3 p-3 text-sm">
                <div>
                  <p className="font-semibold text-carbon">
                    {carrier.legalName}
                    {relationship.isPrimary ? (
                      <Badge tone="info" className="ml-2">
                        {t('driver.carrierRelationships.primaryBadge')}
                      </Badge>
                    ) : null}
                    <Badge tone={isCurrent ? 'success' : 'neutral'} className="ml-2">
                      {t(isCurrent ? 'driver.carrierRelationships.current' : 'driver.carrierRelationships.ended')}
                    </Badge>
                  </p>
                  <p className="text-xs text-steel-500">
                    {t('driver.carrierRelationships.startDate')}: {formatDate(relationship.startDate, locale, timezone)}
                    {relationship.endDate
                      ? ` · ${t('driver.carrierRelationships.endDate')}: ${formatDate(relationship.endDate, locale, timezone)}`
                      : ''}
                  </p>
                </div>
                {canManage && isCurrent ? (
                  <div className="flex gap-2">
                    {!relationship.isPrimary ? (
                      <Button type="button" variant="secondary" size="sm" disabled={isPending} onClick={() => setPrimary(carrier.id)}>
                        {t('driver.carrierRelationships.setPrimary')}
                      </Button>
                    ) : null}
                    <Button
                      type="button"
                      variant="destructive"
                      size="sm"
                      disabled={isPending}
                      onClick={() => endRelationship(carrier.id, carrier.legalName)}
                    >
                      {t('driver.carrierRelationships.end')}
                    </Button>
                  </div>
                ) : null}
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}
