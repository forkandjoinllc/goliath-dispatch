'use client'

import * as React from 'react'
import { useRouter } from 'next/navigation'
import type { ColumnDef } from '@tanstack/react-table'
import { DataTable } from '@/components/data/data-table'
import { Badge } from '@/components/ui/badge'
import { Input } from '@/components/ui/input'
import { useTranslate } from '@/components/providers/i18n-provider'
import type { Customer } from '@/db/schema'

export interface CustomerListProps {
  locale: string
  rows: Customer[]
  total: number
  page: number
  pageSize: number
  search: string
  status: string
}

const STATUS_TONE: Record<Customer['status'], 'success' | 'warning' | 'neutral'> = {
  active: 'success',
  on_hold: 'warning',
  inactive: 'neutral',
}

/**
 * Server-driven `DataTable` for the customer index. Sort is not offered
 * (the query orders by `createdAt desc`); pagination and the search/status
 * filters are carried in the URL so the list is bookmarkable.
 */
export function CustomerList({ locale, rows, total, page, pageSize, search, status }: CustomerListProps) {
  const router = useRouter()
  const t = useTranslate()
  const basePath = `/${locale}/app/customers`

  function pushParams(next: Record<string, string | number | undefined>) {
    const params = new URLSearchParams({ page: String(page), pageSize: String(pageSize), search, status })
    for (const [key, value] of Object.entries(next)) {
      if (value === undefined || value === '') params.delete(key)
      else params.set(key, String(value))
    }
    router.push(`${basePath}?${params.toString()}`)
  }

  const columns: ColumnDef<Customer, unknown>[] = [
    {
      accessorKey: 'companyName',
      header: t('customer.columns.companyName'),
      cell: ({ row }) => (
        <a href={`${basePath}/${row.original.id}`} className="font-semibold text-navy-700 hover:underline">
          {row.original.companyName}
        </a>
      ),
    },
    { accessorKey: 'dotNumber', header: t('customer.columns.dotNumber'), cell: ({ row }) => row.original.dotNumber ?? '—' },
    { accessorKey: 'mcNumber', header: t('customer.columns.mcNumber'), cell: ({ row }) => row.original.mcNumber ?? '—' },
    { accessorKey: 'phone', header: t('customer.columns.phone'), cell: ({ row }) => row.original.phone ?? '—' },
    { accessorKey: 'email', header: t('customer.columns.email'), cell: ({ row }) => row.original.email ?? '—' },
    {
      accessorKey: 'physicalCity',
      header: t('customer.columns.city'),
      cell: ({ row }) => [row.original.physicalCity, row.original.physicalState].filter(Boolean).join(', ') || '—',
    },
    {
      accessorKey: 'status',
      header: t('customer.columns.status'),
      cell: ({ row }) => (
        <Badge tone={STATUS_TONE[row.original.status]}>{t(`customer.status.${row.original.status}`)}</Badge>
      ),
    },
  ]

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <Input
          defaultValue={search}
          placeholder={t('customer.list.searchPlaceholder')}
          className="max-w-sm"
          onKeyDown={(event) => {
            if (event.key === 'Enter') pushParams({ search: (event.target as HTMLInputElement).value, page: 1 })
          }}
        />
        <div className="flex flex-wrap gap-2">
          {(['', 'active', 'on_hold', 'inactive'] as const).map((option) => (
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
              {option ? t(`customer.status.${option}`) : t('customer.list.filters.allStatuses')}
            </button>
          ))}
        </div>
      </div>

      <DataTable
        caption={t('customer.list.title')}
        columns={columns}
        data={rows}
        totalCount={total}
        page={page}
        pageSize={pageSize}
        onPageChange={(next) => pushParams({ page: next })}
        onPageSizeChange={(next) => pushParams({ pageSize: next, page: 1 })}
        emptyState={{ title: search || status ? t('customer.list.noResults') : t('customer.list.empty') }}
        errorState={{ title: t('common.states.error'), description: t('common.states.errorHint') }}
        renderMobileCard={(row) => (
          <a href={`${basePath}/${row.id}`} className="block rounded-lg border border-steel-200 p-3">
            <div className="flex items-center justify-between gap-2">
              <span className="font-semibold text-navy-700">{row.companyName}</span>
              <Badge tone={STATUS_TONE[row.status]}>{t(`customer.status.${row.status}`)}</Badge>
            </div>
            <p className="mt-1 text-xs text-steel-600">
              {[row.physicalCity, row.physicalState].filter(Boolean).join(', ') || '—'}
            </p>
            <div className="mt-2 flex flex-wrap gap-3 text-xs text-steel-600">
              {row.dotNumber ? <span>DOT {row.dotNumber}</span> : null}
              {row.phone ? <span>{row.phone}</span> : null}
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
