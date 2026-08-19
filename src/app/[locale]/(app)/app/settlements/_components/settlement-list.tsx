'use client'

import { useRouter } from 'next/navigation'
import { Wallet } from 'lucide-react'
import type { ColumnDef } from '@tanstack/react-table'
import { DataTable } from '@/components/data/data-table'
import { Badge } from '@/components/ui/badge'
import { useI18n, useTranslate } from '@/components/providers/i18n-provider'
import { formatDate, formatMoney } from '@/i18n/translate'
import type { CarrierSettlement } from '@/db/schema'

const STATUS_TONE = { draft: 'neutral', issued: 'info', paid: 'success', voided: 'danger' } as const

export function SettlementList({
  locale,
  rows,
  total,
  page,
  pageSize,
  status,
  carrierNameById,
}: {
  locale: string
  rows: CarrierSettlement[]
  total: number
  page: number
  pageSize: number
  status: string
  carrierNameById: Record<string, string>
}) {
  const router = useRouter()
  const t = useTranslate()
  const { locale: i18nLocale, timezone } = useI18n()
  const basePath = `/${locale}/app/settlements`

  function pushParams(next: Record<string, string | number | undefined>) {
    const params = new URLSearchParams({ page: String(page), pageSize: String(pageSize), status })
    for (const [key, value] of Object.entries(next)) {
      if (value === undefined || value === '') params.delete(key)
      else params.set(key, String(value))
    }
    router.push(`${basePath}?${params.toString()}`)
  }

  const columns: ColumnDef<CarrierSettlement, unknown>[] = [
    {
      accessorKey: 'settlementNumber',
      header: t('finance.settlement.fields.settlementNumber'),
      cell: ({ row }) => (
        <a href={`${basePath}/${row.original.id}`} className="font-semibold text-navy-700 hover:underline">
          {row.original.settlementNumber}
        </a>
      ),
    },
    {
      accessorKey: 'carrierId',
      header: t('finance.settlement.fields.carrier'),
      cell: ({ row }) => (
        <a
          href={`${basePath}/statement/${row.original.carrierId}`}
          className="text-navy-700 hover:underline"
        >
          {carrierNameById[row.original.carrierId] ?? '—'}
        </a>
      ),
    },
    {
      accessorKey: 'status',
      header: t('finance.settlement.fields.status'),
      cell: ({ row }) => (
        <Badge tone={STATUS_TONE[row.original.status as keyof typeof STATUS_TONE]}>
          {t(`finance.settlement.status.${row.original.status}`)}
        </Badge>
      ),
    },
    {
      accessorKey: 'periodEnd',
      header: t('finance.settlement.fields.periodEnd'),
      cell: ({ row }) => <span>{formatDate(row.original.periodEnd, i18nLocale, timezone)}</span>,
    },
    {
      accessorKey: 'netAmountCents',
      header: t('finance.settlement.fields.netAmount'),
      cell: ({ row }) => <span className="tabular">{formatMoney(row.original.netAmountCents, i18nLocale)}</span>,
    },
  ]

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-2">
        {(['', 'draft', 'issued', 'paid', 'voided'] as const).map((option) => (
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
            {option ? t(`finance.settlement.status.${option}`) : t('finance.expense.list.allStatuses')}
          </button>
        ))}
      </div>

      <DataTable
        caption={t('finance.settlement.title')}
        columns={columns}
        data={rows}
        totalCount={total}
        page={page}
        pageSize={pageSize}
        onPageChange={(next) => pushParams({ page: next })}
        onPageSizeChange={(next) => pushParams({ pageSize: next, page: 1 })}
        emptyState={{ title: t('finance.settlement.list.empty') }}
        errorState={{ title: t('common.states.error'), description: t('common.states.errorHint') }}
        renderMobileCard={(row) => (
          <a href={`${basePath}/${row.id}`} className="block rounded-lg border border-steel-200 p-3">
            <div className="flex items-center justify-between gap-2">
              <span className="flex items-center gap-2 font-semibold text-navy-700">
                <Wallet className="size-4" aria-hidden="true" />
                {row.settlementNumber}
              </span>
              <Badge tone={STATUS_TONE[row.status as keyof typeof STATUS_TONE]}>
                {t(`finance.settlement.status.${row.status}`)}
              </Badge>
            </div>
            <div className="mt-1 text-sm tabular text-steel-700">{formatMoney(row.netAmountCents, i18nLocale)}</div>
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
