'use client'

import * as React from 'react'
import { useRouter } from 'next/navigation'
import type { ColumnDef } from '@tanstack/react-table'
import { DataTable } from '@/components/data/data-table'
import { StatusBadge } from '@/components/status/status-badge'
import { Badge } from '@/components/ui/badge'
import { useI18n, useTranslate } from '@/components/providers/i18n-provider'
import { formatDate, formatMoney } from '@/i18n/translate'
import type { LoadListRow } from '@/server/loads/queries'

export interface LoadsTableViewProps {
  locale: string
  rows: LoadListRow[]
  total: number
  page: number
  pageSize: number
}

export function LoadsTableView({ locale, rows, total, page, pageSize }: LoadsTableViewProps) {
  const t = useTranslate()
  const router = useRouter()
  const { locale: i18nLocale, timezone } = useI18n()
  const basePath = `/${locale}/app/loads`

  function pushPage(nextPage: number, nextPageSize?: number) {
    const params = new URLSearchParams(window.location.search)
    params.set('page', String(nextPage))
    if (nextPageSize) params.set('pageSize', String(nextPageSize))
    router.push(`${basePath}?${params.toString()}`)
  }

  const columns: ColumnDef<LoadListRow, unknown>[] = [
    {
      accessorKey: 'load.loadNumber',
      header: t('load.columns.loadNumber'),
      cell: ({ row }) => (
        <a href={`${basePath}/${row.original.load.id}`} className="font-semibold text-navy-700 hover:underline">
          {row.original.load.loadNumber}
        </a>
      ),
    },
    { accessorKey: 'customerName', header: t('load.columns.customer'), cell: ({ row }) => row.original.customerName },
    { accessorKey: 'carrierName', header: t('load.columns.carrier'), cell: ({ row }) => row.original.carrierName ?? '—' },
    {
      accessorKey: 'load.status',
      header: t('load.columns.status'),
      cell: ({ row }) => <StatusBadge kind="load" value={row.original.load.status} />,
    },
    {
      accessorKey: 'load.plannedPickupAt',
      header: t('load.columns.plannedPickupAt'),
      cell: ({ row }) => formatDate(row.original.load.plannedPickupAt, i18nLocale, timezone),
    },
    {
      accessorKey: 'load.plannedDeliveryAt',
      header: t('load.columns.plannedDeliveryAt'),
      cell: ({ row }) => formatDate(row.original.load.plannedDeliveryAt, i18nLocale, timezone),
    },
    {
      accessorKey: 'load.customerChargeCents',
      header: t('load.columns.customerCharge'),
      cell: ({ row }) => formatMoney(row.original.load.customerChargeCents, i18nLocale),
    },
    {
      accessorKey: 'load.isOversize',
      header: t('load.columns.oversize'),
      cell: ({ row }) =>
        row.original.load.isOversize || row.original.load.isOverweight ? <Badge tone="warning">{t('load.columns.oversize')}</Badge> : '—',
    },
  ]

  return (
    <DataTable
      caption={t('load.title')}
      columns={columns}
      data={rows}
      totalCount={total}
      page={page}
      pageSize={pageSize}
      onPageChange={(next) => pushPage(next)}
      onPageSizeChange={(next) => pushPage(1, next)}
      getRowId={(row) => row.load.id}
      emptyState={{ title: t('load.states.empty') }}
      errorState={{ title: t('load.states.error') }}
      renderMobileCard={(row) => (
        <a href={`${basePath}/${row.load.id}`} className="block rounded-lg border border-steel-200 p-3">
          <div className="flex items-center justify-between gap-2">
            <span className="font-semibold text-navy-700">{row.load.loadNumber}</span>
            <StatusBadge kind="load" value={row.load.status} />
          </div>
          <p className="mt-1 text-xs text-steel-600">{row.customerName}</p>
          <div className="mt-2 flex flex-wrap items-center justify-between gap-2 text-xs text-steel-600">
            <span>{formatDate(row.load.plannedPickupAt, i18nLocale, timezone)}</span>
            <span>{formatMoney(row.load.customerChargeCents, i18nLocale)}</span>
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
  )
}
