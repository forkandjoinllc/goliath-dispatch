'use client'

import * as React from 'react'
import { useRouter } from 'next/navigation'
import type { ColumnDef } from '@tanstack/react-table'
import { DataTable } from '@/components/data/data-table'
import { StatusBadge } from '@/components/status/status-badge'
import { ExpiryBadge } from '@/components/status/expiry-badge'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { useTranslate } from '@/components/providers/i18n-provider'
import type { documentReviewStatusEnum, documentTypeEnum } from '@/db/schema/_shared'
import { ownerLabelKey, type TenantDocumentRow } from '../_lib/shared'

export interface DocumentListProps {
  locale: string
  rows: TenantDocumentRow[]
  ownerLabels: Record<string, string>
  total: number
  page: number
  pageSize: number
  search: string
  documentType: string
  ownerType: string
  reviewStatus: string
  expiringWithinDays: string
  documentTypes: readonly (typeof documentTypeEnum.enumValues)[number][]
  reviewStatuses: readonly (typeof documentReviewStatusEnum.enumValues)[number][]
  canReview: boolean
}

const OWNER_TYPES = ['carrier', 'truck', 'trailer', 'driver', 'load', 'invoice', 'tenant'] as const
const EXPIRY_WINDOWS = ['', '7', '30', '90'] as const

/** Tenant-wide document view: filterable by type/owner/review status/expiry window, scope-aware. */
export function DocumentList({
  locale,
  rows,
  ownerLabels,
  total,
  page,
  pageSize,
  search,
  documentType,
  ownerType,
  reviewStatus,
  expiringWithinDays,
  documentTypes,
  reviewStatuses,
  canReview,
}: DocumentListProps) {
  const t = useTranslate()
  const router = useRouter()
  const basePath = `/${locale}/app/documents`

  function pushParams(next: Record<string, string | number | undefined>) {
    const params = new URLSearchParams({
      page: String(page),
      pageSize: String(pageSize),
      search,
      documentType,
      ownerType,
      reviewStatus,
      expiringWithinDays,
    })
    for (const [key, value] of Object.entries(next)) {
      if (value === undefined || value === '') params.delete(key)
      else params.set(key, String(value))
    }
    router.push(`${basePath}?${params.toString()}`)
  }

  const columns: ColumnDef<TenantDocumentRow, unknown>[] = [
    {
      accessorKey: 'title',
      header: t('document.list.columns.document'),
      cell: ({ row }) => (
        <a href={`${basePath}/${row.original.id}`} className="font-semibold text-navy-700 hover:underline">
          {row.original.title ?? t(`document.types.${row.original.documentType}`)}
        </a>
      ),
    },
    {
      accessorKey: 'documentType',
      header: t('document.list.columns.type'),
      cell: ({ row }) => t(`document.types.${row.original.documentType}`),
    },
    {
      accessorKey: 'ownerType',
      header: t('document.list.columns.owner'),
      cell: ({ row }) => (
        <span>
          <span className="text-xs uppercase text-steel-500">{t(`document.list.ownerTypes.${row.original.ownerType}`)}</span>{' '}
          {ownerLabels[ownerLabelKey(row.original.ownerType, row.original.ownerId)] ?? row.original.ownerId}
        </span>
      ),
    },
    {
      accessorKey: 'reviewStatus',
      header: t('document.list.columns.reviewStatus'),
      cell: ({ row }) => <StatusBadge kind="documentReview" value={row.original.reviewStatus} />,
    },
    {
      accessorKey: 'expirationDate',
      header: t('document.list.columns.expiration'),
      cell: ({ row }) => (row.original.expirationDate ? <ExpiryBadge date={row.original.expirationDate} /> : t('common.labels.none')),
    },
  ]

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <Input
          defaultValue={search}
          placeholder={t('document.list.searchPlaceholder')}
          className="max-w-xs"
          onKeyDown={(event) => {
            if (event.key === 'Enter') pushParams({ search: (event.target as HTMLInputElement).value, page: 1 })
          }}
        />
        <Select value={documentType || 'all'} onValueChange={(v) => pushParams({ documentType: v === 'all' ? undefined : v, page: 1 })}>
          <SelectTrigger className="w-56">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">{t('carrier.list.allStatuses')}</SelectItem>
            {documentTypes.map((type) => (
              <SelectItem key={type} value={type}>
                {t(`document.types.${type}`)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={ownerType || 'all'} onValueChange={(v) => pushParams({ ownerType: v === 'all' ? undefined : v, page: 1 })}>
          <SelectTrigger className="w-40">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">{t('carrier.list.allStatuses')}</SelectItem>
            {OWNER_TYPES.map((type) => (
              <SelectItem key={type} value={type}>
                {t(`document.list.ownerTypes.${type}`)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={reviewStatus || 'all'} onValueChange={(v) => pushParams({ reviewStatus: v === 'all' ? undefined : v, page: 1 })}>
          <SelectTrigger className="w-48">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">{t('carrier.list.allStatuses')}</SelectItem>
            {reviewStatuses.map((status) => (
              <SelectItem key={status} value={status}>
                {t(`document.reviewStatus.${status}`)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={expiringWithinDays || 'none'} onValueChange={(v) => pushParams({ expiringWithinDays: v === 'none' ? undefined : v, page: 1 })}>
          <SelectTrigger className="w-56">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {EXPIRY_WINDOWS.map((days) => (
              <SelectItem key={days || 'none'} value={days || 'none'}>
                {days ? t('document.list.expiringWithin', { days }) : t('document.list.anyExpiration')}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {canReview ? <p className="text-sm text-steel-600">{t('document.list.reviewQueueHint')}</p> : null}

      <DataTable
        caption={t('document.list.title')}
        columns={columns}
        data={rows}
        totalCount={total}
        page={page}
        pageSize={pageSize}
        onPageChange={(next) => pushParams({ page: next })}
        onPageSizeChange={(next) => pushParams({ pageSize: next, page: 1 })}
        emptyState={{ title: t('document.list.empty') }}
        errorState={{ title: t('common.states.error'), description: t('common.states.errorHint') }}
        renderMobileCard={(row) => (
          <a href={`${basePath}/${row.id}`} className="block rounded-lg border border-steel-200 p-3">
            <div className="flex items-center justify-between gap-2">
              <span className="font-semibold text-navy-700">{row.title ?? t(`document.types.${row.documentType}`)}</span>
              <StatusBadge kind="documentReview" value={row.reviewStatus} />
            </div>
            <p className="mt-1 text-xs text-steel-600">{t(`document.list.ownerTypes.${row.ownerType}`)}</p>
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
