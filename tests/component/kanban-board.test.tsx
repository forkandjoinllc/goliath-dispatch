import * as React from 'react'
import { describe, expect, it, vi } from 'vitest'
import userEvent from '@testing-library/user-event'
import { screen } from '@testing-library/react'
import { renderWithProviders } from './test-utils'
import { KanbanBoard } from '@/components/data/kanban-board'

interface CarrierOnboardingCard {
  id: string
  name: string
  column: 'submitted' | 'under_review' | 'approved'
}

const columns = [
  { id: 'submitted' as const, label: 'Submitted' },
  { id: 'under_review' as const, label: 'Under review' },
  { id: 'approved' as const, label: 'Approved' },
]

const items: CarrierOnboardingCard[] = [
  { id: 'c1', name: 'Acme Freight', column: 'submitted' },
  { id: 'c2', name: 'Summit Hauling', column: 'under_review' },
]

describe('KanbanBoard', () => {
  it('moves a card via the keyboard menu and announces the move', async () => {
    const user = userEvent.setup()
    const onMove = vi.fn()

    renderWithProviders(
      <KanbanBoard
        columns={columns}
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

    await user.click(screen.getByRole('button', { name: 'Move Acme Freight' }))
    await user.click(screen.getByRole('menuitem', { name: 'Move to Approved' }))

    expect(onMove).toHaveBeenCalledWith('c1', 'approved')
    expect(await screen.findByText('Acme Freight moved to Approved')).toBeInTheDocument()
  })

  it('renders per-column counts', () => {
    renderWithProviders(
      <KanbanBoard
        columns={columns}
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
    expect(screen.getByText('Submitted').closest('div')).toHaveTextContent('1')
  })
})
