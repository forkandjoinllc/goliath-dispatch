import * as React from 'react'
import { describe, expect, it, vi } from 'vitest'
import userEvent from '@testing-library/user-event'
import { screen } from '@testing-library/react'
import type { ColumnDef } from '@tanstack/react-table'
import { renderWithProviders } from './test-utils'
import { DataTable, type DataTableLabels } from '@/components/data/data-table'

interface Load {
  id: string
  reference: string
  rateCents: number
}

const columns: ColumnDef<Load, unknown>[] = [
  { id: 'reference', header: 'Reference', accessorKey: 'reference' },
  { id: 'rateCents', header: 'Rate', accessorKey: 'rateCents', meta: { numeric: true } },
]

const labels: DataTableLabels = {
  columnsMenu: 'Columns',
  actionsMenu: 'Actions',
  selectAll: 'Select all',
  selectRow: 'Select row',
  sortAscending: 'Sort ascending',
  sortDescending: 'Sort descending',
  pagination: {
    pageStatus: 'Page 1 of 1',
    firstPage: 'First page',
    previousPage: 'Previous page',
    nextPage: 'Next page',
    lastPage: 'Last page',
    rowsPerPage: 'Rows per page',
  },
}

const data: Load[] = [
  { id: '1', reference: 'GD-1001', rateCents: 250000 },
  { id: '2', reference: 'GD-1002', rateCents: 180000 },
]

describe('DataTable', () => {
  it('renders the empty state when there are no rows', () => {
    renderWithProviders(
      <DataTable
        caption="Loads"
        columns={columns}
        data={[]}
        totalCount={0}
        page={1}
        pageSize={25}
        emptyState={{ title: 'No loads yet' }}
        errorState={{ title: 'Something went wrong' }}
        onPageChange={vi.fn()}
        labels={labels}
      />,
    )
    expect(screen.getAllByText('No loads yet').length).toBeGreaterThan(0)
  })

  it('renders the loading state', () => {
    renderWithProviders(
      <DataTable
        caption="Loads"
        columns={columns}
        data={[]}
        totalCount={0}
        page={1}
        pageSize={25}
        isLoading
        emptyState={{ title: 'No loads yet' }}
        errorState={{ title: 'Something went wrong' }}
        onPageChange={vi.fn()}
        labels={labels}
      />,
    )
    expect(screen.getAllByRole('status').length).toBeGreaterThan(0)
  })

  it('renders the error state', () => {
    renderWithProviders(
      <DataTable
        caption="Loads"
        columns={columns}
        data={[]}
        totalCount={0}
        page={1}
        pageSize={25}
        isError
        emptyState={{ title: 'No loads yet' }}
        errorState={{ title: 'Could not load data', description: 'Try again later.' }}
        onPageChange={vi.fn()}
        labels={labels}
      />,
    )
    expect(screen.getAllByText('Could not load data').length).toBeGreaterThan(0)
  })

  it('exposes sort state through aria-sort and announces the change via the callback', async () => {
    const user = userEvent.setup()
    const onSortChange = vi.fn()
    renderWithProviders(
      <DataTable
        caption="Loads"
        columns={columns}
        data={data}
        totalCount={data.length}
        page={1}
        pageSize={25}
        sort={null}
        onSortChange={onSortChange}
        emptyState={{ title: 'No loads yet' }}
        errorState={{ title: 'Something went wrong' }}
        onPageChange={vi.fn()}
        labels={labels}
      />,
    )

    const referenceHeader = screen.getByRole('columnheader', { name: /reference/i })
    expect(referenceHeader).toHaveAttribute('aria-sort', 'none')

    await user.click(screen.getByRole('button', { name: 'Reference' }))
    expect(onSortChange).toHaveBeenCalledWith({ id: 'reference', desc: false })
  })
})
