import type { SidebarNavGroupDef } from '@/components/shell/sidebar-nav'
import type { MobileNavItem } from '@/components/shell/mobile-nav'

/**
 * Icons are referenced below by name (`icon: 'LayoutDashboard'`), not by
 * importing the `lucide-react` component itself — see `nav-icons.ts`'s doc
 * comment for why passing the actual component reference from this
 * Server-Component-only module into the client `SidebarNav`/`MobileNav`
 * crashed every authenticated page.
 */

/**
 * Navigation definition.
 *
 * Every item declares the permission that makes it visible; `SidebarNav`
 * filters with `can()`. Because the matrix is the single source of truth, a
 * Driver never sees an Invoices link and an Accounting user never sees
 * "Create load" — without a single role-name comparison in this file.
 */
export function buildSidebarGroups(localePrefix: string): SidebarNavGroupDef[] {
  const href = (path: string) => `${localePrefix}${path}`

  return [
    {
      key: 'operations',
      items: [
        { key: 'dashboard', href: href('/app'), icon: 'LayoutDashboard' },
        { key: 'loads', href: href('/app/loads'), icon: 'Truck', permission: 'load:read' },
        { key: 'tracking', href: href('/app/tracking'), icon: 'MapPinned', permission: 'tracking:read' },
        { key: 'permits', href: href('/app/permits'), icon: 'Route', permission: 'permit:read' },
        { key: 'messages', href: href('/app/messages'), icon: 'MessageSquare', permission: 'message:read' },
      ],
    },
    {
      key: 'compliance',
      items: [
        { key: 'carriers', href: href('/app/carriers'), icon: 'Building2', permission: 'carrier:read' },
        {
          key: 'onboarding',
          href: href('/app/onboarding'),
          icon: 'ClipboardCheck',
          permission: 'carrier:onboarding:read',
        },
        { key: 'drivers', href: href('/app/drivers'), icon: 'IdCard', permission: 'driver:read' },
        { key: 'trucks', href: href('/app/equipment/trucks'), icon: 'Truck', permission: 'equipment:read' },
        {
          key: 'trailers',
          href: href('/app/equipment/trailers'),
          icon: 'Container',
          permission: 'equipment:read',
        },
        { key: 'documents', href: href('/app/documents'), icon: 'FileText', permission: 'document:read' },
        {
          key: 'signatures',
          href: href('/app/signatures'),
          icon: 'FileSignature',
          permission: ['signature:request:read', 'signature:sign'],
        },
      ],
    },
    {
      key: 'finance',
      items: [
        { key: 'invoices', href: href('/app/invoices'), icon: 'Receipt', permission: 'invoice:read' },
        {
          key: 'settlements',
          href: href('/app/settlements'),
          icon: 'Wallet',
          permission: 'settlement:read',
        },
        { key: 'expenses', href: href('/app/expenses'), icon: 'Banknote', permission: 'expense:read' },
        {
          key: 'factoring',
          href: href('/app/factoring'),
          icon: 'ScrollText',
          permission: 'factoring:read',
        },
      ],
    },
    {
      key: 'insight',
      items: [
        { key: 'reports', href: href('/app/reports'), icon: 'Gauge', permission: 'report:read' },
        { key: 'audit', href: href('/app/audit'), icon: 'History', permission: 'audit:read' },
      ],
    },
    {
      key: 'administration',
      items: [
        { key: 'customers', href: href('/app/customers'), icon: 'UsersRound', permission: 'customer:read' },
        { key: 'users', href: href('/app/users'), icon: 'Users', permission: 'tenant:user:read' },
        {
          key: 'assignments',
          href: href('/app/assignments'),
          icon: 'ShieldCheck',
          permission: 'assignment:read',
        },
        { key: 'leads', href: href('/app/leads'), icon: 'FileText', permission: 'lead:read' },
        {
          key: 'settings',
          href: href('/app/settings'),
          icon: 'Settings',
          permission: 'tenant:settings:read',
        },
      ],
    },
    {
      key: 'platform',
      items: [
        {
          key: 'tenants',
          href: href('/app/platform/tenants'),
          icon: 'Building2',
          permission: 'platform:tenant:read',
        },
        {
          key: 'plans',
          href: href('/app/platform/plans'),
          icon: 'Receipt',
          permission: 'platform:plan:read',
        },
        {
          key: 'platformHealth',
          href: href('/app/platform/health'),
          icon: 'Gauge',
          permission: 'platform:health:read',
        },
      ],
    },
  ]
}

/**
 * Bottom tab bar for phones. Deliberately short — carriers and drivers work
 * from a cab, and five large targets beat a scrollable list.
 */
export function buildMobileNav(localePrefix: string): MobileNavItem[] {
  const href = (path: string) => `${localePrefix}${path}`
  return [
    { key: 'dashboard', href: href('/app'), icon: 'LayoutDashboard' },
    { key: 'loads', href: href('/app/loads'), icon: 'Truck', permission: 'load:read' },
    { key: 'documents', href: href('/app/documents'), icon: 'FileText', permission: 'document:read' },
    { key: 'messages', href: href('/app/messages'), icon: 'MessageSquare', permission: 'message:read' },
    { key: 'invoices', href: href('/app/invoices'), icon: 'Receipt', permission: 'invoice:read' },
  ]
}
