import * as React from 'react'
import { describe, expect, it } from 'vitest'
import { screen } from '@testing-library/react'
import { renderWithProviders } from './test-utils'
import { SidebarNav, type SidebarNavGroupDef } from '@/components/shell/sidebar-nav'
import type { Actor } from '@/lib/permissions'

const dispatcherActor: Actor = {
  userId: 'user-1',
  email: 'dispatcher@example.com',
  firstName: 'Dana',
  lastName: 'Ortiz',
  locale: 'en',
  timezone: 'America/Chicago',
  isPlatformSuperAdmin: false,
  tenantId: 'tenant-1',
  role: 'dispatcher',
  carrierId: null,
  driverId: null,
  assignments: { carrierIds: [], truckIds: [], trailerIds: [], driverIds: [], groupIds: [] },
  overrides: [],
  mfaRequired: false,
  mfaSatisfied: true,
  impersonation: null,
  sessionId: 'session-1',
}

const groups: SidebarNavGroupDef[] = [
  {
    key: 'operations',
    items: [{ key: 'loads', href: '/app/loads', icon: 'Truck', permission: 'load:read' }],
  },
  {
    key: 'finance',
    items: [{ key: 'invoices', href: '/app/invoices', icon: 'Receipt', permission: 'invoice:read' }],
  },
  {
    key: 'administration',
    items: [{ key: 'users', href: '/app/users', icon: 'Users', permission: 'tenant:user:invite' }],
  },
]

describe('SidebarNav', () => {
  it('renders items the actor has permission for and hides items it does not', () => {
    renderWithProviders(<SidebarNav groups={groups} actor={dispatcherActor} activePath="/app/loads" />)

    // Dispatcher holds load:read at "assigned" scope.
    expect(screen.getByRole('link', { name: 'Loads' })).toBeInTheDocument()

    // Dispatcher's matrix has neither invoice:read nor tenant:user:invite.
    expect(screen.queryByRole('link', { name: 'Invoices' })).not.toBeInTheDocument()
    expect(screen.queryByRole('link', { name: 'Users' })).not.toBeInTheDocument()

    // A group whose only item is hidden should not render at all.
    expect(screen.queryByText('Finance')).not.toBeInTheDocument()
    expect(screen.queryByText('Administration')).not.toBeInTheDocument()
  })

  it('marks the active route with aria-current', () => {
    renderWithProviders(<SidebarNav groups={groups} actor={dispatcherActor} activePath="/app/loads" />)
    expect(screen.getByRole('link', { name: 'Loads' })).toHaveAttribute('aria-current', 'page')
  })
})
