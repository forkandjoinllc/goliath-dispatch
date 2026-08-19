'use client'

import type { ColumnDef } from '@tanstack/react-table'
import { DataTable } from '@/components/data/data-table'
import { Badge } from '@/components/ui/badge'
import { useI18n, useTranslate } from '@/components/providers/i18n-provider'
import { formatDate } from '@/i18n/translate'
import type { FactoringAssignment } from '@/db/schema'

const VERIFICATION_TONE = {
  not_started: 'neutral',
  pending: 'warning',
  verified: 'success',
  mismatch: 'danger',
  failed: 'danger',
  manually_overridden: 'warning',
  expired: 'danger',
} as const

export function FactoringAssignmentList({
  locale,
  assignments,
  carrierNameById,
  companyNameById,
}: {
  locale: string
  assignments: FactoringAssignment[]
  carrierNameById: Record<string, string>
  companyNameById: Record<string, string>
}) {
  const t = useTranslate()
  const { locale: i18nLocale, timezone } = useI18n()
  const basePath = `/${locale}/app/factoring/assignments`

  const columns: ColumnDef<FactoringAssignment, unknown>[] = [
    {
      accessorKey: 'carrierId',
      header: t('finance.factoring.assignments.fields.carrier'),
      cell: ({ row }) => (
        <a href={`${basePath}/${row.original.id}`} className="font-semibold text-navy-700 hover:underline">
          {carrierNameById[row.original.carrierId] ?? '—'}
        </a>
      ),
    },
    {
      accessorKey: 'factoringCompanyId',
      header: t('finance.factoring.assignments.fields.factoringCompany'),
      cell: ({ row }) => <span>{companyNameById[row.original.factoringCompanyId] ?? '—'}</span>,
    },
    {
      accessorKey: 'verificationStatus',
      header: t('finance.factoring.assignments.fields.verificationStatus'),
      cell: ({ row }) => (
        <Badge tone={VERIFICATION_TONE[row.original.verificationStatus]}>
          {t(`finance.factoring.assignments.verificationStatus.${row.original.verificationStatus}`)}
        </Badge>
      ),
    },
    {
      accessorKey: 'effectiveFrom',
      header: t('finance.factoring.assignments.fields.effectiveFrom'),
      cell: ({ row }) => <span>{formatDate(row.original.effectiveFrom, i18nLocale, timezone)}</span>,
    },
    {
      accessorKey: 'effectiveTo',
      header: t('finance.factoring.assignments.fields.effectiveTo'),
      cell: ({ row }) => <span>{formatDate(row.original.effectiveTo, i18nLocale, timezone)}</span>,
    },
  ]

  return (
    <DataTable
      caption={t('finance.factoring.assignments.title')}
      columns={columns}
      data={assignments}
      totalCount={assignments.length}
      page={1}
      pageSize={Math.max(assignments.length, 1)}
      onPageChange={() => {}}
      onPageSizeChange={() => {}}
      emptyState={{ title: t('finance.factoring.assignments.empty') }}
      errorState={{ title: t('common.states.error'), description: t('common.states.errorHint') }}
      renderMobileCard={(row) => (
        <a href={`${basePath}/${row.id}`} className="block rounded-lg border border-steel-200 p-3">
          <div className="flex items-center justify-between gap-2">
            <span className="font-semibold text-navy-700">{carrierNameById[row.carrierId] ?? '—'}</span>
            <Badge tone={VERIFICATION_TONE[row.verificationStatus]}>
              {t(`finance.factoring.assignments.verificationStatus.${row.verificationStatus}`)}
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
          pageStatus: t('common.labels.page', { page: 1, total: 1 }),
          resultsStatus: t('common.labels.results', { count: assignments.length }),
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
