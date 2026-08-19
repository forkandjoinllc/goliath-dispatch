'use client'

import * as React from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { Truck } from 'lucide-react'
import { AppShell } from '@/components/shell/app-shell'
import type { SidebarNavGroupDef } from '@/components/shell/sidebar-nav'
import type { MobileNavItem } from '@/components/shell/mobile-nav'
import type { GlobalSearchResults } from '@/components/shell/global-search'
import type { TenantOption, TopBarUser } from '@/components/shell/top-bar'
import type { Actor, TenantPolicy } from '@/lib/permissions'
import type { Locale } from '@/i18n/config'

/**
 * Client bridge for the shell.
 *
 * The layout is a server component (it resolves the Actor and reads the
 * database); the shell needs event handlers. Server actions are passed across
 * the boundary as functions, so sign-out, tenant switching and search all run
 * on the server with their own authorization checks — the client only routes.
 */
export interface AppShellClientProps {
  actor: Actor
  policy: TenantPolicy | null
  locale: Locale
  activePath: string
  appName: string
  sidebarGroups: SidebarNavGroupDef[]
  mobileNavItems: MobileNavItem[]
  user: TopBarUser
  unreadNotificationCount: number
  tenantSwitcher?: { current: TenantOption; options: TenantOption[] }
  impersonation?: { tenantName: string; targetName: string }
  signOutAction: () => Promise<void>
  switchTenantAction: (tenantId: string) => Promise<void>
  endImpersonationAction: () => Promise<void>
  searchAction: (query: string) => Promise<GlobalSearchResults>
  children: React.ReactNode
}

export function AppShellClient({
  actor,
  policy,
  locale,
  activePath,
  appName,
  sidebarGroups,
  mobileNavItems,
  user,
  unreadNotificationCount,
  tenantSwitcher,
  impersonation,
  signOutAction,
  switchTenantAction,
  endImpersonationAction,
  searchAction,
  children,
}: AppShellClientProps) {
  const router = useRouter()
  const [, startTransition] = React.useTransition()

  return (
    <AppShell
      actor={actor}
      policy={policy}
      activePath={activePath}
      appName={appName}
      logoIcon={Truck}
      LinkComponent={Link}
      sidebarGroups={sidebarGroups}
      mobileNavItems={mobileNavItems}
      topBar={{
        user,
        locale,
        unreadNotificationCount,
        homeHref: `/${locale}/app`,
        onSignOut: () =>
          startTransition(() => {
            void signOutAction()
          }),
        onProfile: () => router.push(`/${locale}/app/profile`),
        onSecurity: () => router.push(`/${locale}/app/profile/security`),
        onPreferences: () => router.push(`/${locale}/app/profile/preferences`),
        onOpenNotifications: () => router.push(`/${locale}/app/notifications`),
        tenantSwitcher: tenantSwitcher
          ? {
              ...tenantSwitcher,
              onSwitch: (tenantId: string) =>
                startTransition(() => {
                  void switchTenantAction(tenantId).then(() => router.refresh())
                }),
            }
          : undefined,
      }}
      search={{
        search: searchAction,
        onNavigate: (href) => router.push(href),
      }}
      impersonation={
        impersonation
          ? {
              tenantName: impersonation.tenantName,
              targetUserName: impersonation.targetName,
              onEndSession: () =>
                startTransition(() => {
                  void endImpersonationAction().then(() => router.push(`/${locale}/app`))
                }),
            }
          : undefined
      }
    >
      {children}
    </AppShell>
  )
}
