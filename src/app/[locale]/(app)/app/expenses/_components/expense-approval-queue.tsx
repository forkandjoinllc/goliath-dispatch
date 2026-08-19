'use client'

import * as React from 'react'
import { useRouter } from 'next/navigation'
import { useTransition } from 'react'
import type { ColumnDef } from '@tanstack/react-table'
import { DataTable } from '@/components/data/data-table'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { useToast } from '@/components/ui/toast'
import { useI18n, useTranslate } from '@/components/providers/i18n-provider'
import { formatDate, formatMoney } from '@/i18n/translate'
import { bulkApproveExpensesAction } from '@/server/finance/actions'
import type { Expense } from '@/db/schema'

export function ExpenseApprovalQueue({
  locale,
  rows,
  total,
  page,
  pageSize,
  categoryLabelById,
  loadNumberById,
  carrierNameById,
}: {
  locale: string
  rows: Expense[]
  total: number
  page: number
  pageSize: number
  categoryLabelById: Record<string, string>
  loadNumberById: Record<string, string>
  carrierNameById: Record<string, string>
}) {
  const t = useTranslate()
  const { locale: i18nLocale, timezone } = useI18n()
  const router = useRouter()
  const { toast } = useToast()
  const [isPending, startTransition] = useTransition()
  const [selected, setSelected] = React.useState<Set<string>>(new Set())
  const basePath = `/${locale}/app/expenses`

  function toggle(id: string) {
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  function bulkApprove() {
    if (selected.size === 0) return
    startTransition(async () => {
      const result = await bulkApproveExpensesAction({ expenseIds: [...selected] })
      if (result.ok) {
        toast({ tone: 'success', title: t('finance.expense.approvalQueue.bulkApprovedToast', { count: result.data.length }) })
        setSelected(new Set())
        router.refresh()
        return
      }
      toast({ tone: 'error', title: t(result.error.messageKey, result.error.params) })
    })
  }

  const columns: ColumnDef<Expense, unknown>[] = [
    {
      id: 'select',
      header: '',
      cell: ({ row }) => (
        <Checkbox
          checked={selected.has(row.original.id)}
          onCheckedChange={() => toggle(row.original.id)}
          aria-label={t('common.table.selectRow')}
        />
      ),
    },
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
      accessorKey: 'createdAt',
      header: t('finance.expense.fields.submittedAt'),
      cell: ({ row }) => <span>{formatDate(row.original.createdAt, i18nLocale, timezone)}</span>,
    },
  ]

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-sm text-steel-600">{t('common.labels.results', { count: total })}</p>
        <Button type="button" disabled={isPending || selected.size === 0} onClick={bulkApprove}>
          {t('finance.expense.approvalQueue.approveSelected')}
        </Button>
      </div>
      <DataTable
        caption={t('finance.expense.approvalQueue.title')}
        columns={columns}
        data={rows}
        totalCount={total}
        page={page}
        pageSize={pageSize}
        onPageChange={(next) => router.push(`${basePath}/approvals?page=${next}`)}
        onPageSizeChange={(next) => router.push(`${basePath}/approvals?page=1&pageSize=${next}`)}
        emptyState={{ title: t('finance.expense.approvalQueue.empty') }}
        errorState={{ title: t('common.states.error'), description: t('common.states.errorHint') }}
        renderMobileCard={(row) => (
          <a href={`${basePath}/${row.id}`} className="block rounded-lg border border-steel-200 p-3">
            <div className="flex items-center justify-between gap-2">
              <span className="font-semibold text-navy-700">{categoryLabelById[row.categoryId] ?? '—'}</span>
              <span className="tabular text-sm">{formatMoney(row.amountCents, i18nLocale)}</span>
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
