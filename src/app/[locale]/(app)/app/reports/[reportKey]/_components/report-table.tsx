'use client'

import * as React from 'react'
import type { ColumnDef } from '@tanstack/react-table'
import { DataTable } from '@/components/data/data-table'
import { BarChart, LineChart } from '@/components/data/chart'
import { EmptyState } from '@/components/ui/feedback'
import { useI18n, useTranslate } from '@/components/providers/i18n-provider'
import { formatBps, formatDate, formatMoney, formatNumber } from '@/i18n/translate'

export interface ReportTableColumn {
  key: string
  labelKey: string
  type: 'string' | 'integer' | 'currency' | 'percent' | 'date' | 'bps'
  numeric?: boolean
}

export interface ReportChartSpec {
  type: 'line' | 'bar' | 'donut'
  xKey: string
  series: Array<{ key: string; labelKey: string }>
}

export interface ReportTableProps {
  columns: ReportTableColumn[]
  rows: Array<Record<string, unknown>>
  summary?: Record<string, unknown> | null
  chart?: ReportChartSpec
  caption: string
}

/**
 * Renders whatever columns/rows a report's `run()` returned. Column shape is
 * dynamic per report, so `ColumnDef`s are generated from `ReportColumn[]`
 * rather than declared per report — this is also why a carrier's narrower
 * `CARRIER_COLUMNS` set (see `revenue-margin.ts`) is reflected automatically:
 * a column that was never in the array the server sent is simply never
 * rendered, not hidden client-side.
 */
export function ReportTable({ columns, rows, summary, chart, caption }: ReportTableProps) {
  const t = useTranslate()
  const { locale, timezone } = useI18n()

  function renderCell(value: unknown, column: ReportTableColumn): React.ReactNode {
    if (value === null || value === undefined || value === '') return t('report.values.empty')
    if (typeof value === 'string' && value.startsWith('report.')) {
      const translated = t.optional(value)
      if (translated !== null) return translated
    }
    switch (column.type) {
      case 'currency':
        return formatMoney(Number(value), locale)
      case 'percent':
        return `${formatNumber(Number(value), locale, { maximumFractionDigits: 2 })}%`
      case 'bps':
        return formatBps(Number(value), locale)
      case 'date':
        return formatDate(value as Date | string, locale, timezone)
      case 'integer':
        return formatNumber(Number(value), locale)
      case 'string':
      default:
        return String(value)
    }
  }

  const tableColumns: ColumnDef<Record<string, unknown>, unknown>[] = columns.map((column) => ({
    accessorKey: column.key,
    header: t(column.labelKey),
    cell: ({ row }) => (
      <span className={column.numeric ? 'tabular block text-right' : undefined}>
        {renderCell(row.original[column.key], column)}
      </span>
    ),
  }))

  const chartData = chart ? rows.map((row) => ({ ...row })) : null

  return (
    <div className="space-y-6">
      {chart && chartData && chartData.length > 0 ? (
        <div className="rounded-lg border border-steel-200 bg-white p-4">
          {chart.type === 'line' ? (
            <LineChart
              data={chartData}
              xKey={chart.xKey}
              xLabel={t(columns.find((c) => c.key === chart.xKey)?.labelKey ?? chart.xKey)}
              series={chart.series.map((s) => ({ key: s.key, label: t(s.labelKey) }))}
              caption={caption}
            />
          ) : (
            <BarChart
              data={chartData}
              xKey={chart.xKey}
              xLabel={t(columns.find((c) => c.key === chart.xKey)?.labelKey ?? chart.xKey)}
              series={chart.series.map((s) => ({ key: s.key, label: t(s.labelKey) }))}
              caption={caption}
            />
          )}
        </div>
      ) : null}

      {rows.length === 0 ? (
        <EmptyState title={t('report.table.empty')} />
      ) : (
        <div className="space-y-2">
          <DataTable
            caption={caption}
            columns={tableColumns}
            data={rows}
            totalCount={rows.length}
            page={1}
            pageSize={Math.max(rows.length, 1)}
            onPageChange={() => {}}
            emptyState={{ title: t('report.table.empty') }}
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
                pageStatus: t('common.labels.page', { page: 1, total: 1 }),
                resultsStatus: t('common.labels.results', { count: rows.length }),
                firstPage: t('common.table.firstPage'),
                previousPage: t('common.table.previousPage'),
                nextPage: t('common.table.nextPage'),
                lastPage: t('common.table.lastPage'),
                rowsPerPage: t('common.table.rowsPerPage'),
              },
            }}
          />
          {summary ? (
            <div className="flex flex-wrap items-center gap-x-6 gap-y-2 rounded-lg border border-navy-100 bg-navy-50/60 px-4 py-3 text-sm">
              <span className="font-semibold uppercase tracking-wide text-navy-700">{t('report.table.summary')}</span>
              {columns
                .filter((column) => column.key in summary)
                .map((column) => (
                  <span key={column.key} className="flex items-baseline gap-1.5">
                    <span className="text-xs text-steel-600">{t(column.labelKey)}:</span>
                    <span className="tabular font-semibold text-carbon">{renderCell(summary[column.key], column)}</span>
                  </span>
                ))}
            </div>
          ) : null}
        </div>
      )}
    </div>
  )
}
