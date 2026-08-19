import { headers } from 'next/headers'
import { redirect } from 'next/navigation'
import { and, eq, isNull } from 'drizzle-orm'
import { isLocale, type Locale } from '@/i18n/config'
import { tenantDb } from '@/db/tenant-db'
import { notifications, tenantBranding } from '@/db/schema'
import { getActor, getTenant, getTenantPolicy } from '@/server/context'
import { roleRequiresMfa, isMfaEnrolled } from '@/server/auth/mfa'
import {
  endImpersonationAction,
  signOutAction,
  switchTenantAction,
} from '@/server/auth/actions'
import { globalSearch } from '@/server/search/search'
import { listTenantsForSwitcher } from '@/server/tenants/queries'
import { AppShellClient } from '../_shell-client'
import { buildMobileNav, buildSidebarGroups } from '../_nav'
import type { TenantOption } from '@/components/shell/top-bar'
import { Alert } from '@/components/ui/feedback'

/**
 * The application shell layout.
 *
 * Every route under `/{locale}/app/**` passes through here first:
 *  1. resolve the Actor, or send an anonymous visitor to `/login`;
 *  2. enforce the MFA-required-not-enrolled guard for Admin/Accounting —
 *     every other route is unreachable until enrolment completes;
 *  3. load the tenant, its branding (applied as CSS custom properties),
 *     the effective policy, the unread notification count and — only for a
 *     Platform Super Admin — the full tenant list for the switcher;
 *  4. build the permission-filtered navigation and hand everything to the
 *     client shell, including the server actions it can call directly.
 */
export default async function AppLayout({
  children,
  params,
}: {
  children: React.ReactNode
  params: Promise<{ locale: string }>
}) {
  const { locale: rawLocale } = await params
  if (!isLocale(rawLocale)) redirect('/en/login')
  const locale = rawLocale as Locale

  const h = await headers()
  const pathname = h.get('x-pathname') ?? ''

  const actor = await getActor()
  if (!actor) {
    const next = encodeURIComponent(pathname || `/${locale}/app`)
    redirect(`/${locale}/login?next=${next}`)
  }

  // The MFA-required-not-enrolled guard. This is enforced here, server-side,
  // so it cannot be bypassed by a client-side route change — every route
  // under this layout other than the setup page itself is unreachable.
  const isMfaSetupRoute = pathname.endsWith('/app/mfa-setup')
  if (roleRequiresMfa(actor.role) && !isMfaSetupRoute) {
    const enrolled = await isMfaEnrolled(actor.userId)
    if (!enrolled) redirect(`/${locale}/app/mfa-setup`)
  }

  const tenant = actor.tenantId ? await getTenant(actor.tenantId) : null

  if (tenant && (tenant.status === 'suspended' || tenant.status === 'cancelled') && !actor.isPlatformSuperAdmin) {
    return (
      <div className="flex min-h-dvh items-center justify-center p-6">
        <Alert tone="danger" title="errors.tenantSuspended" className="max-w-md">
          {tenant.suspensionReason}
        </Alert>
      </div>
    )
  }

  const policy = actor.tenantId ? await getTenantPolicy(actor.tenantId) : null

  const branding = actor.tenantId
    ? await tenantDb(actor.tenantId).findFirst(tenantBranding)
    : null

  const unreadNotificationCount = actor.tenantId
    ? await tenantDb(actor.tenantId).count(
        notifications,
        and(eq(notifications.userId, actor.userId), isNull(notifications.readAt)),
      )
    : 0

  let tenantSwitcher: { current: TenantOption; options: TenantOption[] } | undefined
  if (actor.isPlatformSuperAdmin) {
    const all = await listTenantsForSwitcher()
    if (all.length > 0) {
      const current = all.find((t) => t.id === actor.tenantId) ?? { id: actor.tenantId ?? '', name: 'Platform' }
      tenantSwitcher = { current, options: all }
    }
  }

  const sidebarGroups = buildSidebarGroups(`/${locale}`)
  const mobileNavItems = buildMobileNav(`/${locale}`)

  const impersonation = actor.impersonation
    ? {
        tenantName: tenant?.displayName ?? '',
        targetName: `${actor.firstName} ${actor.lastName}`,
      }
    : undefined

  const brandStyle = branding
    ? ({
        '--brand-primary': branding.primaryColor,
        '--brand-accent': branding.accentColor,
      } as React.CSSProperties)
    : undefined

  return (
    <div style={brandStyle}>
      <AppShellClient
        actor={actor}
        policy={policy}
        locale={locale}
        activePath={pathname}
        appName={tenant?.displayName ?? 'Goliath Dispatch'}
        sidebarGroups={sidebarGroups}
        mobileNavItems={mobileNavItems}
        user={{ firstName: actor.firstName, lastName: actor.lastName, email: actor.email }}
        unreadNotificationCount={unreadNotificationCount}
        tenantSwitcher={tenantSwitcher}
        impersonation={impersonation}
        signOutAction={signOutAction}
        switchTenantAction={async (tenantId: string) => {
          'use server'
          await switchTenantAction({ tenantId })
        }}
        endImpersonationAction={async () => {
          'use server'
          await endImpersonationAction()
        }}
        searchAction={async (query: string) => {
          'use server'
          const current = await getActor()
          if (!current) return {}
          return globalSearch(current, query)
        }}
      >
        {children}
      </AppShellClient>
    </div>
  )
}
