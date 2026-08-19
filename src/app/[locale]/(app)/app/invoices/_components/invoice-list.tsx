'use client'

import { useRouter } from 'next/navigation'
import { Receipt } from 'lucide-react'
import type { ColumnDef } from '@tanstack/react-table'
import { DataTable } from '@/components/data/data-table'
import { StatusBadge } from '@/components/status/status-badge'
import { useI18n, useTranslate } from '@/components/providers/i18n-provider'
import { formatDate, formatMoney } from '@/i18n/translate'
import type { Invoice } from '@/db/schema'

export function InvoiceList({
  locale,
  rows,
  total,
  page,
  pageSize,
  status,
  overdueOnly,
  carrierNameById,
}: {
  locale: string
  rows: Invoice[]
  total: number
  page: number
  pageSize: number
  status: string
  overdueOnly: boolean
  carrierNameById: Record<string, string>
}) {
  const router = useRouter()
  const t = useTranslate()
  const { locale: i18nLocale, timezone } = useI18n()
  const basePath = `/${locale}/app/invoices`

  function pushParams(next: Record<string, string | number | undefined>) {
    const params = new URLSearchParams({
      page: String(page),
      pageSize: String(pageSize),
      status,
      overdueOnly: String(overdueOnly),
    })
    for (const [key, value] of Object.entries(next)) {
      if (value === undefined || value === '' || value === 'false') params.delete(key)
      else params.set(key, String(value))
    }
    router.push(`${basePath}?${params.toString()}`)
  }

  const columns: ColumnDef<Invoice, unknown>[] = [
    {
      accessorKey: 'invoiceNumber',
      header: t('finance.invoice.fields.invoiceNumber'),
      cell: ({ row }) => (
        <a href={`${basePath}/${row.original.id}`} className="font-semibold text-navy-700 hover:underline">
          {row.original.invoiceNumber}
        </a>
      ),
    },
    {
      accessorKey: 'carrierId',
      header: t('finance.invoice.fields.carrier'),
      cell: ({ row }) => <span>{carrierNameById[row.original.carrierId] ?? '—'}</span>,
    },
    {
      accessorKey: 'status',
      header: t('finance.invoice.fields.status'),
      cell: ({ row }) => <StatusBadge kind="invoice" value={row.original.status} />,
    },
    {
      accessorKey: 'totalCents',
      header: t('finance.invoice.fields.total'),
      cell: ({ row }) => <span className="tabular">{formatMoney(row.original.totalCents, i18nLocale)}</span>,
    },
    {
      accessorKey: 'balanceCents',
      header: t('finance.invoice.fields.balance'),
      cell: ({ row }) => <span className="tabular">{formatMoney(row.original.balanceCents, i18nLocale)}</span>,
    },
    {
      accessorKey: 'dueDate',
      header: t('finance.invoice.fields.dueDate'),
      cell: ({ row }) => <span>{formatDate(row.original.dueDate, i18nLocale, timezone)}</span>,
    },
  ]

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        {(['', 'draft', 'sent', 'due', 'overdue', 'paid', 'disputed', 'voided', 'uncollectable'] as const).map(
          (option) => (
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
              {option ? t(`finance.invoice.status.${option}`) : t('finance.invoice.list.allStatuses')}
            </button>
          ),
        )}
        <button
          type="button"
          onClick={() => pushParams({ overdueOnly: overdueOnly ? undefined : 'true', page: 1 })}
          aria-pressed={Boolean(overdueOnly)}
          className={
            'rounded-full border px-3 py-1 text-xs font-semibold transition-colors ' +
            (overdueOnly
              ? 'border-danger-500 bg-danger-50 text-danger-700'
              : 'border-steel-300 bg-white text-steel-700 hover:bg-steel-50')
          }
        >
          {t('finance.invoice.list.overdueOnly')}
        </button>
      </div>

      <DataTable
        caption={t('finance.invoice.title')}
        columns={columns}
        data={rows}
        totalCount={total}
        page={page}
        pageSize={pageSize}
        onPageChange={(next) => pushParams({ page: next })}
        onPageSizeChange={(next) => pushParams({ pageSize: next, page: 1 })}
        emptyState={{ title: t('finance.invoice.list.empty') }}
        errorState={{ title: t('common.states.error'), description: t('common.states.errorHint') }}
        renderMobileCard={(row) => (
          <a href={`${basePath}/${row.id}`} className="block rounded-lg border border-steel-200 p-3">
            <div className="flex items-center justify-between gap-2">
              <span className="flex items-center gap-2 font-semibold text-navy-700">
                <Receipt className="size-4" aria-hidden="true" />
                {row.invoiceNumber}
              </span>
              <StatusBadge kind="invoice" value={row.status} />
            </div>
            <div className="mt-1 text-sm tabular text-steel-700">{formatMoney(row.balanceCents, i18nLocale)}</div>
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
