'use client'

import * as React from 'react'
import {
  flexRender,
  getCoreRowModel,
  useReactTable,
  type ColumnDef,
  type RowSelectionState,
  type VisibilityState,
} from '@tanstack/react-table'
import { ArrowDown, ArrowUp, ArrowUpDown, MoreHorizontal, SlidersHorizontal } from 'lucide-react'
import { cn } from '@/lib/utils'
import {
  Table,
  TableBody,
  TableCaption,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { Checkbox } from '@/components/ui/checkbox'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { EmptyState, ErrorState, TableSkeleton } from '@/components/ui/feedback'
import { Pagination, type PaginationLabels } from '@/components/ui/pagination'

export interface DataTableSort {
  id: string
  desc: boolean
}

export interface DataTableRowAction<TData> {
  key: string
  label: string
  onSelect: (row: TData) => void
  destructive?: boolean
  disabled?: (row: TData) => boolean
}

export interface DataTableLabels {
  columnsMenu: string
  actionsMenu: string
  selectAll: string
  selectRow: string
  sortAscending: string
  sortDescending: string
  /** Screen-reader status text shown while the table is loading. */
  loading?: string
  pagination: PaginationLabels
}

export interface DataTableProps<TData> {
  caption: string
  columns: ColumnDef<TData, unknown>[]
  data: TData[]
  totalCount: number
  page: number
  pageSize: number
  pageSizeOptions?: number[]
  sort?: DataTableSort | null
  onSortChange?: (sort: DataTableSort | null) => void
  onPageChange: (page: number) => void
  onPageSizeChange?: (pageSize: number) => void
  isLoading?: boolean
  isError?: boolean
  emptyState: { title: string; description?: string; action?: React.ReactNode }
  errorState: { title: string; description?: string; action?: React.ReactNode }
  getRowId?: (row: TData) => string
  rowSelection?: RowSelectionState
  onRowSelectionChange?: (state: RowSelectionState) => void
  rowActions?: DataTableRowAction<TData>[]
  /** Custom mobile card renderer; falls back to a stacked label/value card. */
  renderMobileCard?: (row: TData) => React.ReactNode
  labels: DataTableLabels
  className?: string
}

/**
 * Server-driven data table: sort/filter/pagination changes are emitted as
 * callbacks, and URL state is the caller's responsibility. Renders a
 * responsive card list under `md` so a dispatcher on a phone can still read
 * the data.
 */
export function DataTable<TData>({
  caption,
  columns,
  data,
  totalCount,
  page,
  pageSize,
  pageSizeOptions,
  sort,
  onSortChange,
  onPageChange,
  onPageSizeChange,
  isLoading,
  isError,
  emptyState,
  errorState,
  getRowId,
  rowSelection,
  onRowSelectionChange,
  rowActions,
  renderMobileCard,
  labels,
  className,
}: DataTableProps<TData>) {
  const [columnVisibility, setColumnVisibility] = React.useState<VisibilityState>({})

  const table = useReactTable({
    data,
    columns,
    state: {
      columnVisibility,
      rowSelection: rowSelection ?? {},
    },
    manualSorting: true,
    manualPagination: true,
    manualFiltering: true,
    enableRowSelection: Boolean(onRowSelectionChange),
    getRowId: getRowId as never,
    onColumnVisibilityChange: setColumnVisibility,
    onRowSelectionChange: onRowSelectionChange
      ? (updater) => {
          const next = typeof updater === 'function' ? updater(rowSelection ?? {}) : updater
          onRowSelectionChange(next)
        }
      : undefined,
    getCoreRowModel: getCoreRowModel(),
  })

  const hasSelection = Boolean(onRowSelectionChange)
  const showActionsColumn = Boolean(rowActions && rowActions.length > 0)

  function toggleSort(columnId: string) {
    if (!onSortChange) return
    if (!sort || sort.id !== columnId) {
      onSortChange({ id: columnId, desc: false })
    } else if (!sort.desc) {
      onSortChange({ id: columnId, desc: true })
    } else {
      onSortChange(null)
    }
  }

  const headerGroups = table.getHeaderGroups()
  const rows = table.getRowModel().rows

  return (
    <div className={cn('flex flex-col', className)}>
      <div className="flex items-center justify-end gap-2 border-b border-steel-200 px-3 py-2">
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="secondary" size="sm">
              <SlidersHorizontal aria-hidden="true" />
              {labels.columnsMenu}
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuLabel>{labels.columnsMenu}</DropdownMenuLabel>
            <DropdownMenuSeparator />
            {table
              .getAllLeafColumns()
              .filter((column) => column.getCanHide())
              .map((column) => (
                <DropdownMenuCheckboxItem
                  key={column.id}
                  checked={column.getIsVisible()}
                  onCheckedChange={(checked) => column.toggleVisibility(Boolean(checked))}
                  onSelect={(event) => event.preventDefault()}
                >
                  {typeof column.columnDef.header === 'string' ? column.columnDef.header : column.id}
                </DropdownMenuCheckboxItem>
              ))}
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      {/* Desktop table */}
      <div className="hidden md:block">
        <Table>
          <TableCaption>{caption}</TableCaption>
          <TableHeader className="sticky top-0 z-10">
            {headerGroups.map((group) => (
              <TableRow key={group.id}>
                {hasSelection ? (
                  <TableHead className="w-10">
                    <Checkbox
                      checked={
                        table.getIsAllPageRowsSelected() ||
                        (table.getIsSomePageRowsSelected() ? 'indeterminate' : false)
                      }
                      onCheckedChange={(checked) => table.toggleAllPageRowsSelected(Boolean(checked))}
                      aria-label={labels.selectAll}
                    />
                  </TableHead>
                ) : null}
                {group.headers.map((header) => {
                  const canSort = onSortChange && header.column.columnDef.enableSorting !== false
                  const isSorted = sort?.id === header.column.id
                  const ariaSort = !canSort ? undefined : isSorted ? (sort!.desc ? 'descending' : 'ascending') : 'none'
                  const numeric = (header.column.columnDef.meta as { numeric?: boolean } | undefined)?.numeric
                  return (
                    <TableHead key={header.id} numeric={numeric} aria-sort={ariaSort as never}>
                      {header.isPlaceholder ? null : canSort ? (
                        <button
                          type="button"
                          onClick={() => toggleSort(header.column.id)}
                          className="inline-flex items-center gap-1 rounded-sm hover:text-navy-700 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--focus-ring)]"
                        >
                          {flexRender(header.column.columnDef.header, header.getContext())}
                          {isSorted ? (
                            sort!.desc ? (
                              <ArrowDown className="size-3.5" aria-hidden="true" />
                            ) : (
                              <ArrowUp className="size-3.5" aria-hidden="true" />
                            )
                          ) : (
                            <ArrowUpDown className="size-3.5 opacity-40" aria-hidden="true" />
                          )}
                          {isSorted ? (
                            <span className="sr-only">
                              {sort!.desc ? labels.sortDescending : labels.sortAscending}
                            </span>
                          ) : null}
                        </button>
                      ) : (
                        flexRender(header.column.columnDef.header, header.getContext())
                      )}
                    </TableHead>
                  )
                })}
                {showActionsColumn ? (
                  <TableHead className="w-10">
                    <span className="sr-only">{labels.actionsMenu}</span>
                  </TableHead>
                ) : null}
              </TableRow>
            ))}
          </TableHeader>
          <TableBody>
            {isLoading ? (
              <tr>
                <td colSpan={columns.length + (hasSelection ? 1 : 0) + (showActionsColumn ? 1 : 0)}>
                  <TableSkeleton columns={columns.length} label={labels.loading} />
                </td>
              </tr>
            ) : isError ? (
              <tr>
                <td colSpan={columns.length + (hasSelection ? 1 : 0) + (showActionsColumn ? 1 : 0)}>
                  <ErrorState title={errorState.title} description={errorState.description} action={errorState.action} />
                </td>
              </tr>
            ) : rows.length === 0 ? (
              <tr>
                <td colSpan={columns.length + (hasSelection ? 1 : 0) + (showActionsColumn ? 1 : 0)}>
                  <EmptyState title={emptyState.title} description={emptyState.description} action={emptyState.action} />
                </td>
              </tr>
            ) : (
              rows.map((row) => (
                <TableRow key={row.id} data-state={row.getIsSelected() ? 'selected' : undefined}>
                  {hasSelection ? (
                    <TableCell>
                      <Checkbox
                        checked={row.getIsSelected()}
                        onCheckedChange={(checked) => row.toggleSelected(Boolean(checked))}
                        aria-label={labels.selectRow}
                      />
                    </TableCell>
                  ) : null}
                  {row.getVisibleCells().map((cell) => {
                    const numeric = (cell.column.columnDef.meta as { numeric?: boolean } | undefined)?.numeric
                    return (
                      <TableCell key={cell.id} numeric={numeric}>
                        {flexRender(cell.column.columnDef.cell, cell.getContext())}
                      </TableCell>
                    )
                  })}
                  {showActionsColumn ? (
                    <TableCell>
                      <RowActionsMenu row={row.original} actions={rowActions!} label={labels.actionsMenu} />
                    </TableCell>
                  ) : null}
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>

      {/* Mobile cards */}
      <div className="space-y-3 p-3 md:hidden">
        {isLoading ? (
          <TableSkeleton columns={2} rows={4} label={labels.loading} />
        ) : isError ? (
          <ErrorState title={errorState.title} description={errorState.description} action={errorState.action} />
        ) : rows.length === 0 ? (
          <EmptyState title={emptyState.title} description={emptyState.description} action={emptyState.action} />
        ) : (
          rows.map((row) => (
            <div key={row.id} className="surface-card p-4">
              {renderMobileCard ? (
                renderMobileCard(row.original)
              ) : (
                <dl className="grid grid-cols-2 gap-2 text-sm">
                  {row.getVisibleCells().map((cell) => (
                    <div key={cell.id} className="col-span-2 flex justify-between gap-3 border-b border-steel-100 py-1 last:border-0">
                      <dt className="text-steel-600">
                        {typeof cell.column.columnDef.header === 'string' ? cell.column.columnDef.header : cell.column.id}
                      </dt>
                      <dd className="text-right font-medium text-carbon">
                        {flexRender(cell.column.columnDef.cell, cell.getContext())}
                      </dd>
                    </div>
                  ))}
                </dl>
              )}
              {showActionsColumn ? (
                <div className="mt-3 flex justify-end">
                  <RowActionsMenu row={row.original} actions={rowActions!} label={labels.actionsMenu} />
                </div>
              ) : null}
            </div>
          ))
        )}
      </div>

      {!isLoading && !isError && rows.length > 0 ? (
        <Pagination
          page={page}
          pageSize={pageSize}
          totalCount={totalCount}
          pageSizeOptions={pageSizeOptions}
          onPageChange={onPageChange}
          onPageSizeChange={onPageSizeChange}
          labels={labels.pagination}
        />
      ) : null}
    </div>
  )
}

function RowActionsMenu<TData>({
  row,
  actions,
  label,
}: {
  row: TData
  actions: DataTableRowAction<TData>[]
  label: string
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="iconSm" aria-label={label}>
          <MoreHorizontal aria-hidden="true" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        {actions.map((action) => (
          <DropdownMenuItem
            key={action.key}
            destructive={action.destructive}
            disabled={action.disabled?.(row)}
            onSelect={() => action.onSelect(row)}
          >
            {action.label}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
