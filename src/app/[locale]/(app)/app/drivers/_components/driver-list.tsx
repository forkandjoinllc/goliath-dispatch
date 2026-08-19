'use client'

import * as React from 'react'
import { useRouter } from 'next/navigation'
import { IdCard } from 'lucide-react'
import type { ColumnDef } from '@tanstack/react-table'
import { DataTable } from '@/components/data/data-table'
import { StatusBadge } from '@/components/status/status-badge'
import { ExpiryBadge } from '@/components/status/expiry-badge'
import { Input } from '@/components/ui/input'
import { useTranslate } from '@/components/providers/i18n-provider'
import type { Driver } from '@/db/schema'

export interface DriverListProps {
  locale: string
  rows: Driver[]
  total: number
  page: number
  pageSize: number
  search: string
  status: string
}

export function DriverList({ locale, rows, total, page, pageSize, search, status }: DriverListProps) {
  const router = useRouter()
  const t = useTranslate()
  const basePath = `/${locale}/app/drivers`

  function pushParams(next: Record<string, string | number | undefined>) {
    const params = new URLSearchParams({ page: String(page), pageSize: String(pageSize), search, status })
    for (const [key, value] of Object.entries(next)) {
      if (value === undefined || value === '') params.delete(key)
      else params.set(key, String(value))
    }
    router.push(`${basePath}?${params.toString()}`)
  }

  const columns: ColumnDef<Driver, unknown>[] = [
    {
      accessorKey: 'lastName',
      header: t('driver.columns.name'),
      cell: ({ row }) => (
        <a href={`${basePath}/${row.original.id}`} className="font-semibold text-navy-700 hover:underline">
          {row.original.firstName} {row.original.lastName}
        </a>
      ),
    },
    {
      accessorKey: 'status',
      header: t('driver.columns.status'),
      cell: ({ row }) => <StatusBadge kind="driver" value={row.original.status} />,
    },
    {
      accessorKey: 'verificationStatus',
      header: t('driver.columns.verificationStatus'),
      cell: ({ row }) => <StatusBadge kind="verification" value={row.original.verificationStatus} />,
    },
    {
      accessorKey: 'licenseExpiresAt',
      header: t('driver.columns.licenseExpiresAt'),
      cell: ({ row }) => <ExpiryBadge date={row.original.licenseExpiresAt} />,
    },
    {
      accessorKey: 'medicalCardExpiresAt',
      header: t('driver.columns.medicalCardExpiresAt'),
      cell: ({ row }) => <ExpiryBadge date={row.original.medicalCardExpiresAt} />,
    },
  ]

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <Input
          defaultValue={search}
          placeholder={t('driver.list.searchPlaceholder')}
          className="max-w-xs"
          onKeyDown={(event) => {
            if (event.key === 'Enter') pushParams({ search: (event.target as HTMLInputElement).value, page: 1 })
          }}
        />
        <div className="flex flex-wrap gap-2">
          {(['', 'available', 'on_load', 'off_duty', 'inactive'] as const).map((option) => (
            <button
              key={option || 'all'}
              type="button"
              onClick={() => pushParams({ status: option, page: 1 })}
              className={
                'rounded-full border px-3 py-1 text-xs font-semibold transition-colors ' +
                (status === option
                  ? 'border-navy-700 bg-navy-700 text-white'
                  : 'border-steel-300 bg-white text-steel-700 hover:bg-steel-50')
              }
            >
              {option ? t(`driver.status.${option}`) : t('driver.filters.allStatuses')}
            </button>
          ))}
        </div>
      </div>

      <DataTable
        caption={t('driver.title')}
        columns={columns}
        data={rows}
        totalCount={total}
        page={page}
        pageSize={pageSize}
        onPageChange={(next) => pushParams({ page: next })}
        onPageSizeChange={(next) => pushParams({ pageSize: next, page: 1 })}
        emptyState={{ title: t('driver.list.empty') }}
        errorState={{ title: t('common.states.error'), description: t('common.states.errorHint') }}
        renderMobileCard={(row) => (
          <a href={`${basePath}/${row.id}`} className="block rounded-lg border border-steel-200 p-3">
            <div className="flex items-center justify-between gap-2">
              <span className="flex items-center gap-2 font-semibold text-navy-700">
                <IdCard className="size-4" aria-hidden="true" />
                {row.firstName} {row.lastName}
              </span>
              <StatusBadge kind="driver" value={row.status} />
            </div>
            <div className="mt-2 flex flex-wrap gap-2">
              <StatusBadge kind="verification" value={row.verificationStatus} />
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
