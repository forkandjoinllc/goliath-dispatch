'use client'

import * as React from 'react'
import { useRouter } from 'next/navigation'
import type { ColumnDef } from '@tanstack/react-table'
import { DataTable } from '@/components/data/data-table'
import { StatusBadge } from '@/components/status/status-badge'
import { ComplianceBadge, type ComplianceState } from '@/components/status/compliance-badge'
import { Input } from '@/components/ui/input'
import { useI18n, useTranslate } from '@/components/providers/i18n-provider'
import { formatDateTime } from '@/i18n/translate'
import type { Carrier } from '@/db/schema'
import type { onboardingStatusEnum } from '@/db/schema/_shared'

export interface CarrierListRow {
  carrier: Carrier
  dispatcherName: string | null
  complianceState: ComplianceState
}

export interface CarrierListProps {
  locale: string
  rows: CarrierListRow[]
  total: number
  page: number
  pageSize: number
  search: string
  onboardingStatus: string
  onboardingStatuses: readonly (typeof onboardingStatusEnum.enumValues)[number][]
}

/**
 * Server-driven `DataTable` for the tenant's carrier roster. Filters and
 * pagination live in the URL so the list is bookmarkable and back-button
 * safe, matching the convention set by the equipment list.
 */
export function CarrierList({
  locale,
  rows,
  total,
  page,
  pageSize,
  search,
  onboardingStatus,
  onboardingStatuses,
}: CarrierListProps) {
  const router = useRouter()
  const t = useTranslate()
  const { locale: i18nLocale, timezone } = useI18n()
  const basePath = `/${locale}/app/carriers`

  function pushParams(next: Record<string, string | number | undefined>) {
    const params = new URLSearchParams({
      page: String(page),
      pageSize: String(pageSize),
      search,
      onboardingStatus,
    })
    for (const [key, value] of Object.entries(next)) {
      if (value === undefined || value === '') params.delete(key)
      else params.set(key, String(value))
    }
    router.push(`${basePath}?${params.toString()}`)
  }

  const columns: ColumnDef<CarrierListRow, unknown>[] = [
    {
      accessorKey: 'legalName',
      header: t('carrier.list.columns.legalName'),
      cell: ({ row }) => (
        <a href={`${basePath}/${row.original.carrier.id}`} className="font-semibold text-navy-700 hover:underline">
          {row.original.carrier.legalName}
          {row.original.carrier.dba ? (
            <span className="ml-1 font-normal text-steel-500">({row.original.carrier.dba})</span>
          ) : null}
        </a>
      ),
    },
    {
      accessorKey: 'dotNumber',
      header: t('carrier.list.columns.dotMc'),
      cell: ({ row }) => (
        <span className="font-mono text-xs">
          {t('carrier.fields.dotNumber')} {row.original.carrier.dotNumber}
          {row.original.carrier.mcNumber ? ` · ${t('carrier.fields.mcNumber')} ${row.original.carrier.mcNumber}` : ''}
        </span>
      ),
    },
    {
      accessorKey: 'onboardingStatus',
      header: t('carrier.list.columns.onboardingStatus'),
      cell: ({ row }) => <StatusBadge kind="onboarding" value={row.original.carrier.onboardingStatus} />,
    },
    {
      accessorKey: 'fmcsaStatus',
      header: t('carrier.list.columns.fmcsaStatus'),
      cell: ({ row }) => <StatusBadge kind="verification" value={row.original.carrier.fmcsaStatus} />,
    },
    {
      accessorKey: 'dispatcherName',
      header: t('carrier.list.columns.assignedDispatcher'),
      cell: ({ row }) => row.original.dispatcherName ?? t('onboarding.board.unassigned'),
    },
    {
      accessorKey: 'complianceState',
      header: t('carrier.list.columns.compliance'),
      cell: ({ row }) => <ComplianceBadge state={row.original.complianceState} />,
    },
    {
      accessorKey: 'lastActivityAt',
      header: t('carrier.list.columns.lastActivity'),
      cell: ({ row }) =>
        row.original.carrier.lastActivityAt ? formatDateTime(row.original.carrier.lastActivityAt, i18nLocale, timezone) : t('common.labels.none'),
    },
  ]

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <Input
          defaultValue={search}
          placeholder={t('carrier.list.searchPlaceholder')}
          className="max-w-xs"
          onKeyDown={(event) => {
            if (event.key === 'Enter') pushParams({ search: (event.target as HTMLInputElement).value, page: 1 })
          }}
        />
        <div className="flex flex-wrap gap-2">
          {(['', ...onboardingStatuses] as const).map((option) => (
            <button
              key={option || 'all'}
              type="button"
              onClick={() => pushParams({ onboardingStatus: option, page: 1 })}
              aria-pressed={onboardingStatus === option}
              className={
                'rounded-full border px-3 py-1 text-xs font-semibold transition-colors ' +
                (onboardingStatus === option
                  ? 'border-navy-700 bg-navy-700 text-white'
                  : 'border-steel-300 bg-white text-steel-700 hover:bg-steel-50')
              }
            >
              {option ? t(`onboarding.status.${option}`) : t('carrier.list.allStatuses')}
            </button>
          ))}
        </div>
      </div>

      <DataTable
        caption={t('carrier.list.title')}
        columns={columns}
        data={rows}
        totalCount={total}
        page={page}
        pageSize={pageSize}
        onPageChange={(next) => pushParams({ page: next })}
        onPageSizeChange={(next) => pushParams({ pageSize: next, page: 1 })}
        emptyState={{ title: t('carrier.list.empty') }}
        errorState={{ title: t('common.states.error'), description: t('common.states.errorHint') }}
        renderMobileCard={(row) => (
          <a href={`${basePath}/${row.carrier.id}`} className="block rounded-lg border border-steel-200 p-3">
            <div className="flex items-center justify-between gap-2">
              <span className="font-semibold text-navy-700">{row.carrier.legalName}</span>
              <StatusBadge kind="onboarding" value={row.carrier.onboardingStatus} />
            </div>
            <p className="mt-1 font-mono text-xs text-steel-600">
              {t('carrier.fields.dotNumber')} {row.carrier.dotNumber}
            </p>
            <div className="mt-2 flex flex-wrap gap-2">
              <StatusBadge kind="verification" value={row.carrier.fmcsaStatus} />
              <ComplianceBadge state={row.complianceState} />
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
