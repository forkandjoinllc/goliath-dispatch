'use client'

import Link from 'next/link'
import { Container, IdCard, Truck } from 'lucide-react'
import { StatusBadge } from '@/components/status/status-badge'
import { useTranslate } from '@/components/providers/i18n-provider'
import type { Driver, Trailer, Truck as TruckRow } from '@/db/schema'

export interface CarrierEquipmentDriversPanelProps {
  locale: string
  trucks: TruckRow[]
  trailers: Trailer[]
  drivers: Driver[]
}

/** Counts and quick links into the equipment/driver modules, scoped to this carrier. */
export function CarrierEquipmentDriversPanel({ locale, trucks, trailers, drivers }: CarrierEquipmentDriversPanelProps) {
  const t = useTranslate()

  return (
    <div className="space-y-6">
      <div className="grid gap-4 sm:grid-cols-3">
        <div className="rounded-lg border border-steel-200 p-4">
          <div className="flex items-center gap-2 text-steel-600">
            <Truck className="size-4" aria-hidden="true" />
            <span className="text-xs font-semibold uppercase tracking-wide">{t('equipment.trucks.title')}</span>
          </div>
          <p className="mt-1 text-2xl font-bold text-carbon">{trucks.length}</p>
        </div>
        <div className="rounded-lg border border-steel-200 p-4">
          <div className="flex items-center gap-2 text-steel-600">
            <Container className="size-4" aria-hidden="true" />
            <span className="text-xs font-semibold uppercase tracking-wide">{t('equipment.trailers.title')}</span>
          </div>
          <p className="mt-1 text-2xl font-bold text-carbon">{trailers.length}</p>
        </div>
        <div className="rounded-lg border border-steel-200 p-4">
          <div className="flex items-center gap-2 text-steel-600">
            <IdCard className="size-4" aria-hidden="true" />
            <span className="text-xs font-semibold uppercase tracking-wide">{t('driver.title')}</span>
          </div>
          <p className="mt-1 text-2xl font-bold text-carbon">{drivers.length}</p>
        </div>
      </div>

      <div className="space-y-3">
        <h4 className="text-sm font-bold text-carbon">{t('equipment.trucks.title')}</h4>
        {trucks.length === 0 ? (
          <p className="text-sm text-steel-600">{t('common.states.empty')}</p>
        ) : (
          <ul className="divide-y divide-steel-200 rounded-lg border border-steel-200">
            {trucks.map((truck) => (
              <li key={truck.id} className="flex items-center justify-between gap-3 p-3 text-sm">
                <Link href={`/${locale}/app/equipment/trucks/${truck.id}`} className="font-semibold text-navy-700 hover:underline">
                  {truck.unitNumber}
                </Link>
                <StatusBadge kind="equipment" value={truck.status} />
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="space-y-3">
        <h4 className="text-sm font-bold text-carbon">{t('equipment.trailers.title')}</h4>
        {trailers.length === 0 ? (
          <p className="text-sm text-steel-600">{t('common.states.empty')}</p>
        ) : (
          <ul className="divide-y divide-steel-200 rounded-lg border border-steel-200">
            {trailers.map((trailer) => (
              <li key={trailer.id} className="flex items-center justify-between gap-3 p-3 text-sm">
                <Link href={`/${locale}/app/equipment/trailers/${trailer.id}`} className="font-semibold text-navy-700 hover:underline">
                  {trailer.unitNumber}
                </Link>
                <StatusBadge kind="equipment" value={trailer.status} />
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="space-y-3">
        <h4 className="text-sm font-bold text-carbon">{t('driver.title')}</h4>
        {drivers.length === 0 ? (
          <p className="text-sm text-steel-600">{t('common.states.empty')}</p>
        ) : (
          <ul className="divide-y divide-steel-200 rounded-lg border border-steel-200">
            {drivers.map((driver) => (
              <li key={driver.id} className="flex items-center justify-between gap-3 p-3 text-sm">
                <Link href={`/${locale}/app/drivers/${driver.id}`} className="font-semibold text-navy-700 hover:underline">
                  {driver.firstName} {driver.lastName}
                </Link>
                <StatusBadge kind="driver" value={driver.status} />
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  )
}
