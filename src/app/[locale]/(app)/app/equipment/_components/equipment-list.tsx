'use client'

import * as React from 'react'
import { useRouter } from 'next/navigation'
import { Truck as TruckIcon } from 'lucide-react'
import type { ColumnDef } from '@tanstack/react-table'
import { DataTable, type DataTableSort } from '@/components/data/data-table'
import { StatusBadge } from '@/components/status/status-badge'
import { ExpiryBadge } from '@/components/status/expiry-badge'
import { Badge } from '@/components/ui/badge'
import { Input } from '@/components/ui/input'
import { useTranslate } from '@/components/providers/i18n-provider'
import type { Trailer, Truck } from '@/db/schema'

type EquipmentRow = Truck | Trailer

export interface EquipmentListProps {
  locale: string
  equipmentType: 'truck' | 'trailer'
  rows: EquipmentRow[]
  total: number
  page: number
  pageSize: number
  search: string
  status: string
}

/**
 * Server-driven `DataTable` for trucks/trailers: sort is not offered here
 * (the query already orders by `createdAt desc`, which is what a fleet list
 * benefits from most), but pagination and the search/status filters are all
 * carried in the URL so the list is bookmarkable and back-button safe.
 */
export function EquipmentList({ locale, equipmentType, rows, total, page, pageSize, search, status }: EquipmentListProps) {
  const router = useRouter()
  const t = useTranslate()
  const basePath = `/${locale}/app/equipment/${equipmentType === 'truck' ? 'trucks' : 'trailers'}`

  function pushParams(next: Record<string, string | number | undefined>) {
    const params = new URLSearchParams({ page: String(page), pageSize: String(pageSize), search, status })
    for (const [key, value] of Object.entries(next)) {
      if (value === undefined || value === '') params.delete(key)
      else params.set(key, String(value))
    }
    router.push(`${basePath}?${params.toString()}`)
  }

  const columns: ColumnDef<EquipmentRow, unknown>[] = [
    {
      accessorKey: 'unitNumber',
      header: t('equipment.columns.unitNumber'),
      cell: ({ row }) => (
        <a href={`${basePath}/${row.original.id}`} className="font-semibold text-navy-700 hover:underline">
          {row.original.unitNumber}
        </a>
      ),
    },
    { accessorKey: 'vin', header: t('equipment.columns.vin'), cell: ({ row }) => <span className="font-mono text-xs">{row.original.vin}</span> },
    {
      accessorKey: 'status',
      header: t('equipment.columns.status'),
      cell: ({ row }) => <StatusBadge kind="equipment" value={row.original.status} />,
    },
    {
      accessorKey: 'coiVerificationStatus',
      header: t('equipment.columns.compliance'),
      cell: ({ row }) => <StatusBadge kind="verification" value={row.original.coiVerificationStatus} />,
    },
    {
      accessorKey: 'registrationExpiresAt',
      header: t('equipment.columns.registrationExpiresAt'),
      cell: ({ row }) => <ExpiryBadge date={row.original.registrationExpiresAt} />,
    },
    {
      accessorKey: 'nextInspectionDueAt',
      header: t('equipment.columns.nextInspectionDueAt'),
      cell: ({ row }) => <ExpiryBadge date={row.original.nextInspectionDueAt} />,
    },
  ]

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <Input
          defaultValue={search}
          placeholder={t(equipmentType === 'truck' ? 'equipment.trucks.searchPlaceholder' : 'equipment.trailers.searchPlaceholder')}
          className="max-w-xs"
          onKeyDown={(event) => {
            if (event.key === 'Enter') pushParams({ search: (event.target as HTMLInputElement).value, page: 1 })
          }}
        />
        <div className="flex flex-wrap gap-2">
          {(['', 'pending_verification', 'active', 'out_of_service', 'archived'] as const).map((option) => (
            <button
              key={option || 'all'}
              type="button"
              onClick={() => pushParams({ status: option, page: 1 })}
              aria-pressed={status === option}
              className={
                'rounded-full border px-3 py-1 text-xs font-semibold transition-colors ' +
                (status === option
                  ? 'border-navy-700 bg-navy-700 text-white'
                  : 'border-steel-300 bg-white text-steel-700 hover:bg-steel-50')
              }
            >
              {option ? t(`equipment.status.${option}`) : t('equipment.filters.allStatuses')}
            </button>
          ))}
        </div>
      </div>

      <DataTable
        caption={t(equipmentType === 'truck' ? 'equipment.trucks.title' : 'equipment.trailers.title')}
        columns={columns}
        data={rows}
        totalCount={total}
        page={page}
        pageSize={pageSize}
        onPageChange={(next) => pushParams({ page: next })}
        onPageSizeChange={(next) => pushParams({ pageSize: next, page: 1 })}
        emptyState={{
          title: t(equipmentType === 'truck' ? 'equipment.trucks.empty' : 'equipment.trailers.empty'),
        }}
        errorState={{ title: t('common.states.error'), description: t('common.states.errorHint') }}
        renderMobileCard={(row) => (
          <a href={`${basePath}/${row.id}`} className="block rounded-lg border border-steel-200 p-3">
            <div className="flex items-center justify-between gap-2">
              <span className="font-semibold text-navy-700">{row.unitNumber}</span>
              <StatusBadge kind="equipment" value={row.status} />
            </div>
            <p className="mt-1 font-mono text-xs text-steel-600">{row.vin}</p>
            <div className="mt-2 flex flex-wrap gap-2">
              <StatusBadge kind="verification" value={row.coiVerificationStatus} />
              <Badge tone="neutral">
                <TruckIcon className="size-3.5" aria-hidden="true" />
                {row.plateNumber ?? '—'}
              </Badge>
            </div>
          </a>
        )}
        labels={{
          columnsMenu: t('common.table.columnsMenu'),
          actionsMenu: t('common.table.actionsMenu'),
          selectAll: t('common.table.selectAll'),
          selectRow: t('common.table.selectRow'),
          sortAscending: t('common.table.sortAscending'),
          sortDescending: t('common.table.sortDescending'),
          loading: t('common.states.loading'),
          pagination: {
            pageStatus: t('common.labels.page', { page, total: Math.max(1, Math.ceil(total / pageSize)) }),
            resultsStatus: t('common.labels.results', { count: total }),
            firstPage: t('common.table.firstPage'),
            previousPage: t('common.table.previousPage'),
            nextPage: t('common.table.nextPage'),
            lastPage: t('common.table.lastPage'),
            rowsPerPage: t('common.table.rowsPerPage'),
          },
        }}
      />
    </div>
  )
}

export type { DataTableSort }
