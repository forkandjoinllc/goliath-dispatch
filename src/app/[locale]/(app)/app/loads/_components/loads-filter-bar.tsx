'use client'

import * as React from 'react'
import { useRouter } from 'next/navigation'
import { Input } from '@/components/ui/input'
import { Checkbox } from '@/components/ui/checkbox'
import { Label } from '@/components/ui/label'
import { Button } from '@/components/ui/button'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { useTranslate } from '@/components/providers/i18n-provider'
import { LOAD_STATUSES, type LoadStatus } from '@/server/loads/status-machine'

export interface LoadsFilterValues {
  view: string
  status: LoadStatus[]
  reference: string
  dateFrom: string
  dateTo: string
  oversizeOnly: boolean
  customerId: string
}

export const DEFAULT_LOADS_FILTERS: LoadsFilterValues = {
  view: 'table',
  status: [],
  reference: '',
  dateFrom: '',
  dateTo: '',
  oversizeOnly: false,
  customerId: '',
}

export function parseLoadsFilters(query: Record<string, string | undefined>): LoadsFilterValues {
  return {
    view: query.view || 'table',
    status: (query.status ?? '').split(',').filter((s): s is LoadStatus => LOAD_STATUSES.includes(s as LoadStatus)),
    reference: query.reference ?? '',
    dateFrom: query.dateFrom ?? '',
    dateTo: query.dateTo ?? '',
    oversizeOnly: query.oversizeOnly === '1',
    customerId: query.customerId ?? '',
  }
}

function toSearchParams(filters: LoadsFilterValues): URLSearchParams {
  const params = new URLSearchParams()
  if (filters.view !== 'table') params.set('view', filters.view)
  if (filters.status.length > 0) params.set('status', filters.status.join(','))
  if (filters.reference) params.set('reference', filters.reference)
  if (filters.dateFrom) params.set('dateFrom', filters.dateFrom)
  if (filters.dateTo) params.set('dateTo', filters.dateTo)
  if (filters.oversizeOnly) params.set('oversizeOnly', '1')
  if (filters.customerId) params.set('customerId', filters.customerId)
  return params
}

/**
 * The one filter bar every view mode renders under — view switches and
 * filter changes both just push a new URL, so the whole list (filters +
 * active view) is bookmarkable and survives the back button.
 */
export function LoadsFilterBar({ locale, filters }: { locale: string; filters: LoadsFilterValues }) {
  const t = useTranslate()
  const router = useRouter()
  const basePath = `/${locale}/app/loads`
  const [referenceText, setReferenceText] = React.useState(filters.reference)

  function push(next: Partial<LoadsFilterValues>) {
    const merged = { ...filters, ...next }
    router.push(`${basePath}?${toSearchParams(merged).toString()}`)
  }

  function toggleStatus(status: LoadStatus) {
    const set = new Set(filters.status)
    if (set.has(status)) set.delete(status)
    else set.add(status)
    push({ status: [...set] })
  }

  const hasActiveFilters =
    filters.status.length > 0 || filters.reference || filters.dateFrom || filters.dateTo || filters.oversizeOnly || filters.customerId

  return (
    <div className="flex flex-wrap items-center gap-3">
      <Input
        value={referenceText}
        onChange={(event) => setReferenceText(event.target.value)}
        placeholder={t('load.filters.referencePlaceholder')}
        className="max-w-xs"
        onKeyDown={(event) => {
          if (event.key === 'Enter') push({ reference: referenceText })
        }}
        onBlur={() => push({ reference: referenceText })}
      />

      <Popover>
        <PopoverTrigger asChild>
          <Button variant="secondary" size="sm">
            {t('load.filters.status')}
            {filters.status.length > 0 ? ` (${filters.status.length})` : ''}
          </Button>
        </PopoverTrigger>
        <PopoverContent align="start" className="w-64">
          <div className="grid gap-2">
            {LOAD_STATUSES.map((status) => (
              <div key={status} className="flex items-center gap-2">
                <Checkbox
                  id={`status-${status}`}
                  checked={filters.status.includes(status)}
                  onCheckedChange={() => toggleStatus(status)}
                />
                <Label htmlFor={`status-${status}`} className="font-normal">
                  {t(`nav.status.load.${statusI18nKey(status)}`)}
                </Label>
              </div>
            ))}
          </div>
        </PopoverContent>
      </Popover>

      <div className="flex items-center gap-2">
        <Input type="date" value={filters.dateFrom} onChange={(event) => push({ dateFrom: event.target.value })} className="w-40" />
        <span className="text-sm text-steel-500">–</span>
        <Input type="date" value={filters.dateTo} onChange={(event) => push({ dateTo: event.target.value })} className="w-40" />
      </div>

      <div className="flex items-center gap-2">
        <Checkbox
          id="oversize-only"
          checked={filters.oversizeOnly}
          onCheckedChange={(checked) => push({ oversizeOnly: Boolean(checked) })}
        />
        <Label htmlFor="oversize-only" className="font-normal">
          {t('load.filters.oversizeOnly')}
        </Label>
      </div>

      {hasActiveFilters ? (
        <Button
          variant="ghost"
          size="sm"
          onClick={() => {
            setReferenceText('')
            router.push(`${basePath}?view=${filters.view}`)
          }}
        >
          {t('load.filters.clear')}
        </Button>
      ) : null}
    </div>
  )
}

function statusI18nKey(status: LoadStatus): string {
  return status.replace(/_([a-z])/g, (_, c: string) => c.toUpperCase())
}
