'use client'

import * as React from 'react'
import { useRouter } from 'next/navigation'
import { Receipt } from 'lucide-react'
import type { ColumnDef } from '@tanstack/react-table'
import { DataTable } from '@/components/data/data-table'
import { Badge } from '@/components/ui/badge'
import { useI18n, useTranslate } from '@/components/providers/i18n-provider'
import { formatMoney, formatDate } from '@/i18n/translate'
import type { Expense } from '@/db/schema'

const STATUS_TONE = {
  submitted: 'info',
  approved: 'success',
  rejected: 'danger',
  reimbursed: 'navy',
} as const

export interface ExpenseListProps {
  locale: string
  rows: Expense[]
  total: number
  page: number
  pageSize: number
  status: string
  loadNumberById: Record<string, string>
  carrierNameById: Record<string, string>
  categoryLabelById: Record<string, string>
}

export function ExpenseList({
  locale,
  rows,
  total,
  page,
  pageSize,
  status,
  loadNumberById,
  carrierNameById,
  categoryLabelById,
}: ExpenseListProps) {
  const router = useRouter()
  const t = useTranslate()
  const { locale: i18nLocale, timezone } = useI18n()
  const basePath = `/${locale}/app/expenses`

  function pushParams(next: Record<string, string | number | undefined>) {
    const params = new URLSearchParams({ page: String(page), pageSize: String(pageSize), status })
    for (const [key, value] of Object.entries(next)) {
      if (value === undefined || value === '') params.delete(key)
      else params.set(key, String(value))
    }
    router.push(`${basePath}?${params.toString()}`)
  }

  const columns: ColumnDef<Expense, unknown>[] = [
    {
      accessorKey: 'category',
      header: t('finance.expense.fields.category'),
      cell: ({ row }) => (
        <a href={`${basePath}/${row.original.id}`} className="font-semibold text-navy-700 hover:underline">
          {categoryLabelById[row.original.categoryId] ?? '—'}
        </a>
      ),
    },
    {
      accessorKey: 'target',
      header: `${t('finance.expense.fields.load')} / ${t('finance.expense.fields.carrier')}`,
      cell: ({ row }) => {
        const { loadId, carrierId } = row.original
        if (loadId) return <span>{loadNumberById[loadId] ?? loadId}</span>
        if (carrierId) return <span>{carrierNameById[carrierId] ?? carrierId}</span>
        return <span>—</span>
      },
    },
    {
      accessorKey: 'amountCents',
      header: t('finance.expense.fields.amount'),
      cell: ({ row }) => <span className="tabular">{formatMoney(row.original.amountCents, i18nLocale)}</span>,
    },
    {
      accessorKey: 'status',
      header: t('finance.expense.fields.status'),
      cell: ({ row }) => (
        <Badge tone={STATUS_TONE[row.original.status]}>{t(`finance.expense.status.${row.original.status}`)}</Badge>
      ),
    },
    {
      accessorKey: 'createdAt',
      header: t('finance.expense.fields.submittedAt'),
      cell: ({ row }) => <span>{formatDate(row.original.createdAt, i18nLocale, timezone)}</span>,
    },
  ]

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-2">
        {(['', 'submitted', 'approved', 'rejected', 'reimbursed'] as const).map((option) => (
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
            {option ? t(`finance.expense.status.${option}`) : t('finance.expense.list.allStatuses')}
          </button>
        ))}
      </div>

      <DataTable
        caption={t('finance.expense.title')}
        columns={columns}
        data={rows}
        totalCount={total}
        page={page}
        pageSize={pageSize}
        onPageChange={(next) => pushParams({ page: next })}
        onPageSizeChange={(next) => pushParams({ pageSize: next, page: 1 })}
        emptyState={{ title: t('finance.expense.list.empty') }}
        errorState={{ title: t('common.states.error'), description: t('common.states.errorHint') }}
        renderMobileCard={(row) => (
          <a href={`${basePath}/${row.id}`} className="block rounded-lg border border-steel-200 p-3">
            <div className="flex items-center justify-between gap-2">
              <span className="flex items-center gap-2 font-semibold text-navy-700">
                <Receipt className="size-4" aria-hidden="true" />
                {categoryLabelById[row.categoryId] ?? '—'}
              </span>
              <Badge tone={STATUS_TONE[row.status]}>{t(`finance.expense.status.${row.status}`)}</Badge>
            </div>
            <div className="mt-1 text-sm tabular text-steel-700">{formatMoney(row.amountCents, i18nLocale)}</div>
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
