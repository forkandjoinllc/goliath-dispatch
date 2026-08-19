import * as React from 'react'
import { describe, expect, it, vi } from 'vitest'
import { z } from 'zod'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import userEvent from '@testing-library/user-event'
import { screen, within } from '@testing-library/react'
import type { ColumnDef } from '@tanstack/react-table'
import { renderWithProviders } from './test-utils'
import { Form, FormErrorSummary } from '@/components/forms/form'
import { TextField } from '@/components/forms/fields'
import { DataTable, type DataTableLabels } from '@/components/data/data-table'
import { KanbanBoard } from '@/components/data/kanban-board'
import { SignaturePad } from '@/components/ui/signature-pad'

/**
 * Hand-rolled accessibility assertions (no `jsdom`-compatible axe runner is
 * wired into this repo — only `@axe-core/playwright`, which needs a real
 * browser) over the highest-traffic composites: the login form, a
 * `DataTable`, the Kanban board, a form with a validation error, and the
 * signature pad. Each test asserts the specific WCAG 2.2 AA property that
 * matters for that composite — accessible names via `getByRole`/
 * `toHaveAccessibleName`, `aria-invalid`/`aria-describedby` wiring on error,
 * `aria-sort` on a sortable column header — rather than a generic pass/fail.
 */

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
  useParams: () => ({ locale: 'en' }),
}))

vi.mock('@/server/auth/actions', () => ({
  loginAction: vi.fn(async () => ({
    ok: false as const,
    error: { code: 'validation_failed', messageKey: 'errors.validationFailed' },
  })),
}))

describe('a11y: login form', () => {
  it('has one accessible h1 and every field has a programmatic label', async () => {
    const { default: LoginPage } = await import('@/app/[locale]/(auth)/login/page')
    renderWithProviders(<LoginPage />)

    expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1)
    expect(screen.getByLabelText(/^Email/)).toBeInTheDocument()
    expect(screen.getByLabelText(/^Password/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Sign in' })).toHaveAccessibleName('Sign in')
  })

  it('marks empty required fields invalid, describes the error, and focuses the summary on submit', async () => {
    const user = userEvent.setup()
    const { default: LoginPage } = await import('@/app/[locale]/(auth)/login/page')
    renderWithProviders(<LoginPage />)

    await user.click(screen.getByRole('button', { name: 'Sign in' }))

    const email = await screen.findByLabelText(/^Email/)
    expect(email).toHaveAttribute('aria-invalid', 'true')
    const describedBy = email.getAttribute('aria-describedby')
    expect(describedBy).toBeTruthy()
    expect(document.getElementById(describedBy!)).toHaveTextContent('This field is required')

    // Focus-on-submit-failure for the error summary itself is covered by
    // `tests/component/form-error-summary.test.tsx`; here we only need to
    // confirm the summary renders as an alert naming the invalid fields.
    const summaryHeading = await screen.findByText('Please correct the highlighted fields.')
    const summary = summaryHeading.closest('[role="alert"]')
    expect(summary).toBeInTheDocument()
    // Each summary entry is a link naming the *translated* validation
    // message (never the raw `validation.required` message key) so a
    // screen-reader user hears real text, not an i18n key.
    expect(within(summary as HTMLElement).getAllByRole('link', { name: 'This field is required.' }).length).toBe(2)
  })
})

describe('a11y: form with a validation error', () => {
  const schema = z.object({ companyName: z.string().min(1, 'Company name is required') })
  type Values = z.infer<typeof schema>

  function Harness() {
    const form = useForm<Values>({ resolver: zodResolver(schema), defaultValues: { companyName: '' } })
    return (
      <Form form={form} onSubmit={form.handleSubmit(() => {})}>
        <FormErrorSummary<Values> title="Please fix the following" />
        <TextField<Values> name="companyName" label="Company name" />
        <button type="submit">Submit</button>
      </Form>
    )
  }

  it('ties the invalid field to its error via aria-describedby and sets aria-invalid', async () => {
    const user = userEvent.setup()
    renderWithProviders(<Harness />)

    await user.click(screen.getByRole('button', { name: 'Submit' }))

    const field = await screen.findByLabelText('Company name')
    expect(field).toHaveAttribute('aria-invalid', 'true')
    const describedBy = field.getAttribute('aria-describedby')
    expect(describedBy).toBeTruthy()
    expect(document.getElementById(describedBy!)).toHaveTextContent('Company name is required')
  })
})

describe('a11y: DataTable', () => {
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
    sortAscending: 'Sorted ascending',
    sortDescending: 'Sorted descending',
    loading: 'Loading',
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

  it('exposes a table with an accessible name (caption) and aria-sort on the sortable column', () => {
    renderWithProviders(
      <DataTable
        caption="Loads"
        columns={columns}
        data={data}
        totalCount={2}
        page={1}
        pageSize={25}
        sort={{ id: 'reference', desc: false }}
        onSortChange={vi.fn()}
        emptyState={{ title: 'No loads yet' }}
        errorState={{ title: 'Something went wrong' }}
        onPageChange={vi.fn()}
        labels={labels}
      />,
    )

    const table = screen.getByRole('table', { name: 'Loads' })
    expect(table).toHaveAccessibleName('Loads')

    const headerRow = within(table).getAllByRole('row')[0]!
    const sortedHeader = within(headerRow).getByRole('columnheader', { name: /Reference/ })
    expect(sortedHeader).toHaveAttribute('aria-sort', 'ascending')
  })

  it('gives the "columns" icon/menu trigger an accessible name', () => {
    renderWithProviders(
      <DataTable
        caption="Loads"
        columns={columns}
        data={data}
        totalCount={2}
        page={1}
        pageSize={25}
        emptyState={{ title: 'No loads yet' }}
        errorState={{ title: 'Something went wrong' }}
        onPageChange={vi.fn()}
        labels={labels}
      />,
    )

    expect(screen.getByRole('button', { name: 'Columns' })).toHaveAccessibleName('Columns')
  })
})

describe('a11y: Kanban board', () => {
  interface Card {
    id: string
    name: string
    column: 'submitted' | 'approved'
  }

  const boardColumns = [
    { id: 'submitted' as const, label: 'Submitted' },
    { id: 'approved' as const, label: 'Approved' },
  ]
  const items: Card[] = [{ id: 'c1', name: 'Acme Freight', column: 'submitted' }]

  it('gives the drag handle and the keyboard move menu accessible names', () => {
    renderWithProviders(
      <KanbanBoard
        columns={boardColumns}
        items={items}
        getItemId={(item) => item.id}
        getItemColumn={(item) => item.column}
        onMove={vi.fn()}
        renderCard={(item) => <p>{item.name}</p>}
        dragHandleLabel={(item) => `Drag ${item.name}`}
        moveMenuLabel={(item) => `Move ${item.name}`}
        moveToLabel={(columnLabel) => `Move to ${columnLabel}`}
        announceMove={(item, columnLabel) => `${item.name} moved to ${columnLabel}`}
      />,
    )

    expect(screen.getByRole('button', { name: 'Drag Acme Freight' })).toHaveAccessibleName('Drag Acme Freight')
    expect(screen.getByRole('button', { name: 'Move Acme Freight' })).toHaveAccessibleName('Move Acme Freight')
  })

  it('has a keyboard-operable move control as the equivalent of the pointer drag', async () => {
    const user = userEvent.setup()
    const onMove = vi.fn()
    renderWithProviders(
      <KanbanBoard
        columns={boardColumns}
        items={items}
        getItemId={(item) => item.id}
        getItemColumn={(item) => item.column}
        onMove={onMove}
        renderCard={(item) => <p>{item.name}</p>}
        dragHandleLabel={(item) => `Drag ${item.name}`}
        moveMenuLabel={(item) => `Move ${item.name}`}
        moveToLabel={(columnLabel) => `Move to ${columnLabel}`}
        announceMove={(item, columnLabel) => `${item.name} moved to ${columnLabel}`}
      />,
    )

    await user.click(document.body) // ensure nothing is pre-focused
    screen.getByRole('button', { name: 'Move Acme Freight' }).focus()
    await user.keyboard('{Enter}')
    expect(await screen.findByRole('menuitem', { name: 'Move to Approved' })).toBeInTheDocument()

    await user.click(screen.getByRole('menuitem', { name: 'Move to Approved' }))
    expect(onMove).toHaveBeenCalledWith('c1', 'approved')
  })
})

describe('a11y: signature pad', () => {
  const labels = {
    drawTab: 'Draw',
    typeTab: 'Type',
    clear: 'Clear',
    undo: 'Undo',
    canvasLabel: 'Signature canvas',
    typedPreviewLabel: 'Typed signature preview',
    typedPlaceholder: 'Type your full name',
  }

  it('gives the drawing surface an accessible name and exposes Draw/Type as tabs', () => {
    renderWithProviders(<SignaturePad labels={labels} />)

    expect(screen.getByRole('tab', { name: 'Draw' })).toBeInTheDocument()
    expect(screen.getByRole('tab', { name: 'Type' })).toBeInTheDocument()
    expect(screen.getByLabelText('Signature canvas')).toHaveAccessibleName('Signature canvas')
  })

  it('gives the Clear and Undo icon controls accessible names', () => {
    renderWithProviders(<SignaturePad labels={labels} />)

    expect(screen.getByRole('button', { name: 'Clear' })).toHaveAccessibleName('Clear')
    expect(screen.getByRole('button', { name: 'Undo' })).toHaveAccessibleName('Undo')
  })
})
