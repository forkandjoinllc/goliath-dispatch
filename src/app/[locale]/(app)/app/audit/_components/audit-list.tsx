'use client'

import * as React from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import type { ColumnDef } from '@tanstack/react-table'
import { DataTable } from '@/components/data/data-table'
import { Badge } from '@/components/ui/badge'
import { useI18n, useTranslate } from '@/components/providers/i18n-provider'
import { formatDateTime } from '@/i18n/translate'

export interface AuditListRow {
  id: string
  occurredAt: Date
  actorEmail: string | null
  actorRole: string | null
  effectiveUserId: string | null
  actorUserId: string | null
  impersonationSessionId: string | null
  action: string
  entityType: string | null
  entityId: string | null
  entityLabel: string | null
  reason: string | null
  requestId: string | null
}

export interface AuditListProps {
  locale: string
  rows: AuditListRow[]
  total: number
  page: number
  pageSize: number
  queryString: string
}

export function AuditList({ locale, rows, total, page, pageSize, queryString }: AuditListProps) {
  const router = useRouter()
  const t = useTranslate()
  const { locale: i18nLocale, timezone } = useI18n()
  const basePath = `/${locale}/app/audit`

  function pushPage(nextPage: number, nextPageSize?: number) {
    const params = new URLSearchParams(queryString)
    params.set('page', String(nextPage))
    if (nextPageSize) params.set('pageSize', String(nextPageSize))
    router.push(`${basePath}?${params.toString()}`)
  }

  const columns: ColumnDef<AuditListRow, unknown>[] = [
    {
      accessorKey: 'occurredAt',
      header: t('report.audit.columns.occurredAt'),
      cell: ({ row }) => <span className="tabular text-xs">{formatDateTime(row.original.occurredAt, i18nLocale, timezone)}</span>,
    },
    {
      accessorKey: 'actor',
      header: t('report.audit.columns.actor'),
      cell: ({ row }) => (
        <div className="flex flex-col text-xs">
          <span className="font-medium text-carbon">{row.original.actorEmail ?? t('report.values.system')}</span>
          {row.original.impersonationSessionId ? (
            <Link
              href={`${basePath}/impersonation/${row.original.impersonationSessionId}`}
              className="text-navy-600 hover:underline"
            >
              {t('report.audit.impersonated')}
            </Link>
          ) : null}
        </div>
      ),
    },
    {
      accessorKey: 'action',
      header: t('report.audit.columns.action'),
      cell: ({ row }) => (
        <span className="font-mono text-xs">
          {row.original.action}
          {row.original.reason ? <Badge tone="warning" className="ml-2">{t('report.audit.reasonBadge')}</Badge> : null}
        </span>
      ),
    },
    {
      accessorKey: 'entity',
      header: t('report.audit.columns.entity'),
      cell: ({ row }) => (
        <span className="text-xs text-steel-700">
          {row.original.entityType ?? '—'}
          {row.original.entityLabel ? ` · ${row.original.entityLabel}` : ''}
        </span>
      ),
    },
    {
      accessorKey: 'requestId',
      header: t('report.audit.columns.requestId'),
      cell: ({ row }) =>
        row.original.requestId ? (
          <Link href={`${basePath}/request/${row.original.requestId}`} className="font-mono text-xs text-navy-600 hover:underline">
            {row.original.requestId.slice(0, 8)}…
          </Link>
        ) : (
          <span className="text-xs text-steel-400">—</span>
        ),
    },
    {
      accessorKey: 'reason',
      header: t('report.audit.columns.reason'),
      cell: ({ row }) => <span className="text-xs text-steel-700">{row.original.reason ?? '—'}</span>,
    },
  ]

  return (
    <DataTable
      caption={t('report.audit.title')}
      columns={columns}
      data={rows}
      totalCount={total}
      page={page}
      pageSize={pageSize}
      onPageChange={(next) => pushPage(next)}
      onPageSizeChange={(next) => pushPage(1, next)}
      emptyState={{ title: t('report.audit.empty') }}
      errorState={{ title: t('common.states.error'), description: t('common.states.errorHint') }}
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
  )
}
